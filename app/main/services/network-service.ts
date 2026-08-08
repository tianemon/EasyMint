/**
 * 设备互联服务 — mDNS 发现 + WebSocket 配对连接 + 心跳 + 配对持久化
 *
 * 交互模式对齐蓝牙/WiFi（方案见 docs/design/跨设备会话迁移与设备互联方案.md 第二章）：
 * - 发现：mDNS 周期通告（对齐蓝牙广告），配对期 2s/次，已配对后停止通告
 * - 配对：首次双向确认 + 密钥交换（对齐蓝牙配对 PIN），密钥持久化，后续免配对
 * - 连接：WebSocket 长连接 + 30s 心跳；离线设备 60s 低频探测；启动自动连接已配对设备
 * - 状态机：静默 → 配对模式(5min 超时) → 已配对(常驻连接)
 *
 * 安全：主进程持有网络栈与密钥，渲染层经 contextBridge 严格边界调用（零网络知识）。
 */

import { EventEmitter } from "node:events";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import { Bonjour } from "bonjour-service";

// ── 常量（频率对齐蓝牙指导值，见方案文档频率参数表） ──
// 注:mDNS 通告间隔由协议层维护(蓝牙 2s 阈值的对应物),应用侧无需定时发布
const PAIR_MODE_TIMEOUT = 5 * 60 * 1000; // 配对模式 5 分钟自动退出
const HEARTBEAT_INTERVAL = 30 * 1000; // 已连接心跳 30s
const OFFLINE_PROBE_INTERVAL = 60 * 1000; // 离线设备探测 60s
const MANUAL_SCAN_DURATION = 30 * 1000; // 手动扫描 30s
const WS_PORT = 47777; // 局域网 WS 监听端口（固定，防火墙放行一次）
const SERVICE_TYPE = "easymint"; // mDNS 服务类型
const PAIRED_FILE = path.join(os.homedir(), ".easymint", "paired-devices.json");
const DEVICE_ID_FILE = path.join(os.homedir(), ".easymint", "device-id.json");

// ── 类型 ──
export interface PairedDevice {
  id: string; // 对方设备 UUID
  name: string; // 对方设备名
  key: string; // 配对密钥（随机生成，持久化）
  pairedAt: number;
  lastSeen: number; // 最后在线时间戳
}

export interface DiscoveredDevice {
  id: string;
  name: string;
  address: string;
  port: number;
}

interface NetworkEvents {
  "devices-changed": [];
  "pair-request": [{ id: string; name: string; address: string; port: number }];
  "device-online": [{ id: string }];
  "device-offline": [{ id: string }];
}

/**
 * 获取人类可读设备名（os.hostname() 可能返回 IP，如 hostname 被配置为 192.168.5.5）：
 * - macOS: scutil --get ComputerName（"Amon的MacBook Air"）
 * - Windows: 环境变量 COMPUTERNAME
 * - Linux/兜底: os.hostname()
 */
function getFriendlyHostname(): string {
  try {
    if (process.platform === "darwin") {
      const name = execFileSync("scutil", ["--get", "ComputerName"], { encoding: "utf8" }).trim();
      if (name) return name;
    } else if (process.platform === "win32") {
      const name = process.env.COMPUTERNAME?.trim();
      if (name) return name;
    }
  } catch { /* 兜底走 hostname */ }
  const h = os.hostname();
  // hostname 是 IP 时退化用用户名（比显示 IP 友好）
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return os.userInfo().username || h;
  return h;
}

class NetworkService extends EventEmitter {
  private bonjour = new Bonjour();
  private advertiseService: import("bonjour-service").Service | null = null;
  private advertiseTimer: NodeJS.Timeout | null = null;
  private pairModeEnd: number | null = null; // 配对模式截止时间
  private pairModeTimer: NodeJS.Timeout | null = null;
  private manualScanTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private probeTimer: NodeJS.Timeout | null = null;
  private wss: WebSocketServer | null = null;
  private wsClients = new Map<string, WebSocket>(); // 对方设备 ID → 出站连接
  private inboundSockets = new Map<string, WebSocket>(); // 对方设备 ID → 入站连接
  private discovered = new Map<string, DiscoveredDevice>();
  private paired: PairedDevice[] = [];
  private deviceId = "";
  private deviceName = "";
  private listeningPort = WS_PORT;

