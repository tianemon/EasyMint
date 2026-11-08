import { EventEmitter } from "node:events";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import {
  computeRemoteSecret,
  decryptRemoteMessage,
  deriveRemoteKeys,
  encryptRemoteMessage,
  generateRemoteKeyPair,
  pairingCode,
  remoteProof,
  type RemoteSessionKeys,
} from "./remote-crypto";
import {
  REMOTE_PROTOCOL_VERSION,
  remoteCommandEnvelopeSchema,
  type RemoteCommandEnvelope,
  type RemoteEnvelope,
} from "../../shared/remote-protocol";
import type { AppEvent } from "./app-event-bus";
import { appEventBus } from "./app-event-bus";
import { emHome } from "../utils/paths";

const DEFAULT_PORT = 47_778;
const OFFER_TTL_MS = 60_000;
const PAIR_REQUEST_TTL_MS = 60_000;
const MAX_CONNECTIONS = 8;
// 附件命令经历「文件 base64 → 加密包再次 base64」，15 MB 原始附件最终约 27 MB。
const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;
const PAIRED_MOBILE_FILE = path.join(emHome(), "paired-mobile-devices.json");

interface StoredMobileDevice {
  id: string;
  name: string;
  sharedSecret: string;
  pairedAt: number;
  lastSeen: number;
}

/**
 * 配对二维码载荷：紧凑数组形态（顺序即协议）。
 * 只带**一个地址**——用户在面板上选了哪个 IP，二维码就指哪个；多网卡全塞进去会让
 * 二维码显著变密，而扫码那一刻只会连其中一个。
 */
export function packPairingPayload(offer: {
  token: string; pcId: string; pcName: string; addresses: string[]; port: number;
  publicKey: string; expiresAt: number;
}): unknown[] {
  return [
    REMOTE_PROTOCOL_VERSION, offer.token, offer.pcId, offer.pcName,
    offer.addresses, offer.port, offer.publicKey, offer.expiresAt,
  ];
}

/** 兼容读：数组（新）与对象（旧桌面版）都能解出同一组字段。 */
export function unpackPairingPayload(encoded: string): {
  version: number; token: string; pcId: string; pcName: string; addresses: string[];
  port: number; publicKey: string; expiresAt: number;
} {
  const value: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (Array.isArray(value)) {
    const [version, token, pcId, pcName, addresses, port, publicKey, expiresAt] = value;
    return {
      version: Number(version), token: String(token), pcId: String(pcId), pcName: String(pcName),
      addresses: Array.isArray(addresses) ? addresses.map(String) : [],
      port: Number(port), publicKey: String(publicKey), expiresAt: Number(expiresAt),
    };
  }
  const item = value as Record<string, unknown>;
  return {
    version: Number(item.version), token: String(item.token), pcId: String(item.pcId),
    pcName: String(item.pcName), addresses: Array.isArray(item.addresses) ? item.addresses.map(String) : [],
    port: Number(item.port), publicKey: String(item.publicKey), expiresAt: Number(item.expiresAt),
  };
}

export interface MobileDeviceSummary {
  id: string;
  name: string;
  pairedAt: number;
  lastSeen: number;
  online: boolean;
}

export interface MobilePairingOffer {
  uri: string;
  /** 完整载荷的 base64url（网页短码链路要把它登记进同源查表，不走二维码） */
  payload: string;
  token: string;
  pcId: string;
  pcName: string;
  addresses: string[];
  port: number;
  publicKey: string;
  expiresAt: number;
}

export interface MobilePairRequest {
  requestId: string;
  deviceId: string;
  deviceName: string;
  verificationCode: string;
  expiresAt: number;
}

interface PairingOfferState extends MobilePairingOffer {
  privateKey: crypto.ECDH;
}

/** App 二维码短码：只活 60 秒，扫到后由手机连上来换取完整 offer。 */
interface CompactOfferEntry {
  token: string;
  expiresAt: number;
}

interface PendingPairRequest extends MobilePairRequest {
  token: string;
  socket: WebSocket;
  sharedSecret: Buffer;
  keys: RemoteSessionKeys;
  timer: NodeJS.Timeout;
}

interface AuthenticatedConnection {
  socket: WebSocket;
  deviceId: string;
  connectionId: string;
  keys: RemoteSessionKeys;
  receivedSequence: number;
  sentSequence: number;
}

interface CachedCommandResult {
  expiresAt: number;
  payload: unknown;
  projectId?: string;
  sessionId?: string;
}

export type RemoteCommandHandler = (
  deviceId: string,
  command: RemoteCommandEnvelope,
) => Promise<unknown>;

