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
import { generateKeyPair, deriveSharedKey, encrypt, decrypt, makeChallenge } from "./device-crypto";

// ── 常量（频率对齐蓝牙指导值，见方案文档频率参数表） ──
// 注:mDNS 通告间隔由协议层维护(蓝牙 2s 阈值的对应物),应用侧无需定时发布
const HEARTBEAT_INTERVAL = 30 * 1000; // 已连接心跳 30s
const OFFLINE_PROBE_INTERVAL = 60 * 1000; // 离线设备探测 60s
const WS_PORT = 47777; // 局域网 WS 监听端口（固定，防火墙放行一次）
const DISCOVERABLE_TIMEOUT = 60 * 1000; // 可被发现持续 1 分钟自动停止(用户定稿)
const SERVICE_TYPE = "easymint"; // mDNS 服务类型
const PAIRED_FILE = path.join(os.homedir(), ".easymint", "paired-devices.json");
const DEVICE_ID_FILE = path.join(os.homedir(), ".easymint", "device-id.json");

// ── 类型 ──
export interface PairedDevice {
  id: string; // 对方设备 UUID
  name: string; // 对方设备名
  /** 共享密钥(ECDH 派生,base64)——双方各自算出,永不传输;用于连接认证 + 传输加密 */
  key: string;
  pairedAt: number;
  lastSeen: number; // 最后在线时间戳
  /** 最后已知地址/端口(重连优先直连,对齐蓝牙已配对设备直接连接;IP 变化时失效) */
  address?: string;
  port?: number;
}

/** 配对中暂存:对方设备 ID → 其 ECDH 公钥(base64)——acceptPair 时派生共享密钥 */
type PendingPairKey = string;

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

/** 本机 IPv4 地址集(排除回环/APIPA/虚拟网卡段)——对端同网段匹配基准 */
function localIPv4Prefixes(): Set<string> {
  const prefixes = new Set<string>();
  try {
    for (const addrs of Object.values(os.networkInterfaces())) {
      for (const a of addrs ?? []) {
        if (a.family !== "IPv4" || a.internal) continue;
        // 排除 WSL/Hyper-V(172.16-31)/Docker(172.17+ 也被 172.16-31 覆盖)/APIPA(169.254)
        const first = a.address.split(".")[0];
        const second = Number(a.address.split(".")[1] ?? 0);
        if (first === "127" || first === "169") continue;
        if (first === "172" && second >= 16 && second <= 31) continue;
        prefixes.add(a.address.split(".").slice(0, 2).join("."));
      }
    }
  } catch { /* 忽略 */ }
  return prefixes;
}

/**
 * 从 mDNS 上报的地址列表中选择"与本机同网段"的地址(真实局域网 IP)。
 * 问题:Windows 多网卡(Hyper-V/WSL 虚拟网卡 172.x)会抢占 addresses 首位,
 * 取第一个 IPv4 会连到虚拟网卡(实测 172.28.64.1)——对端真实 IP 与本机同网段,优先匹配。
 */