  constructor() {
    super();
    this.loadIdentity();
    this.loadPaired();
    this.startWsServer();
  }

  // ── 身份 ──
  private loadIdentity(): void {
    const friendly = getFriendlyHostname();
    try {
      if (fs.existsSync(DEVICE_ID_FILE)) {
        const d = JSON.parse(fs.readFileSync(DEVICE_ID_FILE, "utf-8"));
        this.deviceId = d.id;
        // 已存名称为空/IP 形式（hostname 被配置成 IP 的历史数据）→ 升级为友好名
        const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(String(d.name ?? ""));
        this.deviceName = d.name && !isIp ? d.name : friendly;
        if (isIp || !d.name) this.saveIdentity(); // 持久化升级后的名称
      }
    } catch { /* 首次启动,下面生成 */ }
    if (!this.deviceId) {
      this.deviceId = crypto.randomUUID();
      this.deviceName = friendly;
      this.saveIdentity();
    }
  }

  private saveIdentity(): void {
    try {
      fs.mkdirSync(path.dirname(DEVICE_ID_FILE), { recursive: true });
      fs.writeFileSync(DEVICE_ID_FILE, JSON.stringify({ id: this.deviceId, name: this.deviceName }, null, 2));
    } catch (e) {
      console.error("[network] 保存设备身份失败:", (e as Error).message);
    }
  }

  // ── 配对持久化 ──
  private loadPaired(): void {
    try {
      if (fs.existsSync(PAIRED_FILE)) {
        this.paired = JSON.parse(fs.readFileSync(PAIRED_FILE, "utf-8"));
      }
    } catch (e) {
      console.error("[network] 解析 paired-devices.json 失败:", (e as Error).message);
    }
  }

  private savePaired(): void {
    try {
      fs.mkdirSync(path.dirname(PAIRED_FILE), { recursive: true });
      fs.writeFileSync(PAIRED_FILE, JSON.stringify(this.paired, null, 2));
    } catch (e) {
      console.error("[network] 保存配对记录失败:", (e as Error).message);
    }
  }