function timingSafeEqualBase64(actual: string, expected: string): boolean {
  try {
    const a = Buffer.from(actual, "base64");
    const b = Buffer.from(expected, "base64");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** 局域网 IPv4（私有地址段），供手机 WS 配对与手机网页静态服务的 Host/CSP 白名单共用。 */
export function lanAddresses(): string[] {
  const result = new Set<string>();
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      const [a, b] = entry.address.split(".").map(Number);
      const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
      if (isPrivate) result.add(entry.address);
    }
  }
  return [...result];
}

/** 只转发手机端首版需要的事件，避免把主进程内部广播或本机路径意外暴露出去。每次连接都重建是浪费。 */
const FORWARDED_APP_EVENTS = new Set([
  "agent:stream",
  // 回合结束的权威信号：桌面端靠它清 busy，手机端靠它清「打断按钮」（turn_end 只在部分路径广播）
  "agent:exit",
  "agent:ask-request",
  "agent:ask-closed",
  "agent:model-changed",
  "agent:thinking-level-changed",
  "agent:context-usage",
  "agent:context-summarizing",
  "agent:chat-session",
  "agent:chat-closed",
  "agent:remote-settings-changed",
  "agent:shell-count",
  "agent:shell-output",
  "agent:delegation-count",
  "agent:delegation-init",
  "agent:delegation-progress",
  "session:list-changed",
  "project:open-windows-changed",
]);

export class RemoteTerminalService extends EventEmitter {
  private server: WebSocketServer | null = null;
  private startPromise: Promise<void> | null = null;
  private offers = new Map<string, PairingOfferState>();
  /** App 二维码短码 → offer token。手机扫到码后连上来用它换完整 offer。 */
  private compactOffers = new Map<string, CompactOfferEntry>();
  /** 每条未认证连接试过几次短码（限次防穷举：6 位码不设上限就能当字典试）。 */
  private lookupAttempts = new Map<WebSocket, number>();
  /**
   * 设备准入：App 开关管非 web- 设备，浏览器开关管 web- 设备。
   * 端口是两条通道共享的（浏览器也走 47778），开关的差异只能落在准入上。
   */
  private accessPolicy = { allowApp: true, allowWeb: true };
  private pendingPairs = new Map<string, PendingPairRequest>();
  private connections = new Map<WebSocket, AuthenticatedConnection>();
  private devices: StoredMobileDevice[] = [];
  private commandResults = new Map<string, CachedCommandResult>();
  private projectSubscriptions = new Map<string, Set<string>>();
  private sessionSubscriptions = new Map<string, Set<string>>();
  private subscriptionVersions = new Map<string, number>();
  private lastSessionSelection = new Map<string, { connectionId: string; sequence: number }>();
  private readonly pcId: string;

  constructor(
    private readonly commandHandler: RemoteCommandHandler,
    // port 需要在变端口时改写（setPort 先 close 再换值），所以不能是 readonly
    private options: { port?: number; pairedFile?: string } = {},
  ) {
    super();
    this.pcId = crypto.createHash("sha256").update(`${os.hostname()}:${os.userInfo().username}`).digest("hex").slice(0, 32);
    this.loadDevices();
  }

  async ensureStarted(): Promise<void> {
    if (this.server) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise<void>((resolve, reject) => {
      const server = new WebSocketServer({
        host: "0.0.0.0",
        port: this.options.port ?? DEFAULT_PORT,
        maxPayload: MAX_PAYLOAD_BYTES,
        perMessageDeflate: false,
      });
      const onError = (error: Error) => {
        this.startPromise = null;
        reject(error);
      };
      server.once("error", onError);
      server.once("listening", () => {
        server.off("error", onError);
        server.on("error", (error) => this.emit("error", error));
        this.server = server;
        this.startPromise = null;
        // Windows 防火墙:不监听就没提示,但这里监听是懒启动(点「扫码配对」才 listen),
        // 所以提示发在 listening 之后——否则用户点了配对、端口被拦,界面上什么都没有。
        // 与 network-service 的同名事件一样由 ipc-handlers 用 once 接,只广播一次。
        if (process.platform === "win32") this.emit("firewall-hint", { port: this.listeningPort() });
        resolve();
      });
      server.on("connection", (socket) => this.handleConnection(socket));
    });
    return this.startPromise;
  }

