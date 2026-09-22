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

export interface MobileDeviceSummary {
  id: string;
  name: string;
  pairedAt: number;
  lastSeen: number;
  online: boolean;
}

export interface MobilePairingOffer {
  uri: string;
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

function lanAddresses(): string[] {
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

export class RemoteTerminalService extends EventEmitter {
  private server: WebSocketServer | null = null;
  private startPromise: Promise<void> | null = null;
  private offers = new Map<string, PairingOfferState>();
  private pendingPairs = new Map<string, PendingPairRequest>();
  private connections = new Map<WebSocket, AuthenticatedConnection>();
  private devices: StoredMobileDevice[] = [];
  private commandResults = new Map<string, CachedCommandResult>();
  private projectSubscriptions = new Map<string, Set<string>>();
  private sessionSubscriptions = new Map<string, Set<string>>();
  private readonly pcId: string;

  constructor(
    private readonly commandHandler: RemoteCommandHandler,
    private readonly options: { port?: number; pairedFile?: string } = {},
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

  async createPairingOffer(): Promise<MobilePairingOffer> {
    await this.ensureStarted();
    this.pruneExpired();
    const token = crypto.randomBytes(24).toString("base64url");
    const pair = generateRemoteKeyPair();
    const offer: PairingOfferState = {
      uri: "",
      token,
      pcId: this.pcId,
      pcName: os.hostname(),
      addresses: lanAddresses(),
      port: this.listeningPort(),
      publicKey: pair.publicKey,
      expiresAt: Date.now() + OFFER_TTL_MS,
      privateKey: pair.privateKey,
    };
    const encoded = Buffer.from(JSON.stringify({
      version: REMOTE_PROTOCOL_VERSION,
      token: offer.token,
      pcId: offer.pcId,
      pcName: offer.pcName,
      addresses: offer.addresses,
      port: offer.port,
      publicKey: offer.publicKey,
      expiresAt: offer.expiresAt,
    }), "utf8").toString("base64url");
    offer.uri = `easymint://pair?payload=${encoded}`;
    this.offers.set(token, offer);
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
    const allowed = new Set([
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
    if (!allowed.has(event.channel)) return;
    const raw = typeof event.data === "object" && event.data !== null
      ? event.data as Record<string, unknown>
      : {};
    const sessionId = typeof raw.sessionId === "string" ? raw.sessionId : undefined;
    const projectId = typeof raw.projectId === "string" ? raw.projectId : undefined;
    // chat-session 带有本机绝对 projectPath；远程端只需要 projectId/sessionId，明确移除路径。
    const baseData = event.channel === "agent:chat-session"
      ? Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "projectPath"))
      : event.data;
    for (const connection of this.connections.values()) {
      const subscribedSessions = this.sessionSubscriptions.get(connection.deviceId) ?? new Set<string>();
      let data = baseData;
      if (event.channel === "agent:shell-count" && Array.isArray(baseData)) {
        data = baseData
          .filter((item) => typeof item === "object" && item !== null && subscribedSessions.has(String((item as { sessionId?: unknown }).sessionId ?? "")))
          .map((item) => {
            const { logPath: _logPath, ...safe } = item as Record<string, unknown>;
            return safe;
          });
      } else if (event.channel === "agent:delegation-count") {
        const summary = typeof baseData === "object" && baseData !== null ? baseData as Record<string, unknown> : {};
        const tasks = Array.isArray(summary.tasks) ? summary.tasks.filter((item) =>
          typeof item === "object" && item !== null && subscribedSessions.has(String((item as { sessionId?: unknown }).sessionId ?? ""))) : [];
        data = { count: new Set(tasks.map((item) => (item as { delegationId?: unknown }).delegationId)).size, tasks };
      } else if (event.channel === "agent:delegation-init") {
        data = { ...raw, tasks: Array.isArray(raw.tasks) ? raw.tasks.map((item) => {
          const { prompt: _prompt, ...safe } = item as Record<string, unknown>;
          return safe;
        }) : [] };
      } else if (event.channel === "agent:delegation-progress") {
        const progress = typeof raw.progress === "object" && raw.progress !== null ? raw.progress as Record<string, unknown> : {};
        const { sessionFile: _sessionFile, prompt: _prompt, ...safeProgress } = progress;
        data = { ...raw, progress: safeProgress };
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

  close(): void {
    for (const pending of this.pendingPairs.values()) clearTimeout(pending.timer);
    this.pendingPairs.clear();
    this.offers.clear();
    for (const socket of this.connections.keys()) socket.close(1001, "server shutdown");
    this.connections.clear();
    this.server?.close();
    this.server = null;
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
      } else if (message.type === "mobile-pair-init") {
        this.handlePairInit(socket, message);
      } else if (message.type === "mobile-hello") {
        this.handleHello(socket, message);
      } else {
        socket.close(1008, "authentication required");
      }
    });
    socket.on("close", () => {
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

  private handlePairInit(socket: WebSocket, message: Record<string, unknown>): void {
    this.pruneExpired();
    const token = typeof message.token === "string" ? message.token : "";
    const deviceId = typeof message.deviceId === "string" ? message.deviceId.slice(0, 128) : "";
    const deviceName = typeof message.deviceName === "string" ? message.deviceName.slice(0, 80) : "";
    const publicKey = typeof message.publicKey === "string" ? message.publicKey : "";
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
    let cached = this.commandResults.get(cacheKey);
    if (!cached) {
      try {
        const data = await this.commandHandler(connection.deviceId, command);
        this.updateSubscriptions(connection.deviceId, command, data);
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

  private updateSubscriptions(deviceId: string, command: RemoteCommandEnvelope, result: unknown): void {
    if (command.projectId) {
      let projects = this.projectSubscriptions.get(deviceId);
      if (!projects) { projects = new Set(); this.projectSubscriptions.set(deviceId, projects); }
      projects.add(command.projectId);
    }
    const resultSessionId = typeof result === "object" && result !== null
      && typeof (result as { sessionId?: unknown }).sessionId === "string"
      ? (result as { sessionId: string }).sessionId
      : undefined;
    const sessionId = command.sessionId ?? resultSessionId;
    if (sessionId) {
      let sessions = this.sessionSubscriptions.get(deviceId);
      if (!sessions) { sessions = new Set(); this.sessionSubscriptions.set(deviceId, sessions); }
      sessions.add(sessionId);
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

  private pruneExpired(): void {
    const now = Date.now();
    for (const [token, offer] of this.offers) {
      if (offer.expiresAt <= now) this.offers.delete(token);
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