  // ── WS 服务端（入站连接） ──
  private startWsServer(): void {
    // Windows 防火墙:首次监听局域网端口需用户放行——提示一次(不打扰,见设备互联面板)
    if (process.platform === "win32") {
      this.emit("firewall-hint", { port: WS_PORT });
    }
    try {
      this.wss = new WebSocketServer({ port: WS_PORT });
      this.listeningPort = WS_PORT;
      this.wss.on("connection", (ws, req) => this.handleInbound(ws, req));
      this.wss.on("error", (e) => {
        // 端口被占（如双实例）：记录但功能降级为仅出站
        if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") {
          console.warn("[network] WS 端口被占用，仅出站连接可用");
        } else {
          console.error("[network] WS 服务端错误:", (e as Error).message);
        }
      });
    } catch (e) {
      console.error("[network] 启动 WS 服务端失败:", (e as Error).message);
    }
  }

  // ── 对外接口（IPC 调用） ──

  /** 获取本机设备信息 */
  getSelf(): { id: string; name: string; discoverable: boolean } {
    return { id: this.deviceId, name: this.deviceName, discoverable: this.isDiscoverable() };
  }

  /** 已配对设备列表（含在线状态） */
  listPaired(): Array<PairedDevice & { online: boolean }> {
    const onlineIds = new Set([...this.wsClients.keys(), ...this.inboundSockets.keys()]);
    return this.paired.map((p) => ({ ...p, online: onlineIds.has(p.id) }));
  }

  /** 发现的可用设备（配对模式中） */
  listDiscovered(): DiscoveredDevice[] {
    return [...this.discovered.values()];
  }

  getDeviceName(): string { return this.deviceName; }

  /** 设置设备名（持久化） */
  setDeviceName(name: string): void {
    this.deviceName = name.trim() || getFriendlyHostname();
    this.saveIdentity();
  }

  /** 当前是否处于配对模式（广播+扫描中） */
  isDiscoverable(): boolean {
    return this.pairModeEnd !== null && this.pairModeEnd > Date.now();
  }

  /** 开启配对模式（广播 + 扫描，5 分钟自动退出；已配对设备在列则不清空） */
  startPairMode(): void {
    this.pairModeEnd = Date.now() + PAIR_MODE_TIMEOUT;
    this.startAdvertising();
    this.emit("devices-changed");
    if (this.pairModeTimer) clearTimeout(this.pairModeTimer);
    this.pairModeTimer = setTimeout(() => this.stopPairMode(), PAIR_MODE_TIMEOUT);
  }

  /** 手动扫描 30s（不广播，只监听） */
  startManualScan(): void {
    this.emit("devices-changed");
    if (this.manualScanTimer) clearTimeout(this.manualScanTimer);
    this.manualScanTimer = setTimeout(() => {
      this.emit("devices-changed");
    }, MANUAL_SCAN_DURATION);
  }

  /** 停止配对模式（回到静默态） */
  stopPairMode(): void {
    this.pairModeEnd = null;
    this.stopAdvertising();
    this.discovered.clear();
    if (this.pairModeTimer) { clearTimeout(this.pairModeTimer); this.pairModeTimer = null; }
    this.emit("devices-changed");
  }

  /** 响应配对请求（B 端用户确认后，双向建立连接） */
  async acceptPair(peer: DiscoveredDevice): Promise<{ ok: boolean; error?: string }> {
    try {
      const key = crypto.randomBytes(32).toString("hex");
      // 1. 发 pair-accept(短连接):发送端收到后保存配对记录(密钥一致,后续 hello 校验通过)
      const msg = JSON.stringify({ type: "pair-accept", fromId: this.deviceId, fromName: this.deviceName, key });
      const sent = await this.sendRaw(peer.address, peer.port, msg);
      if (!sent) return { ok: false, error: "无法连接对方设备" };
      // 2. 本端保存配对记录
      this.paired = this.paired.filter((p) => p.id !== peer.id);
      this.paired.push({ id: peer.id, name: peer.name, key, pairedAt: Date.now(), lastSeen: Date.now() });
      this.savePaired();
      // 3. 建立持久出站连接(携带密钥,发送端校验后记录入站)——不能只靠 sendRaw(短连接发完即关)
      await this.connectOutbound({ id: peer.id, name: peer.name, key, pairedAt: 0, lastSeen: Date.now() }, peer.address, peer.port);
      this.emit("devices-changed");
      return { ok: true };
    } catch (e) {
      // 连接失败:回滚配对记录,让用户重试
      this.paired = this.paired.filter((p) => p.id !== peer.id);
      this.savePaired();
      return { ok: false, error: `连接失败: ${(e as Error).message}` };
    }
  }

  /** 主动发起配对（A 端点选设备后）——发送配对请求给对方确认 */
  async requestPair(peer: DiscoveredDevice): Promise<{ ok: boolean; error?: string }> {
    try {
      const msg = JSON.stringify({ type: "pair-request", fromId: this.deviceId, fromName: this.deviceName });
      const ok = await this.sendRaw(peer.address, peer.port, msg);
      if (!ok) return { ok: false, error: "无法连接对方设备（可能未开启可被发现）" };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /** 删除配对 */
  unpair(id: string): void {
    this.paired = this.paired.filter((p) => p.id !== id);
    this.wsClients.get(id)?.close();
    this.inboundSockets.get(id)?.close();
    this.wsClients.delete(id);
    this.inboundSockets.delete(id);
    this.savePaired();
    this.emit("devices-changed");
  }

  // ── 广播/扫描（mDNS） ──
  // 注意:mDNS 通告由协议层自动持续广播,应用只需 publish 一次——反复 publish 同名服务会报
  // "Service name is already in use on the network"(实测踩坑)。配对期 2s 的"通告间隔"由协议维护。

  private startAdvertising(): void {
    if (this.advertiseService) return;
    try {
      // 服务名带设备名,对端可读;txt 携带设备 UUID(认 ID 不认 IP)
      this.advertiseService = this.bonjour.publish({
        name: `${this.deviceName} (EM)`,
        type: SERVICE_TYPE,
        port: this.listeningPort,
        txt: { id: this.deviceId, name: this.deviceName },
      });
    } catch (e) {
      console.error("[network] mDNS 发布失败:", (e as Error).message);
    }
    // 开始扫描对方通告(每次 find 都新 Browser,配对期持续监听;stop 时销毁)
    try {
      this.bonjour.find({ type: SERVICE_TYPE }, (service) => {
        const id = (service.txt?.id as string) ?? "";
        const name = (service.txt?.name as string) ?? service.name;
        if (!id || id === this.deviceId) return;
        const addr = service.addresses?.find((a) => a.includes(".")) ?? service.addresses?.[0];
        if (!addr) return;
        this.discovered.set(id, { id, name, address: addr, port: service.port ?? WS_PORT });
        this.emit("devices-changed");
      });
    } catch { /* 扫描失败忽略 */ }
  }

  private stopAdvertising(): void {
    // 停止通告(Service.stop 发送 goodbye 包,对端立即感知离线)
    try { this.advertiseService?.stop(); } catch { /* */ }
    this.advertiseService = null;
    // 销毁 Bonjour 实例(停止全部 find/广播),重建供下次使用
    try { this.bonjour.destroy(); } catch { /* */ }
    this.bonjour = new Bonjour();
    this.discovered.clear();
    if (this.reconnectAdvertiseTimer) { clearTimeout(this.reconnectAdvertiseTimer); this.reconnectAdvertiseTimer = null; }
  }

  /** 断线重连广播:连接断开/启动时短时广播(find 对端 + 被对端发现),连接建立后停止。
      蓝牙同理:配对后常态静默,断线重连需重新广播——否则双方都静默时永远互相发现不了 */
  private reconnectAdvertiseTimer: NodeJS.Timeout | null = null;
  private startReconnectAdvertising(): void {
    if (this.pairModeEnd && this.pairModeEnd > Date.now()) return; // 配对模式已有广播
    this.startAdvertising();
    if (this.reconnectAdvertiseTimer) clearTimeout(this.reconnectAdvertiseTimer);
    this.reconnectAdvertiseTimer = setTimeout(() => {
      // 60s 后若仍未连上,停止广播(等下次断线/启动再触发)
      this.stopAdvertising();
    }, OFFLINE_PROBE_INTERVAL);
  }

  // ── 连接管理 ──

  /** 建立出站连接（连接已配对设备） */
  private async connectOutbound(p: PairedDevice, address: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(`ws://${address}:${port}`);
        ws.on("open", () => {
          this.wsClients.set(p.id, ws);
          ws.send(JSON.stringify({ type: "hello", fromId: this.deviceId, fromName: this.deviceName, key: p.key }));
          this.markOnline(p.id);
          resolve();
        });
        ws.on("close", () => {
          this.wsClients.delete(p.id);
          this.markOffline(p.id);
        });
        ws.on("error", (e) => { this.wsClients.delete(p.id); reject(e); });
        ws.on("message", (data: Buffer) => this.handleAppMessage(p.id, JSON.parse(data.toString())));
        setTimeout(() => reject(new Error("连接超时")), 5000);
      } catch (e) {
        reject(e);
      }
    });
  }

  private handleInbound(ws: WebSocket, req: import("node:http").IncomingMessage): void {
    const peerAddr = req.socket.remoteAddress ?? "";
    let peerId = "";
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "pair-request") {
          // 对方请求配对 → 通知 UI 弹窗确认
          this.emit("pair-request", {
            id: msg.fromId, name: msg.fromName, address: peerAddr.replace("::ffff:", ""), port: WS_PORT,
          });
          ws.close();
        } else if (msg.type === "pair-accept") {
          // 对方接受了我们的配对请求 → 只保存配对记录。
          // 注意:此连接是对方 sendRaw 短连接(发完即关),不能存 inboundSockets——
          // 对方 acceptPair 会紧接着 connectOutbound 发 hello,在 hello 分支建立真正的长连接
          this.paired = this.paired.filter((p) => p.id !== msg.fromId);
          this.paired.push({ id: msg.fromId, name: msg.fromName, key: msg.key, pairedAt: Date.now(), lastSeen: Date.now() });
          this.savePaired();
          this.emit("devices-changed");
          ws.close();
        } else if (msg.type === "hello") {
          // 已配对设备发起连接 → 校验密钥
          const p = this.paired.find((x) => x.id === msg.fromId);
          if (!p || p.key !== msg.key) {
            ws.close();
            return;
          }
          peerId = msg.fromId;
          this.inboundSockets.set(msg.fromId, ws);
          this.markOnline(msg.fromId);
          ws.send(JSON.stringify({ type: "hello-ack" }));
        } else if (msg.type === "hello-ack") {
          this.markOnline(peerId);
        } else if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        } else if (msg.type === "pong") {
          // 心跳响应，保活
        } else {
          this.handleAppMessage(peerId, msg);
        }
      } catch { /* 非 JSON 消息忽略 */ }
    });
    ws.on("close", () => {
      if (peerId) {
        this.inboundSockets.delete(peerId);
        this.markOffline(peerId);
      }
    });
  }

  private markOnline(id: string): void {
    const p = this.paired.find((x) => x.id === id);
    if (p) {
      p.lastSeen = Date.now();
      this.savePaired();
    }
    // 连接建立 → 停止"断线重连广播"(仅重连场景;配对模式的广播由配对超时自身管理,不在此停)
    if (this.reconnectAdvertiseTimer && !(this.pairModeEnd && this.pairModeEnd > Date.now())) {
      this.stopAdvertising();
    }
    this.emit("device-online", { id });
    this.emit("devices-changed");
  }

  private markOffline(id: string): void {
    // 连接断开 → 短时广播让对端可重新发现(断线重连前提)
    this.startReconnectAdvertising();
    this.emit("device-offline", { id });
    this.emit("devices-changed");
  }

  /** 应用层消息（迁移协议 + 预留消息传递） */
  private handleAppMessage(peerId: string, msg: { type: string; [k: string]: unknown }): void {
    if (msg.type.startsWith("transfer-") || msg.type.startsWith("migration-")) {
      // 迁移协议消息转发给 migration-service(接收端:request/chunk/complete;
      // 发送端:accept/reject/done/failed 由调用方监听)
      this.emit("migration-message", { peerId, msg });
    } else {
      this.emit("message", { peerId, msg });
    }
  }

  /** 发送原始 WS 消息到指定地址（配对握手用，短连接） */
  private sendRaw(address: string, port: number, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(`ws://${address}:${port}`);
        const timer = setTimeout(() => { try { ws.close(); } catch { /* */ } resolve(false); }, 5000);
        ws.on("open", () => {
          ws.send(message);
          setTimeout(() => { try { ws.close(); } catch { /* */ } resolve(true); }, 300);
        });
        ws.on("error", () => { clearTimeout(timer); resolve(false); });
      } catch {
        resolve(false);
      }
    });
  }

  /** 向已配对设备发送应用消息（预留：会话/项目迁移） */
  sendToDevice(id: string, message: Record<string, unknown>): boolean {
    const ws = this.wsClients.get(id) ?? this.inboundSockets.get(id);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(message));
    return true;
  }

  // ── 心跳与探测（常驻） ──

  /** 尝试连接已配对设备(启动时 + 离线探测共用):仅在 mDNS 能发现它时(discovered 有记录)尝试 */
  private tryConnectPaired(): void {
    for (const p of this.paired) {
      if (this.wsClients.has(p.id) || this.inboundSockets.has(p.id)) continue;
      const disc = this.discovered.get(p.id);
      if (disc) {
        this.connectOutbound(p, disc.address, disc.port).catch(() => { /* 连接失败,下轮再试 */ });
      }
    }
  }

  startKeepalive(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      for (const ws of [...this.wsClients.values(), ...this.inboundSockets.values()]) {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* */ }
        }
      }
    }, HEARTBEAT_INTERVAL);
    this.probeTimer = setInterval(() => {
      // 低频探测已配对设备:不依赖配对模式(已配对后回到静默态,探测仍需进行)
      // 探测前提是 mDNS 能发现对方(对方在可被发现状态或已被我们 find 到)
      this.tryConnectPaired();
    }, OFFLINE_PROBE_INTERVAL);
    // 启动时:短时广播(find 对端 + 被对端发现)+ 立即尝试连接已配对设备(对齐 WiFi 记住网络自动连)
    this.startReconnectAdvertising();
    setTimeout(() => this.tryConnectPaired(), 1000);
  }
}

/** 单例 */
export const networkService = new NetworkService();