function pickBestAddress(addresses: string[]): string | undefined {
  const v4 = addresses.filter((a) => a.includes(".") && !a.startsWith("169.") && !a.startsWith("127."));
  if (v4.length === 0) return undefined;
  const localPrefixes = localIPv4Prefixes();
  // 优先同网段(前两段相同);无匹配退回第一个 IPv4
  return v4.find((a) => localPrefixes.has(a.split(".").slice(0, 2).join("."))) ?? v4[0];
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
  private pairModeEnd: number | null = null; // 可被发现截止时间
  private pairModeTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private probeTimer: NodeJS.Timeout | null = null;
  private wss: WebSocketServer | null = null;
  private wsClients = new Map<string, WebSocket>(); // 对方设备 ID → 出站连接
  private inboundSockets = new Map<string, WebSocket>(); // 对方设备 ID → 入站连接
  private discovered = new Map<string, DiscoveredDevice>();
  private paired: PairedDevice[] = [];
  /** 配对中暂存(发起方 A):对方设备 ID → 自己的 ECDH 私钥(等对方公钥派生共享密钥) */
  private pendingOwnKeys = new Map<string, crypto.ECDH>();
  /** 配对中暂存(接收方 B):对方设备 ID → 对方 ECDH 公钥(base64) */
  private pendingPeerKeys = new Map<string, string>();
  private deviceId = "";
  private deviceName = "";
  private listeningPort = WS_PORT;

  constructor() {
    super();
    this.loadIdentity();
    this.loadPaired();
    this.startWsServer();
    // 无自动扫描(用户定稿)——仅手动扫描,设备互联低频场景
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

  /** 发现的可用设备(不含已配对——已配对设备在"已配对设备"列表展示) */
  listDiscovered(): DiscoveredDevice[] {
    const pairedIds = new Set(this.paired.map((p) => p.id));
    return [...this.discovered.values()].filter((d) => !pairedIds.has(d.id));
  }

  getDeviceName(): string { return this.deviceName; }

  /** 设置设备名（持久化） */
  setDeviceName(name: string): void {
    this.deviceName = name.trim() || getFriendlyHostname();
    this.saveIdentity();
  }

  /** 当前是否可被发现（广播中） */
  isDiscoverable(): boolean {
    return this.pairModeEnd !== null && this.pairModeEnd > Date.now();
  }

  /** 开启可被发现:广播 1 分钟自动停止(用户定稿);扫描常驻不受影响 */
  startPairMode(): void {
    this.pairModeEnd = Date.now() + DISCOVERABLE_TIMEOUT;
    this.startAdvertising();
    this.emit("devices-changed");
    if (this.pairModeTimer) clearTimeout(this.pairModeTimer);
    this.pairModeTimer = setTimeout(() => this.stopPairMode(), DISCOVERABLE_TIMEOUT);
  }

  /** 关闭可被发现:停止广播(扫描保持) */
  stopPairMode(): void {
    this.pairModeEnd = null;
    this.stopAdvertising();
    if (this.pairModeTimer) { clearTimeout(this.pairModeTimer); this.pairModeTimer = null; }
    this.emit("devices-changed");
  }

  /** 响应配对请求（B 端用户确认后，双向建立连接）。
      ECDH: A 公钥随 pair-request 到达(暂存 pendingPeerKeys);B 生成自己密钥对,
      用 A 公钥派生共享密钥(持久化),把 B 公钥随 pair-accept 发 A——密钥永不传输 */
  async acceptPair(peer: DiscoveredDevice): Promise<{ ok: boolean; error?: string }> {
    try {
      const aPublicKeyB64 = this.pendingPeerKeys.get(peer.id);
      if (!aPublicKeyB64) return { ok: false, error: "未找到配对请求(请让对方重新发起配对)" };
      // B 生成密钥对 → 用 A 公钥派生共享密钥
      const { privateKey, publicKey } = generateKeyPair();
      const sharedKey = deriveSharedKey(privateKey, aPublicKeyB64);
      const keyB64 = sharedKey.toString("base64");
      // 1. 发 pair-accept(短连接):携带 B 公钥,发送端(A)用它派生同一共享密钥
      const msg = JSON.stringify({ type: "pair-accept", fromId: this.deviceId, fromName: this.deviceName, publicKey });
      const sent = await this.sendRaw(peer.address, peer.port, msg);
      if (!sent) return { ok: false, error: "无法连接对方设备" };
      // 2. 本端保存配对记录(共享密钥)
      this.paired = this.paired.filter((p) => p.id !== peer.id);
      this.paired.push({ id: peer.id, name: peer.name, key: keyB64, pairedAt: Date.now(), lastSeen: Date.now() });
      this.savePaired();
      // 3. 建立持久出站连接(携带共享密钥,发送端校验后记录入站)
      await this.connectOutbound({ id: peer.id, name: peer.name, key: keyB64, pairedAt: 0, lastSeen: Date.now() }, peer.address, peer.port);
      this.emit("devices-changed");
      return { ok: true };
    } catch (e) {
      // 连接失败:回滚配对记录,让用户重试
      this.paired = this.paired.filter((p) => p.id !== peer.id);
      this.savePaired();
      return { ok: false, error: `连接失败: ${(e as Error).message}` };
    }
  }

  /** 主动发起配对（A 端点选设备后）——发送配对请求给对方确认。
      A 生成密钥对,公钥随请求发出;暂存私钥等 B 的公钥派生共享密钥 */
  async requestPair(peer: DiscoveredDevice): Promise<{ ok: boolean; error?: string }> {
    try {
      const { privateKey, publicKey } = generateKeyPair();
      this.pendingOwnKeys.set(peer.id, privateKey);
      const msg = JSON.stringify({ type: "pair-request", fromId: this.deviceId, fromName: this.deviceName, publicKey });
      const ok = await this.sendRaw(peer.address, peer.port, msg);
      if (!ok) {
        this.pendingOwnKeys.delete(peer.id);
        return { ok: false, error: "无法连接对方设备（可能未开启可被发现）" };
      }
      return { ok: true };
    } catch (e) {
      this.pendingOwnKeys.delete(peer.id);
      return { ok: false, error: (e as Error).message };
    }
  }

  /** 删除配对 */
  unpair(id: string): void {
    // 先通知对方(双向解除——否则对方还当已配对,持续重连+广播,形成抖动循环)
    this.sendToDevice(id, { type: "unpair-notify", fromId: this.deviceId });
    this.paired = this.paired.filter((p) => p.id !== id);
    this.wsClients.get(id)?.close();
    this.inboundSockets.get(id)?.close();
    this.wsClients.delete(id);
    this.inboundSockets.delete(id);
    this.savePaired();
    // 重建 scanner:清 bonjour Browser 内部去重缓存(browser 按 fqdn 去重,
    // 只删 discovered 会导致对方重新广播时不触发 up 回调,自动扫描扫不出)
    // 无已配对设备 → 停广播(常态静默)
    this.emit("devices-changed");
  }

  // ── 广播/扫描（mDNS） ──
  // 注意:mDNS 通告由协议层自动持续广播,应用只需 publish 一次——反复 publish 同名服务会报
  // "Service name is already in use on the network"(实测踩坑)。配对期 2s 的"通告间隔"由协议维护。
  // 扫描策略(用户定稿):无自动扫描,仅手动——设备互联场景低频,需要时点一次
  // 手动扫描 = 3s 收集窗口(browser 持续监听,窗口后 stop),结束后列表不再自动更新。

  /** 手动扫描:清空列表 → 3s 收集窗口 → 停止。
      不常驻监听(设备互联低频场景);已配对设备在线/离线仍由 WS 连接状态驱动 */
  private scanner: import("bonjour-service").Browser | null = null;
  rescan(): void {
    this.discovered.clear();
    try { this.scanner?.stop(); } catch { /* 忽略 */ }
    try {
      this.scanner = this.bonjour.find({ type: SERVICE_TYPE }, (service) => {
        const id = (service.txt?.id as string) ?? "";
        const name = (service.txt?.name as string) ?? service.name;
        if (!id || id === this.deviceId) return;
        const addr = pickBestAddress(service.addresses ?? []);
        if (!addr) return;
        this.discovered.set(id, { id, name, address: addr, port: service.port ?? WS_PORT });
        this.emit("devices-changed");
      });
    } catch { /* 扫描失败忽略 */ }
    // 3s 收集窗口后停止(扫描结束,列表定格)
    setTimeout(() => {
      try { this.scanner?.stop(); } catch { /* 忽略 */ }
      this.scanner = null;
      this.emit("devices-changed");
    }, 3000);
  }

  /** 本机真实局域网 IPv4(排除回环/APIPA/虚拟网卡段 172.16-31)——广播 host 用 */
  private getRealIPv4(): string | undefined {
    try {
      for (const addrs of Object.values(os.networkInterfaces())) {
        for (const a of addrs ?? []) {
          if (a.family !== "IPv4" || a.internal) continue;
          const first = a.address.split(".")[0];
          const second = Number(a.address.split(".")[1] ?? 0);
          if (first === "127" || first === "169") continue;
          if (first === "172" && second >= 16 && second <= 31) continue;
          return a.address;
        }
      }
    } catch { /* 忽略 */ }
    return undefined;
  }

  /** 广播自己(可被发现开关/配对模式/断线重连触发)。只 publish,不碰扫描 */
  private startAdvertising(): void {
    if (this.advertiseService) return;
    try {
      // 服务名带设备名,对端可读;txt 携带设备 UUID(认 ID 不认 IP)。
      // host 指定本机真实局域网 IP——否则 win 多网卡(Hyper-V/WSL)会连虚拟网卡地址一起上报,
      // 对端取到 172.x 连不上(实测踩坑)
      // probe: false——跳过冲突探测。反复 stop/start(断线重连)时旧服务未注销完,
      // probe 探测同名冲突 → bonjour 内部 console.log 报错刷屏(无法捕获);跳过探测直接
      // announce,单设备固定服务名冲突概率低且无害
      const realIp = this.getRealIPv4();
      this.advertiseService = this.bonjour.publish({
        name: `${this.deviceName} (EM)`,
        type: SERVICE_TYPE,
        port: this.listeningPort,
        host: realIp,
        probe: false,
        txt: { id: this.deviceId, name: this.deviceName },
      });
    } catch (e) {
      console.error("[network] mDNS 发布失败:", (e as Error).message);
    }
  }

  /** 停止广播(Service.stop 发送 goodbye 包,对端立即感知离线)。扫描保持运行 */
  private stopAdvertising(): void {
    try { this.advertiseService?.stop(); } catch { /* */ }
    this.advertiseService = null;
  }

  // ── 连接管理 ──

  /** 建立出站连接（连接已配对设备）。成功:更新缓存地址 + 停重连广播;失败:无 mDNS 回退时触发短时广播 */
  private async connectOutbound(p: PairedDevice, address: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        const ws = new WebSocket(`ws://${address}:${port}`);
        ws.on("open", () => {
          // 连接成功 → 更新缓存地址(IP 可能已变),持久化
          p.address = address;
          p.port = port;
          this.savePaired();
          this.wsClients.set(p.id, ws);
          // challenge 认证:共享密钥加密的随机串,对方解密成功 = 持有密钥(不传明文 key)
          ws.send(JSON.stringify({
            type: "hello",
            fromId: this.deviceId,
            fromName: this.deviceName,
            challenge: makeChallenge(Buffer.from(p.key, "base64")),
          }));
          this.markOnline(p.id);
          if (!settled) { settled = true; resolve(); }
        });
        ws.on("close", () => {
          this.wsClients.delete(p.id);
          // 仅"此前已连接"的断开才触发重连(防连接失败的 error→close 双触发成环)
          if (settled) this.markOffline(p.id);
        });
        ws.on("error", (e) => {
          if (!settled) {
            settled = true;
            // 连接失败日志:ECONNREFUSED=防火墙拦/端口未监听,ETIMEDOUT=不可达
            console.error(`[network] 连接 ${p.name} (${address}:${port}) 失败:`, (e as Error).message);
            // 有离线已配对 → 持续广播(对方随时能发现我们并重连,蓝牙手表语义)
            reject(e);
          }
        });
        ws.on("message", (data: Buffer) => {
          try {
            // 出站连接也走统一协议处理(hello-ack/unpair-notify 等)——保证双向对等
            this.handlePeerMessage("", ws, { id: p.id }, JSON.parse(data.toString()));
          } catch { /* 非 JSON 消息忽略 */ }
        });
        setTimeout(() => { if (!settled) { settled = true; reject(new Error("连接超时")); } }, 5000);
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * 统一协议消息处理(入站/出站连接共用——保证双向对等,不区分谁主动连接)。
   * peerIdRef: 出站连接是固定的 p.id,入站连接由 hello 消息确定(可变引用)。
   */
  private handlePeerMessage(peerAddr: string, ws: WebSocket, peerIdRef: { id: string }, msg: Record<string, unknown>): void {
    const fromId = String(msg.fromId ?? "");
    if (msg.type === "pair-request") {
      // 对方请求配对 → 暂存对方公钥(acceptPair 派生共享密钥用) + 通知 UI 弹窗确认
      const pub = String(msg.publicKey ?? "");
      if (pub) this.pendingPeerKeys.set(fromId, pub);
      this.emit("pair-request", {
        id: fromId, name: String(msg.fromName ?? ""), address: peerAddr.replace("::ffff:", ""), port: WS_PORT,
      });
      ws.close();
    } else if (msg.type === "pair-accept") {
      // 对方接受了我们的配对请求(A 端):用暂存私钥 + 对方公钥派生共享密钥。
      // 注意:此连接是对方 sendRaw 短连接(发完即关),不能存 inboundSockets——
      // 对方 acceptPair 会紧接着 connectOutbound 发 hello,在 hello 分支建立真正的长连接
      const myPrivate = this.pendingOwnKeys.get(fromId);
      const peerPub = String(msg.publicKey ?? "");
      if (!myPrivate || !peerPub) {
        ws.close();
        return;
      }
      const sharedKey = deriveSharedKey(myPrivate, peerPub);
      const keyB64 = sharedKey.toString("base64");
      this.pendingOwnKeys.delete(fromId);
      const peerAddr4 = peerAddr.replace("::ffff:", "");
      this.paired = this.paired.filter((p) => p.id !== fromId);
      this.paired.push({
        id: fromId, name: String(msg.fromName ?? ""), key: keyB64,
        pairedAt: Date.now(), lastSeen: Date.now(),
        address: peerAddr4, port: WS_PORT,
      });
      this.savePaired();
      this.emit("devices-changed");
      ws.close();
    } else if (msg.type === "hello") {
      // 已配对设备发起连接 → challenge 认证:解密成功 = 持有共享密钥(不再明文传 key)
      const p = this.paired.find((x) => x.id === fromId);
      const challenge = msg.challenge as { iv: string; tag: string; data: string } | undefined;
      const okAuth = p && challenge && decrypt(Buffer.from(p.key, "base64"), challenge) !== null;
      if (!okAuth) {
        // 认证失败/无记录 = 对方侧配对已失效(被解除)或密钥不符 → 拒绝
        ws.close();
        if (p) {
          this.paired = this.paired.filter((x) => x.id !== fromId);
          this.savePaired();
          this.emit("devices-changed");
        }
        return;
      }
      // 记录对端地址(连接建立时拿到)——重启后自动重连用,IP 可能已变
      const peerAddr4 = peerAddr.replace("::ffff:", "");
      p.address = peerAddr4;
      p.port = WS_PORT;
      this.savePaired();
      peerIdRef.id = fromId;
      // 入站连接:对端连我 → 存 inboundSockets;出站连接:我连对端 → wsClients 已有
      if (!this.wsClients.has(fromId)) {
        this.inboundSockets.set(fromId, ws);
      }
      this.markOnline(fromId);
      ws.send(JSON.stringify({ type: "hello-ack" }));
    } else if (msg.type === "hello-ack") {
      if (peerIdRef.id) this.markOnline(peerIdRef.id);
    } else if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
    } else if (msg.type === "pong") {
      // 心跳响应，保活
    } else if (msg.type === "unpair-notify") {
      // 对方解除配对 → 本端同步解除(删除记录/连接/发现缓存,停止重连尝试)
      this.paired = this.paired.filter((p) => p.id !== fromId);
      this.wsClients.get(fromId)?.close();
      this.inboundSockets.get(fromId)?.close();
      this.wsClients.delete(fromId);
      this.inboundSockets.delete(fromId);
      this.savePaired();
      this.emit("devices-changed");
    } else if (msg.type === "encrypted") {
      // 加密的应用消息(迁移数据等):用共享密钥解密后转发
      const p = this.paired.find((x) => x.id === peerIdRef.id || x.id === fromId);
      if (!p) return;
      const dec = decrypt(Buffer.from(p.key, "base64"), msg as { iv: string; tag: string; data: string });
      if (!dec) return;
      try {
        this.handleAppMessage(peerIdRef.id, JSON.parse(dec) as { type: string; [k: string]: unknown });
      } catch { /* 解密后非 JSON 忽略 */ }
    } else {
      this.handleAppMessage(peerIdRef.id, msg as { type: string; [k: string]: unknown });
    }
  }

  private handleInbound(ws: WebSocket, req: import("node:http").IncomingMessage): void {
    const peerAddr = req.socket.remoteAddress ?? "";
    const peerIdRef = { id: "" };
    ws.on("message", (data) => {
      try {
        this.handlePeerMessage(peerAddr, ws, peerIdRef, JSON.parse(data.toString()));
      } catch { /* 非 JSON 消息忽略 */ }
    });
    ws.on("close", () => {
      if (peerIdRef.id) {
        this.inboundSockets.delete(peerIdRef.id);
        this.markOffline(peerIdRef.id);
      }
    });
  }

  private markOnline(id: string): void {
    const p = this.paired.find((x) => x.id === id);
    if (p) {
      p.lastSeen = Date.now();
      this.savePaired();
    }
    // 连接建立 → 更新广播状态(全部连上则停广播;用户主动可被发现不受影响)
    this.emit("device-online", { id });
    this.emit("devices-changed");
  }

  private markOffline(id: string): void {
    // 连接断开 → ① 缓存地址直连重试 ② 有离线已配对 → 持续广播(蓝牙手表语义)
    const p = this.paired.find((x) => x.id === id);
    if (p && p.address && p.port && !this.wsClients.has(id) && !this.inboundSockets.has(id)) {
      this.connectOutbound(p, p.address, p.port).catch(() => {
      });
    }
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
  /** 向已配对设备发送消息。协议控制消息(心跳/解除等)明文;应用消息(迁移数据)加密 */
  sendToDevice(id: string, message: Record<string, unknown>): boolean {
    const ws = this.wsClients.get(id) ?? this.inboundSockets.get(id);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const p = this.paired.find((x) => x.id === id);
    // 明文协议消息:unpair-notify/ping 等(无敏感数据);其余(迁移 transfer-*)加密
    const isPlain = message.type === "unpair-notify" || message.type === "ping";
    if (!isPlain && p) {
      const enc = encrypt(Buffer.from(p.key, "base64"), JSON.stringify(message));
      ws.send(JSON.stringify({ type: "encrypted", ...enc }));
    } else {
      ws.send(JSON.stringify(message));
    }
    return true;
  }

  // ── 心跳与探测（常驻） ──

  /** 尝试连接已配对设备(启动/断线/离线探测共用)。
      优先缓存地址直连(对齐蓝牙已配对设备直接连接,无需对方可被发现);
      缓存地址缺失/直连失败且 mDNS 能发现时,用发现的地址连接。
      注意:不主动广播——广播仅在 connectOutbound 失败后由调用方触发(见 markOffline) */
  private tryConnectPaired(): void {
    for (const p of this.paired) {
      if (this.wsClients.has(p.id) || this.inboundSockets.has(p.id)) continue;
      // ① 缓存地址直连(IP 未变场景,常态重连走这条)
      if (p.address && p.port) {
        this.connectOutbound(p, p.address, p.port).catch(() => {
          // ② 缓存失败(IP 变化)→ 若有 mDNS 发现记录,用新地址重试
          const disc = this.discovered.get(p.id);
          if (disc) {
            this.connectOutbound(p, disc.address, disc.port).catch(() => { /* 仍失败,下轮再试 */ });
          }
        });
      } else {
        // 无缓存地址 → 等 mDNS 发现(有记录才连)
        const disc = this.discovered.get(p.id);
        if (disc) {
          this.connectOutbound(p, disc.address, disc.port).catch(() => { /* 失败,下轮再试 */ });
        }
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
      // 低频探测已配对设备:缓存直连 + 持续广播兜底(蓝牙手表语义——有离线已配对就一直播,
      // 对方上线即被发现;全部连上自动停)
      this.tryConnectPaired();
      // 已配对设备的"在线/离线"由 WS 连接状态驱动(markOnline/markOffline)——可靠。
      // 注意:不调 scanner.expire()——bonjour 对"无变化重播"不刷新 lastSeen(1h 才重播一次,
      // TTL 120s),expire 会误删在线设备(实测源码行为);下线靠 down 事件(goodbye 包)移除
    }, OFFLINE_PROBE_INTERVAL);
    // 启动时:缓存地址直连已配对设备 + 有离线者持续广播(对齐 WiFi 记住网络自动连 + 蓝牙可连接广播)
    setTimeout(() => {
      this.tryConnectPaired();
    }, 1000);
  }
}

/** 单例 */
export const networkService = new NetworkService();