  async createPairingOffer(preferredHost?: string): Promise<MobilePairingOffer> {
    await this.ensureStarted();
    this.pruneExpired();
    const token = crypto.randomBytes(24).toString("base64url");
    const pair = generateRemoteKeyPair();
    const offer: PairingOfferState = {
      uri: "",
      payload: "",
      token,
      pcId: this.pcId,
      pcName: os.hostname(),
      // 只带选中那个地址：多网卡全塞进二维码会显著变密，而扫码时只会连其中一个
      addresses: preferredHost ? [preferredHost] : lanAddresses(),
      port: this.listeningPort(),
      publicKey: pair.publicKey,
      expiresAt: Date.now() + OFFER_TTL_MS,
      privateKey: pair.privateKey,
    };
    // 载荷用**紧凑数组**而不是对象：二维码里每多一个字节，模块就多一行，扫起来更吃力。
    // 字段名('version'/'addresses'…) 与引号在这里纯属开销，去掉后 base64 长度少约三成。
    // 顺序即协议：[version, token, pcId, pcName, addresses, port, publicKey, expiresAt]。
    // App 侧解析同时兼容旧的对象形态（老版本桌面生成的码仍可扫）。
    const encoded = Buffer.from(JSON.stringify(packPairingPayload(offer)), "utf8").toString("base64url");
    offer.payload = encoded;
    this.offers.set(token, offer);
    // 二维码只放「地址 + 端口 + 6 位短码」：完整载荷（公钥 44 + token 32 + pcId 32 …）
    // 塞进码里会让模块数翻倍，比浏览器二维码密一倍，扫起来明显更吃力。
    // 手机扫到后连上来用短码换完整载荷（见 handlePairLookup），通道仍是 47778，不依赖网页服务。
    const host = offer.addresses[0] ?? "";
    // 没有局域网地址就生成不出能扫的码（`h=` 空值会让手机判成「不是配对二维码」）。
    // 这里直接失败，界面显示「没有可用的局域网地址」，比给一张坏码清楚。
    if (!host) return Promise.reject(new Error("电脑没有可用的局域网地址"));
    const code = this.registerCompactOffer(token, offer.expiresAt);
    offer.uri = `easymint://pair?h=${encodeURIComponent(host)}&p=${offer.port}&c=${code}`;
    return this.publicOffer(offer);
  }

  listDevices(): MobileDeviceSummary[] {
    const online = new Set([...this.connections.values()].map((connection) => connection.deviceId));
    return this.devices.map(({ sharedSecret: _secret, ...device }) => ({
      ...device,
      online: online.has(device.id),
    }));
  }

  listPendingPairs(): MobilePairRequest[] {
    this.pruneExpired();
    return [...this.pendingPairs.values()].map(({ requestId, deviceId, deviceName, verificationCode, expiresAt }) => ({
      requestId, deviceId, deviceName, verificationCode, expiresAt,
    }));
  }

  acceptPair(requestId: string): boolean {
    const pending = this.pendingPairs.get(requestId);
    if (!pending || pending.expiresAt <= Date.now() || pending.socket.readyState !== WebSocket.OPEN) return false;
    if (!this.isDeviceAllowed(pending.deviceId)) return false;
    clearTimeout(pending.timer);
    this.pendingPairs.delete(requestId);
    this.devices = this.devices.filter((device) => device.id !== pending.deviceId);
    this.devices.push({
      id: pending.deviceId,
      name: pending.deviceName,
      sharedSecret: pending.sharedSecret.toString("base64"),
      pairedAt: Date.now(),
      lastSeen: Date.now(),
    });
    this.saveDevices();
    pending.socket.send(JSON.stringify({
      type: "mobile-pair-accepted",
      pcId: this.pcId,
      proof: remoteProof(pending.keys.auth, `pair-accepted:${pending.token}:${pending.deviceId}`),
    }));
    pending.socket.close(1000, "paired");
    this.emit("devices-changed");
    return true;
  }

  rejectPair(requestId: string): boolean {
    const pending = this.pendingPairs.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingPairs.delete(requestId);
    if (pending.socket.readyState === WebSocket.OPEN) {
      pending.socket.send(JSON.stringify({ type: "mobile-pair-rejected" }));
      pending.socket.close(1008, "pairing rejected");
    }
    this.emit("pair-requests-changed");
    return true;
  }

  revokeDevice(deviceId: string): boolean {
    const existed = this.devices.some((device) => device.id === deviceId);
    this.devices = this.devices.filter((device) => device.id !== deviceId);
    this.projectSubscriptions.delete(deviceId);
    this.sessionSubscriptions.delete(deviceId);
    this.subscriptionVersions.delete(deviceId);
    this.lastSessionSelection.delete(deviceId);
    for (const [socket, connection] of this.connections) {
      if (connection.deviceId !== deviceId) continue;
      this.connections.delete(socket);
      socket.close(1008, "device revoked");
    }
    if (existed) {
      this.saveDevices();
      this.emit("devices-changed");
    }
    return existed;
  }

  sendEvent(deviceId: string, channel: string, data: unknown, projectId?: string, sessionId?: string): void {
    for (const connection of this.connections.values()) {
      if (connection.deviceId !== deviceId) continue;
      this.sendEncrypted(connection, {
        version: REMOTE_PROTOCOL_VERSION,
        connectionId: connection.connectionId,
        sequence: 0,
        sentAt: Date.now(),
        kind: "event",
        projectId,
        sessionId,
        payload: { channel, data },
      });
    }
  }

  /** 只转发手机端首版需要的事件，避免把主进程内部广播或本机路径意外暴露出去。 */
  forwardAppEvent(event: AppEvent): void {
    if (!FORWARDED_APP_EVENTS.has(event.channel)) return;
    const raw = typeof event.data === "object" && event.data !== null
      ? event.data as Record<string, unknown>
      : {};
    const sessionId = typeof raw.sessionId === "string" ? raw.sessionId : undefined;
    const projectId = typeof raw.projectId === "string" ? raw.projectId : undefined;
    // chat-session 带有本机绝对 projectPath；远程端只需要 projectId/sessionId，明确移除路径。
    const baseData = event.channel === "agent:chat-session"
      ? Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "projectPath"))
      : event.data;
    // 以下脱敏与「哪台设备」无关，提到连接循环外只算一次；但原实现是在循环体内算的，
    // 循环不执行（零连接）就一次都不算——这里也必须门控，否则畸形载荷（如 tasks 含 null 元素）
    // 会在零连接时因解构抛异常，与改动前不等价。
    // shell-count 的 logPath 剥离、delegation-init 的 prompt 剥离、delegation-progress 的
    // sessionFile/prompt 剥离都与连接无关；而「按订阅会话过滤」依赖 subscribedSessions（每连接不同），
    // 必须留在循环内（见下方 agent:shell-count / agent:delegation-count 分支）。
    const hasConnections = this.connections.size > 0;
    const sanitizedShellItems = hasConnections && event.channel === "agent:shell-count" && Array.isArray(baseData)
      ? baseData
          .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
          .map((item) => {
            const { logPath: _logPath, ...safe } = item;
            return safe;
          })
      : null;
    const delegationInitData = hasConnections && event.channel === "agent:delegation-init"
      ? { ...raw, tasks: Array.isArray(raw.tasks) ? raw.tasks.map((item) => {
          const { prompt: _prompt, ...safe } = item as Record<string, unknown>;
          return safe;
        }) : [] }
      : null;
    const delegationProgressData = hasConnections && event.channel === "agent:delegation-progress"
      ? (() => {
          const progress = typeof raw.progress === "object" && raw.progress !== null ? raw.progress as Record<string, unknown> : {};
          const { sessionFile: _sessionFile, prompt: _prompt, ...safeProgress } = progress;
          return { ...raw, progress: safeProgress };
        })()
      : null;
    for (const connection of this.connections.values()) {
      const subscribedSessions = this.sessionSubscriptions.get(connection.deviceId) ?? new Set<string>();
      let data = baseData;
      if (event.channel === "agent:shell-count") {
        data = sanitizedShellItems
          ? sanitizedShellItems.filter((item) => subscribedSessions.has(String(item.sessionId ?? "")))
          : baseData;
      } else if (event.channel === "agent:delegation-count") {
        const summary = typeof baseData === "object" && baseData !== null ? baseData as Record<string, unknown> : {};
        const tasks = Array.isArray(summary.tasks) ? summary.tasks.filter((item) =>
          typeof item === "object" && item !== null && subscribedSessions.has(String((item as { sessionId?: unknown }).sessionId ?? ""))) : [];
        data = { count: new Set(tasks.map((item) => (item as { delegationId?: unknown }).delegationId)).size, tasks };
      } else if (event.channel === "agent:delegation-init") {
        data = delegationInitData!;
      } else if (event.channel === "agent:delegation-progress") {
        data = delegationProgressData!;
      }
      const sessionAllowed = sessionId && this.sessionSubscriptions.get(connection.deviceId)?.has(sessionId);
      const projectAllowed = projectId && this.projectSubscriptions.get(connection.deviceId)?.has(projectId);
      const globalEvent = event.channel === "project:open-windows-changed";
      const filteredTaskEvent = event.channel === "agent:shell-count" || event.channel === "agent:delegation-count";
      // 流式正文与后台命令输出是高频大载荷（每帧带全量累计正文）：只认「会话订阅」，**项目订阅不放行**。
      // 手机端在首页拉一次会话列表（带 projectId）就会拿到项目订阅；若这里按项目放行，PC 一边输出
      // 就会把整条流推给没打开该会话的手机——手机侧要逐帧解密+解析（纯 JS AES-GCM），JS 线程被吃死，
      // 表现为：启动转圈半天加载不出来、聊天页能上下滑动但点不动。
      // 手机打开会话会走 session.snapshot 补订会话，切回时也会重取快照，不会丢内容。
      const payloadHeavy = event.channel === "agent:stream" || event.channel === "agent:shell-output";
      if (payloadHeavy
        ? !sessionAllowed
        : (!sessionAllowed && !projectAllowed && !globalEvent && !filteredTaskEvent)) continue;
      this.sendEncrypted(connection, {
        version: REMOTE_PROTOCOL_VERSION,
        connectionId: connection.connectionId,
        sequence: 0,
        sentAt: Date.now(),
        kind: "event",
        projectId,
        sessionId,
        payload: { channel: event.channel, data, eventSequence: event.sequence, emittedAt: event.emittedAt },
      });
    }
  }

  /**
   * 更新设备准入并断开不再允许的连接。
   * 只关掉开关不等于断开：已经连上的设备会在下一次事件里继续收数据，必须主动踢。
   */
  setAccessPolicy(policy: { allowApp: boolean; allowWeb: boolean }): void {
    this.accessPolicy = { ...policy };
    for (const [socket, connection] of this.connections) {
      if (this.isDeviceAllowed(connection.deviceId)) continue;
      this.connections.delete(socket);
      socket.close(1008, "channel disabled");
    }
    this.emit("devices-changed");
  }

  private isDeviceAllowed(deviceId: string): boolean {
    return deviceId.startsWith("web-") ? this.accessPolicy.allowWeb : this.accessPolicy.allowApp;
  }

  /** 是否正在监听端口（开关面板用它显示状态；不监听时端口应被真正释放）。 */
  isRunning(): boolean {
    return this.server !== null;
  }

  /** 对外暴露实际端口（未监听时退回配置值，界面拿它显示「将使用 47778」）。 */
  listeningPortNumber(): number {
    return this.listeningPort();
  }

  /**
   * 换端口：先释放旧监听，再按新端口重新起来。
   * 已配对手机凭证里存的是旧端口，换端口后它们连不上——界面上要提示重新配对，
   * 这里不替用户做迁移。
   */
  async setPort(port: number): Promise<void> {
    if (this.options.port === port) return;
    const wasRunning = this.isRunning();
    this.close();
    this.options.port = port;
    if (wasRunning) await this.ensureStarted();
  }

  /**
   * 停止监听并断开所有连接。可重复调用；之后再 ensureStarted() 能重新起来。
   * 订阅表一并清空：订阅只对「当前这条连接」有意义，留着旧集合会让重连后的设备
   * 收到它已经关掉的会话的事件。
   */
  close(): void {
    for (const pending of this.pendingPairs.values()) clearTimeout(pending.timer);
    this.pendingPairs.clear();
    this.offers.clear();
    this.compactOffers.clear();
    this.lookupAttempts.clear();
    for (const socket of this.connections.keys()) socket.close(1001, "server shutdown");
    this.connections.clear();
    this.projectSubscriptions.clear();
    this.sessionSubscriptions.clear();
    this.subscriptionVersions.clear();
    this.lastSessionSelection.clear();
    this.server?.close();
    // close() 只发起关闭，句柄仍在；置空后才能重新 ensureStarted（否则会提前 return）
    this.server = null;
    this.startPromise = null;
  }

  private handleConnection(socket: WebSocket): void {
    if (this.connections.size >= MAX_CONNECTIONS) {
      socket.close(1013, "too many connections");
      return;
    }
    socket.on("message", (raw) => {
      if (typeof raw !== "string" && !Buffer.isBuffer(raw) && !Array.isArray(raw)) return;
      let message: Record<string, unknown>;
      try { message = JSON.parse(raw.toString()) as Record<string, unknown>; } catch { return; }
      const connection = this.connections.get(socket);
      if (connection) {
        void this.handleAuthenticatedMessage(connection, message);
      } else if (message.type === "mobile-pair-lookup") {
        this.handlePairLookup(socket, message);
      } else if (message.type === "mobile-pair-init") {
        this.handlePairInit(socket, message);
      } else if (message.type === "mobile-hello") {
        this.handleHello(socket, message);
      } else {
        socket.close(1008, "authentication required");
      }
    });
    socket.on("close", () => {
      this.lookupAttempts.delete(socket);
      const connection = this.connections.get(socket);
      if (connection) {
        this.connections.delete(socket);
        this.emit("devices-changed");
      }
      for (const [requestId, pending] of this.pendingPairs) {
        if (pending.socket !== socket) continue;
        clearTimeout(pending.timer);
        this.pendingPairs.delete(requestId);
        this.emit("pair-requests-changed");
      }
    });
  }

  /**
   * App 二维码的短码查表：手机扫到 `easymint://pair?h=&p=&c=` 后，连上 ws 发一条
   * `mobile-pair-lookup`，这里把完整载荷回给它。载荷里仍是**一次性 token**，
   * 手机拿到后再发 `mobile-pair-init`（同一连接），配对语义与长码完全一致。
   * 只回载荷、不消耗短码：手机可能因为没收到响应而重试，消费放在 init 那一步。
   */
  private handlePairLookup(socket: WebSocket, message: Record<string, unknown>): void {
    this.pruneExpired();
    // 短码只有 6 位：不设上限的话，一个连接可以在这 60 秒里把码表当字典猛试。
    // 正常手机只发一次，5 次足够覆盖重试。
    const attempts = (this.lookupAttempts.get(socket) ?? 0) + 1;
    this.lookupAttempts.set(socket, attempts);
    if (attempts > 5) {
      this.lookupAttempts.delete(socket);
      socket.close(1008, "too many pairing lookups");
      return;
    }
    const code = typeof message.code === "string" ? message.code.trim().toUpperCase() : "";
    const entry = code ? this.compactOffers.get(code) : undefined;
    const offer = entry ? this.offers.get(entry.token) : undefined;
    if (!offer || offer.expiresAt <= Date.now()) {
      socket.send(JSON.stringify({ type: "mobile-pair-lookup-failed", reason: "expired" }));
      return;
    }
    socket.send(JSON.stringify({ type: "mobile-pair-offer", payload: offer.payload }));
  }

  private handlePairInit(socket: WebSocket, message: Record<string, unknown>): void {
    this.pruneExpired();
    const token = typeof message.token === "string" ? message.token : "";
    const deviceId = typeof message.deviceId === "string" ? message.deviceId.slice(0, 128) : "";
    const deviceName = typeof message.deviceName === "string" ? message.deviceName.slice(0, 80) : "";
    const publicKey = typeof message.publicKey === "string" ? message.publicKey : "";
    if (deviceId && !this.isDeviceAllowed(deviceId)) {
      socket.close(1008, "channel disabled");
      return;
    }
    const offer = this.offers.get(token);
    if (!offer || !deviceId || !deviceName || !publicKey || offer.expiresAt <= Date.now()) {
      socket.close(1008, "invalid pairing offer");
      return;
    }
    try {
      const sharedSecret = computeRemoteSecret(offer.privateKey, publicKey);
      const keys = deriveRemoteKeys(sharedSecret);
      const requestId = crypto.randomUUID();
      const expiresAt = Date.now() + PAIR_REQUEST_TTL_MS;
      const timer = setTimeout(() => this.rejectPair(requestId), PAIR_REQUEST_TTL_MS);
      this.offers.delete(token);
      this.pendingPairs.set(requestId, {
        requestId,
        deviceId,
        deviceName,
        verificationCode: pairingCode(keys.auth, token),
        expiresAt,
        token,
        socket,
        sharedSecret,
        keys,
        timer,
      });
      this.emit("pair-request", this.listPendingPairs().find((item) => item.requestId === requestId));
      this.emit("pair-requests-changed");
    } catch {
      socket.close(1008, "invalid public key");
    }
  }

  private handleHello(socket: WebSocket, message: Record<string, unknown>): void {
    const deviceId = typeof message.deviceId === "string" ? message.deviceId : "";
    const connectionId = typeof message.connectionId === "string" ? message.connectionId : "";
    const nonce = typeof message.nonce === "string" ? message.nonce : "";
    const proof = typeof message.proof === "string" ? message.proof : "";
    const device = this.devices.find((item) => item.id === deviceId);
    if (!device || !connectionId || !nonce || !proof) {
      socket.close(1008, "unknown device");
      return;
    }
    const keys = deriveRemoteKeys(Buffer.from(device.sharedSecret, "base64"));
    const expected = remoteProof(keys.auth, `hello:${deviceId}:${connectionId}:${nonce}`);
    if (!timingSafeEqualBase64(proof, expected)) {
      socket.close(1008, "authentication failed");
      return;
    }
    // 对应通道的开关关着就不放行：否则「关掉 App 通道」只是不主动监听，
    // 端口一旦因浏览器通道开着而在听，手机 App 照样能连进来。
    if (!this.isDeviceAllowed(deviceId)) {
      socket.close(1008, "channel disabled");
      return;
    }
    for (const [existingSocket, connection] of this.connections) {
      if (connection.deviceId === deviceId) existingSocket.close(1000, "replaced by new connection");
    }
    const connection: AuthenticatedConnection = {
      socket,
      deviceId,
      connectionId,
      keys,
      receivedSequence: 0,
      sentSequence: 0,
    };
    this.connections.set(socket, connection);
    device.lastSeen = Date.now();
    this.saveDevices();
    socket.send(JSON.stringify({
      type: "mobile-hello-ack",
      connectionId,
      proof: remoteProof(keys.auth, `hello-ack:${deviceId}:${connectionId}:${nonce}`),
    }));
    this.emit("devices-changed");
  }

  private async handleAuthenticatedMessage(
    connection: AuthenticatedConnection,
    message: Record<string, unknown>,
  ): Promise<void> {
    if (message.type !== "mobile-encrypted") return;
    const sequence = Number(message.sequence);
    if (!Number.isSafeInteger(sequence) || sequence !== connection.receivedSequence + 1) {
      connection.socket.close(1008, "invalid sequence");
      return;
    }
    const plaintext = decryptRemoteMessage(connection.keys.clientToServer, "c2s", connection.connectionId, {
      sequence,
      iv: String(message.iv ?? ""),
      tag: String(message.tag ?? ""),
      data: String(message.data ?? ""),
    });
    if (!plaintext) {
      connection.socket.close(1008, "decryption failed");
      return;
    }
    connection.receivedSequence = sequence;
    let command: RemoteCommandEnvelope;
    try {
      command = remoteCommandEnvelopeSchema.parse(JSON.parse(plaintext));
    } catch {
      connection.socket.close(1008, "invalid command");
      return;
    }
    if (command.connectionId !== connection.connectionId || command.sequence !== sequence) {
      connection.socket.close(1008, "envelope mismatch");
      return;
    }

    this.pruneCommandResults();
    const cacheKey = `${connection.deviceId}:${command.requestId}`;
    // 同一手机可能连续点开两个会话；较早的慢快照完成后不能把订阅切回旧会话。
    // session.list 也会由首页后台刷新发出，不能作废正在打开的会话快照。
    const navigation = command.payload.command === "session.snapshot" || command.payload.command === "session.send";
    const subscriptionVersion = navigation ? (this.subscriptionVersions.get(connection.deviceId) ?? 0) + 1 : undefined;
    if (subscriptionVersion !== undefined) this.subscriptionVersions.set(connection.deviceId, subscriptionVersion);
    let cached = this.commandResults.get(cacheKey);
    if (!cached) {
      try {
        const handled = await this.commandHandler(connection.deviceId, command);
        // 快照生成与订阅正式生效之间的帧从应用事件环形缓冲补齐；之后的新帧走实时订阅。
        const data = command.payload.command === "session.snapshot" && command.sessionId
          ? this.catchUpSnapshot(handled, command.sessionId)
          : handled;
        cached = {
          expiresAt: Date.now() + 10 * 60_000,
          payload: { ok: true, data },
          projectId: command.projectId,
          sessionId: command.sessionId,
        };
      } catch (error) {
        const e = error as Error & { code?: string };
        cached = {
          expiresAt: Date.now() + 10 * 60_000,
          payload: { ok: false, error: { code: e.code ?? "COMMAND_FAILED", message: e.message || "命令执行失败" } },
          projectId: command.projectId,
          sessionId: command.sessionId,
        };
      }
      this.commandResults.set(cacheKey, cached);
    }
    const result = cached.payload as { ok?: boolean; data?: unknown };
    if (result.ok && (subscriptionVersion === undefined || subscriptionVersion === this.subscriptionVersions.get(connection.deviceId))) {
      this.updateSubscriptions(connection.deviceId, command, result.data);
    }
    this.sendEncrypted(connection, {
      version: REMOTE_PROTOCOL_VERSION,
      connectionId: connection.connectionId,
      sequence: 0,
      sentAt: Date.now(),
      kind: "result",
      requestId: command.requestId,
      projectId: cached.projectId,
      sessionId: cached.sessionId,
      payload: cached.payload,
    });
  }

  private sendEncrypted(connection: AuthenticatedConnection, envelope: RemoteEnvelope): void {
    if (connection.socket.readyState !== WebSocket.OPEN) return;
    const sequence = ++connection.sentSequence;
    const normalized = { ...envelope, sequence, connectionId: connection.connectionId };
    const encrypted = encryptRemoteMessage(
      connection.keys.serverToClient,
      "s2c",
      connection.connectionId,
      sequence,
      JSON.stringify(normalized),
    );
    connection.socket.send(JSON.stringify({ type: "mobile-encrypted", ...encrypted }));
  }

  private catchUpSnapshot(result: unknown, sessionId: string): unknown {
    if (!result || typeof result !== "object") return result;
    const snapshot = result as Record<string, unknown>;
    const cursor = snapshot.eventSequence;
    if (typeof cursor !== "number" || !Array.isArray(snapshot.bufferedEvents)) return result;
    const missed = appEventBus.eventsAfter(cursor, (event) => {
      if (event.channel !== "agent:stream") return false;
      const data = event.data;
      return typeof data === "object" && data !== null && (data as { sessionId?: unknown }).sessionId === sessionId;
    });
    if (missed === null) throw new Error("快照期间事件缓冲已过期，请重新打开会话");
    return { ...snapshot, bufferedEvents: [...snapshot.bufferedEvents,
      ...missed.map((event) => ({ ...(event.data as Record<string, unknown>), eventSequence: event.sequence }))] };
  }

  private updateSubscriptions(deviceId: string, command: RemoteCommandEnvelope, result: unknown): void {
    const name = command.payload.command;
    if (name === "session.list") {
      const selected = this.lastSessionSelection.get(deviceId);
      // 较早发出的列表请求若晚于快照完成，不能再把项目订阅切回旧项目。
      if (selected?.connectionId === command.connectionId && command.sequence < selected.sequence) return;
      if (command.projectId) {
        // session.list 也可能是后台刷新；列表请求无权取消当前会话的实时订阅。
        this.projectSubscriptions.set(deviceId, new Set([command.projectId]));
      }
      return;
    }
    if (name !== "session.snapshot" && name !== "session.send") return;
    if (command.projectId) this.projectSubscriptions.set(deviceId, new Set([command.projectId]));
    const resultSessionId = typeof result === "object" && result !== null
      && typeof (result as { sessionId?: unknown }).sessionId === "string"
      ? (result as { sessionId: string }).sessionId
      : undefined;
    const sessionId = command.sessionId ?? resultSessionId;
    if (sessionId) {
      this.sessionSubscriptions.set(deviceId, new Set([sessionId]));
      this.lastSessionSelection.set(deviceId, { connectionId: command.connectionId, sequence: command.sequence });
    }
  }

  private publicOffer(offer: PairingOfferState): MobilePairingOffer {
    const { privateKey: _privateKey, ...publicOffer } = offer;
    return publicOffer;
  }

  private pairedFile(): string {
    return this.options.pairedFile ?? PAIRED_MOBILE_FILE;
  }

  private listeningPort(): number {
    const address = this.server?.address();
    return typeof address === "object" && address ? address.port : (this.options.port ?? DEFAULT_PORT);
  }

  private loadDevices(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.pairedFile(), "utf8"));
      if (Array.isArray(parsed)) this.devices = parsed;
    } catch {
      this.devices = [];
    }
  }

  private saveDevices(): void {
    const file = this.pairedFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(this.devices, null, 2), { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch { /* Windows 不支持 POSIX 权限，忽略 */ }
  }

  /** 6 位短码，去掉 0/O/1/I 等易混字符：用户可能得照着念/手输。 */
  private registerCompactOffer(token: string, expiresAt: number): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let attempt = 0; attempt < 8; attempt += 1) {
      code = Array.from(crypto.randomBytes(6), (byte) => alphabet[byte % alphabet.length]).join("");
      if (!this.compactOffers.has(code)) break;
    }
    this.compactOffers.set(code, { token, expiresAt });
    return code;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [token, offer] of this.offers) {
      if (offer.expiresAt <= now) this.offers.delete(token);
    }
    for (const [code, entry] of this.compactOffers) {
      if (entry.expiresAt <= now || !this.offers.has(entry.token)) this.compactOffers.delete(code);
    }
    for (const [requestId, pending] of this.pendingPairs) {
      if (pending.expiresAt <= now) this.rejectPair(requestId);
    }
  }

  private pruneCommandResults(): void {
    const now = Date.now();
    for (const [key, result] of this.commandResults) {
      if (result.expiresAt <= now) this.commandResults.delete(key);
    }
    if (this.commandResults.size <= 500) return;
    const overflow = this.commandResults.size - 500;
    for (const key of [...this.commandResults.keys()].slice(0, overflow)) this.commandResults.delete(key);
  }
}
