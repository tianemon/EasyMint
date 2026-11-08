/**
 * 「手机浏览器访问」静态 HTTP 服务。
 *
 * 职责边界（勿越界）：**只托管 `resources/em-mobile-web/dist` 的静态资源**，外加一个无任何业务
 * 信息的 `GET /health`。配对与全部业务通信由手机网页直连现有 47778 加密 WebSocket 完成，本服务
 * 不承载任何业务 API，也不读取/转发任何设备、项目、会话数据。
 *
 * 安全模型（对齐 asset-preview-service 的本地预览服务，但按局域网场景放宽到 LAN IP）：
 * - Host 白名单（含端口校验）挡 DNS rebinding；Sec-Fetch-Site / Origin 挡跨站读取。
 * - 动态 CSP 把 WebSocket 连接限定在 `ws://<LAN-IP>:47778`，脚本/样式只允许同源。
 * - 路径越界 + 符号链接逃逸 + 隐藏文件 + MIME 白名单，杜绝把 dist 之外的文件读出去。
 *
 * 静态根可通过 `startMobileWebService({ staticRoot })` 或环境变量 `EM_MOBILE_WEB_ROOT` 注入，
 * 便于单元测试不依赖 Web 前端产物。
 */
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { unpackPairingPayload } from "./remote-terminal-service";
import { pipeline } from "node:stream/promises";
import { randomBytes } from "node:crypto";
import { app } from "electron";
import { getResourcesDir } from "../utils/paths";
import { lanAddresses } from "./remote-terminal-service";
import type { RemoteTerminalService } from "./remote-terminal-service";
import type { Store } from "./store";

// ── 常量 ────────────────────────────────────────────────────────────────────
/** HTTP 静态服务默认端口，避开 47777（设备互联）与 47778（手机 WS 终端）。 */
export const MOBILE_WEB_DEFAULT_PORT = 47_779;
/** 手机网页实际连接的加密 WS 端口（现有 47778，协议/端口一律不改）。 */
export const MOBILE_WEB_WS_PORT = 47_778;
export const MOBILE_WEB_MIN_PORT = 1024;
export const MOBILE_WEB_MAX_PORT = 65_535;

/** MIME 白名单：照抄 asset-preview-service.ts，只放行静态资源类型。 */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".pdf": "application/pdf",
};

/** 打包后 extraResources 把 dist 内容映射到 `em-mobile-web`（无 dist 层）；开发时读仓库里 dist。 */
export function resolveMobileWebStaticRoot(): string {
  const override = process.env.EM_MOBILE_WEB_ROOT?.trim();
  if (override) return path.resolve(override);
  return app.isPackaged
    ? path.join(process.resourcesPath, "em-mobile-web")
    : path.join(getResourcesDir(), "em-mobile-web", "dist");
}

export function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < MOBILE_WEB_MIN_PORT || port > MOBILE_WEB_MAX_PORT) {
    throw new Error(`Invalid mobile web port: ${port} (expected ${MOBILE_WEB_MIN_PORT}-${MOBILE_WEB_MAX_PORT})`);
  }
}

// ── 短码查表（配对材料）─────────────────────────────────────────────────────
// 二维码只携带 10 位短码，浏览器同源 fetch('/pair/<code>.json') 换取配对材料对象。
// 表只存活于主进程内存：不落盘、不参与 47778 的 token 一次性消费、可重复读直到过期。
const PAIR_CODE_BYTES = 8;
const PAIR_CODE_LENGTH = 10;
const PAIR_CODE_RE = /^[A-Za-z0-9_-]{10}$/;
const PAIR_PATH_RE = /^\/pair\/([^/]+)\.json$/;
const PAIR_LINK_TTL_MS = 60_000;
const PAIR_LINK_MAX_ENTRIES = 32;

/** 与旧 `#pair=` payload 解码后完全同形的 8 字段对象（由 47778 createPairingOffer 生成）。 */
export interface PairLinkPayload {
  version: number;
  token: string;
  pcId: string;
  pcName: string;
  addresses: string[];
  port: number;
  publicKey: string;
  expiresAt: number;
}

interface PairLinkEntry {
  payload: PairLinkPayload;
  expiresAt: number;
}

const pairLinks = new Map<string, PairLinkEntry>();

/** 惰性清理：仅在新登记时清掉过期条目，不设定时器。 */
function prunePairLinks(now: number): void {
  for (const [code, entry] of pairLinks) {
    if (entry.expiresAt <= now) pairLinks.delete(code);
  }
}

/** 登记一份配对材料，返回 10 位短码与过期时间；容量满时淘汰最早登记的有效条目。 */
export function registerPairOffer(payload: PairLinkPayload): { code: string; expiresAt: number } {
  const now = Date.now();
  prunePairLinks(now);
  if (pairLinks.size >= PAIR_LINK_MAX_ENTRIES) {
    const oldest = pairLinks.keys().next();
    if (!oldest.done) pairLinks.delete(oldest.value);
  }
  let code: string;
  do {
    code = randomBytes(PAIR_CODE_BYTES).toString("base64url").slice(0, PAIR_CODE_LENGTH);
  } while (pairLinks.has(code));
  // 短码生命周期与 offer 同步且不超过 60s；取小避免 payload 被写成超长 TTL。
  const expiresAt = Math.min(payload.expiresAt, now + PAIR_LINK_TTL_MS);
  pairLinks.set(code, { payload, expiresAt });
  return { code, expiresAt };
}

/** 查表：命中且未过期返回配对材料对象，否则 null 并顺手清掉该过期条目。 */
export function resolvePairOffer(code: string): PairLinkPayload | null {
  if (!PAIR_CODE_RE.test(code)) return null;
  const entry = pairLinks.get(code);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    pairLinks.delete(code);
    return null;
  }
  return entry.payload;
}

// ── 路径与请求校验辅助 ──────────────────────────────────────────────────────

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** 目标必须位于 root 内，且路径中不含隐藏段（dist 里没有需要对外暴露的点文件）。 */
function publicPath(root: string, target: string): boolean {
  if (!inside(root, target)) return false;
  return path.relative(root, target).split(path.sep).every((part) => !part.startsWith("."));
}

/** 形如 `index-BxK2pQ9v.js` / `logo.abcd1234.png`：带内容哈希，可长缓存 immutable。 */
function isHashedAsset(file: string): boolean {
  const base = path.basename(file).toLowerCase();
  // PWA 清单与桌面图标是固定文件名、需及时更新，且 apple-touch-icon.png 的 `touch-icon`
  // 段会被下方哈希正则误命中。显式排除这些名字，而非收紧正则：Vite 的 base64 内容哈希
  // 本身可能含连字符，收紧会让真实带哈希的资源一并失去 immutable 长缓存。
  if (/^(manifest\.webmanifest|icon-\d+\.png|apple-touch-icon\.png)$/.test(base)) return false;
  return /[-._][A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(base);
}

function parseHost(header: string | undefined): { hostname: string; port: string } | null {
  if (!header) return null;
  let hostname: string;
  let port: string;
  if (header.startsWith("[")) {
    const end = header.indexOf("]");
    if (end === -1) return null;
    hostname = header.slice(1, end);
    const rest = header.slice(end + 1);
    port = rest.startsWith(":") ? rest.slice(1) : "";
  } else {
    const idx = header.lastIndexOf(":");
    hostname = idx === -1 ? header : header.slice(0, idx);
    port = idx === -1 ? "" : header.slice(idx + 1);
  }
  return { hostname: hostname.toLowerCase(), port };
}

interface RequestContext {
  root: string;
  port: number;
  lanAddressesFn: () => string[];
  hostname: string;
  wsPort: number;
}

interface Policy {
  hostSet: Set<string>;
  originSet: Set<string>;
  csp: string;
}

/**
 * 每次请求按当前 LAN IP 动态构造白名单与 CSP。
 * 不去缓存 LAN IP：换 WiFi / 插网线后无需重启服务，Host 与 connect-src 自动跟随。
 */
function buildPolicy(ctx: RequestContext): Policy {
  const lan = ctx.lanAddressesFn();
  const hosts = [
    ...lan, "127.0.0.1", "localhost", ctx.hostname, `${ctx.hostname}.local`,
  ].map((host) => host.toLowerCase());
  const hostSet = new Set(hosts);
  const originSet = new Set(hosts.map((host) => `http://${host}:${ctx.port}`));
  const connectSrc = ["'self'", ...lan.map((ip) => `ws://${ip}:${ctx.wsPort}`)].join(" ");
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    // 主屏安装的 manifest 由页面在本地拼装成 blob:（凭证不出设备），
    // 不显式放行 blob: 会被 default-src 'self' 挡掉，iOS 主屏启动就拿不到 start_url。
    "manifest-src 'self' blob:",
    `connect-src ${connectSrc}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ") + ";";
  return { hostSet, originSet, csp };
}

function securityHeaders(policy: Policy): Record<string, string> {
  return {
    "Content-Security-Policy": policy.csp,
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}

function reject(response: ServerResponse, status: number, policy: Policy, extra: Record<string, string> = {}): void {
  response.writeHead(status, { ...securityHeaders(policy), ...extra }).end();
}

async function resolveStaticFile(root: string, target: string): Promise<{ file: string; mime: string } | null> {
  let resolved: string;
  try { resolved = await realpath(target); } catch { return null; }
  if (!publicPath(root, resolved)) return null;
  let info;
  try { info = await stat(resolved); } catch { return null; }
  if (!info.isFile()) return null;
  const mime = MIME[path.extname(resolved).toLowerCase()];
  return mime ? { file: resolved, mime } : null;
}

async function sendFile(
  response: ServerResponse,
  method: string,
  file: string,
  mime: string,
  cacheControl: string,
  policy: Policy,
): Promise<void> {
  response.writeHead(200, {
    ...securityHeaders(policy),
    "Content-Type": mime,
    "Cache-Control": cacheControl,
  });
  if (method === "HEAD") { response.end(); return; }
  await pipeline(createReadStream(file), response);
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, ctx: RequestContext): Promise<void> {
  const policy = buildPolicy(ctx);
  const parsed = parseHost(request.headers.host);
  // Host 端口必须等于配置端口，且主机名命中 LAN IP / loopback / 本机名白名单。
  if (!parsed || !policy.hostSet.has(parsed.hostname) || parsed.port !== String(ctx.port)) {
    reject(response, 403, policy); return;
  }
  if (request.headers["sec-fetch-site"] === "cross-site") { reject(response, 403, policy); return; }
  const origin = request.headers.origin;
  if (origin && !policy.originSet.has(origin.toLowerCase())) { reject(response, 403, policy); return; }
  if (request.method !== "GET" && request.method !== "HEAD") {
    reject(response, 405, policy, { Allow: "GET, HEAD" }); return;
  }
  // WHATWG URL 在解析时就会消解 `..` 段：无扩展名的越界路径会被规范化成根内路由，
  // 进而命中 SPA 回退返回 index.html。规范化之前先拦截，保证含 `..`（含编码形式）的请求一律 404。
  const rawPath = (request.url ?? "/").split("?")[0].split("#")[0];
  if (/(^|\/)\.\.(\/|$)/.test(rawPath) || /%2e%2e/i.test(rawPath)) {
    reject(response, 404, policy); return;
  }
  let pathname: string;
  try { pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname); }
  catch { reject(response, 400, policy); return; }
  if (pathname.includes("\\") || pathname.includes("\0")) { reject(response, 400, policy); return; }

  // 健康检查：204、无响应体、无任何业务信息（连 LAN IP 的 CSP 都不带）。
  if (pathname === "/health") {
    response.writeHead(204, { "X-Content-Type-Options": "nosniff" }).end();
    return;
  }

  // 短码查表端点：必须在 /health 之后、resolveStaticFile 之前拦截，否则 `.json` 扩展名
  // 会被 SPA 回退判 404。前面已过 Host/Origin/Sec-Fetch-Site/方法/越界校验；本分支只返回
  // 配对材料对象（与旧 #pair= payload 解码后同形），不承载任何业务数据。
  const pairMatch = PAIR_PATH_RE.exec(pathname);
  if (pairMatch) {
    const payload = resolvePairOffer(pairMatch[1]);
    if (!payload) { reject(response, 404, policy); return; }
    const body = JSON.stringify(payload);
    response.writeHead(200, {
      ...securityHeaders(policy),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Content-Length": String(Buffer.byteLength(body)),
    });
    // HEAD 与 GET 状态/头一致，但不写响应体。
    if (request.method === "HEAD") { response.end(); return; }
    response.end(body);
    return;
  }

  const target = path.resolve(ctx.root, `.${pathname}`);
  // 越界按 404 处理（与 asset-preview-service 一致，不对外暴露「存在的目录外路径」）。
  if (!inside(ctx.root, target)) { reject(response, 404, policy); return; }

  const resolved = await resolveStaticFile(ctx.root, target);
  if (resolved) {
    const isIndex = path.basename(resolved.file).toLowerCase() === "index.html";
    const cacheControl = isIndex
      ? "no-store"
      : isHashedAsset(resolved.file) ? "public, max-age=31536000, immutable" : "no-cache";
    await sendFile(response, request.method ?? "GET", resolved.file, resolved.mime, cacheControl, policy);
    return;
  }

  // SPA 回退只对「非隐藏、无扩展名」的路由生效；隐藏路径与缺失的静态资源一律 404。
  const hidden = pathname.split("/").some((segment) => segment.startsWith("."));
  if (!hidden && path.extname(pathname) === "") {
    const index = await resolveStaticFile(ctx.root, path.join(ctx.root, "index.html"));
    if (index) {
      await sendFile(response, request.method ?? "GET", index.file, index.mime, "no-store", policy);
      return;
    }
  }
  reject(response, 404, policy);
}

// ── 低层服务：start / stop / status ─────────────────────────────────────────

export interface StartMobileWebOptions {
  /** 静态根；不传时按 C1 解析（打包 / 开发 / 环境变量）。单元测试注入临时目录。 */
  staticRoot?: string;
  /** 监听端口，默认 47779。 */
  port?: number;
  /** 注入 LAN IP 列表，便于单元测试不依赖真实网卡。 */
  lanAddresses?: () => string[];
  /** 注入主机名，便于单元测试。 */
  hostname?: string;
  /** 注入 WS 端口（CSP connect-src 用），默认 47778。 */
  wsPort?: number;
}

export interface MobileWebServiceStatus {
  running: boolean;
  port: number;
  staticRoot: string | null;
}

let current: { server: Server; port: number; staticRoot: string } | null = null;

/** 启停一律经此入口：若已有服务会先停掉再重新监听（端口变更即复用此路径）。错误明确抛出，不静默降级。 */
export async function startMobileWebService(opts: StartMobileWebOptions = {}): Promise<MobileWebServiceStatus> {
  const port = opts.port ?? MOBILE_WEB_DEFAULT_PORT;
  validatePort(port);
  const staticRoot = opts.staticRoot ?? resolveMobileWebStaticRoot();
  let rootStat;
  try { rootStat = await stat(staticRoot); } catch {
    throw new Error(`Mobile web static root is missing: ${staticRoot}`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`Mobile web static root is not a directory: ${staticRoot}`);
  }
  const indexStat = await stat(path.join(staticRoot, "index.html")).catch(() => null);
  if (!indexStat?.isFile()) {
    throw new Error(`Mobile web build is incomplete (index.html missing): ${staticRoot}`);
  }
  // 静态根本身可能位于符号链接路径下（macOS /var → /private/var）：resolveStaticFile 会用
  // realpath(资源) 与 root 做 path.relative 判越界，若 root 未解析就会把「root 内」误判成「root 外」，
  // 导致所有静态资源 404。这里统一解析一次，ctx.root 与 realpath(资源) 的前缀才一致。
  let canonicalRoot: string;
  try { canonicalRoot = await realpath(staticRoot); }
  catch { throw new Error(`Mobile web static root is missing: ${staticRoot}`); }

  await stopMobileWebService();

  const ctx: RequestContext = {
    root: canonicalRoot,
    port,
    lanAddressesFn: opts.lanAddresses ?? lanAddresses,
    hostname: opts.hostname ?? os.hostname(),
    wsPort: opts.wsPort ?? MOBILE_WEB_WS_PORT,
  };
  const server = http.createServer((request, response) => {
    void handleRequest(request, response, ctx).catch(() => {
      if (!response.headersSent) reject(response, 404, buildPolicy(ctx));
      else response.destroy();
    });
  });
  await new Promise<void>((resolve, rejectPromise) => {
    const onError = (error: Error): void => { rejectPromise(error); };
    server.once("error", onError);
    server.listen(port, "0.0.0.0", () => { server.off("error", onError); resolve(); });
  });
  server.on("error", (error) => { console.error("[mobile-web] HTTP server error:", error.message); });
  current = { server, port, staticRoot };
  return getMobileWebStatus();
}

export async function stopMobileWebService(): Promise<void> {
  const entry = current;
  current = null;
  if (!entry) return;
  await new Promise<void>((resolve) => {
    entry.server.close(() => resolve());
    entry.server.closeAllConnections();
  });
}

export function getMobileWebStatus(): MobileWebServiceStatus {
  return current
    ? { running: true, port: current.port, staticRoot: current.staticRoot }
    : { running: false, port: MOBILE_WEB_DEFAULT_PORT, staticRoot: null };
}

// ── 主进程控制器：把设置、启停、防火墙提示、状态广播收在一处 ─────────────────
// index.ts 在 sharedServices 装配后 configure + bootstrap；ipc-handlers 只调这里的方法。
// 通过注入 broadcast 避免服务模块直接依赖 Electron 窗口，单元测试无需 electron 环境。

export interface MobileWebStatus {
  enabled: boolean;
  port: number;
  running: boolean;
  lanAddresses: string[];
  onlineWebDevices: number;
  /**
   * 47778（手机 App 通道）是否在听。浏览器的配对与数据都走那条通道，
   * 这里只如实上报依赖状态，**不替用户把它启动起来**——两个开关各管各的端口。
   */
  bridgeReady: boolean;
}

export interface MobileWebControllerDeps {
  store: Store;
  /**
   * 把「47778 是否该监听」对齐到两个开关（共享桥接，见 bridge-channel.ts）。
   * 网页通道需要它，但不能自己决定端口归属——端口由两条通道共同决定。
   */
  ensureBridge?: () => Promise<void>;
  remoteTerminalService: RemoteTerminalService;
  broadcast: (channel: string, data: unknown) => void;
  isWindows: boolean;
}

class MobileWebController {
  private deps: MobileWebControllerDeps | null = null;

  configure(deps: MobileWebControllerDeps): void { this.deps = deps; }

  private settings(): { enabled: boolean; port: number } {
    const s = this.deps!.store.getSettings();
    return {
      enabled: s.mobileWebEnabled ?? false,
      port: s.mobileWebPort ?? MOBILE_WEB_DEFAULT_PORT,
    };
  }

  getStatus(): MobileWebStatus {
    const d = this.deps;
    if (!d) {
      return {
        enabled: false, port: MOBILE_WEB_DEFAULT_PORT, running: false,
        lanAddresses: [], onlineWebDevices: 0, bridgeReady: false,
      };
    }
    const { enabled, port } = this.settings();
    return {
      enabled,
      port,
      running: getMobileWebStatus().running,
      lanAddresses: lanAddresses(),
      onlineWebDevices: d.remoteTerminalService.listDevices()
        .filter((device) => device.id.startsWith("web-") && device.online).length,
      bridgeReady: d.remoteTerminalService.isRunning(),
    };
  }

  /**
   * 生成一份独立的配对 offer，把其 payload 登记进短码表，只把 10 位短码交给二维码。
   * 与渲染层单独调的 mobile-terminal:createOffer() 互不复用：两份 offer 各自独立，
   * 47778 的一次性 token 消费语义不变。
   */
  async createPairLink(): Promise<{ code: string; expiresAt: number }> {
    // createPairingOffer 内部会 ensureStarted()——若此刻 47778 没在听，那是「手机 App 通道
    // 关着」，网页开关无权替它启动。这里直接拒绝，让界面去提示开 App 通道。
    if (!this.deps!.remoteTerminalService.isRunning()) {
      throw new Error("请先开启手机 App 通道");
    }
    const offer = await this.deps!.remoteTerminalService.createPairingOffer();
    // 直接用 offer 自带的编码载荷：App 二维码已经不带 payload 了（改短码查表），
    // 再按 uri 去切字符串会拿到空串。
    return registerPairOffer(unpackPairingPayload(offer.payload));
  }

  private broadcastStatus(): void {
    this.deps?.broadcast("mobile-web:status-changed", this.getStatus());
  }

  private async apply(enabled: boolean): Promise<void> {
    const d = this.deps!;
    const { port } = this.settings();
    if (!enabled) {
      // 关闭开关只停 HTTP 服务：保留浏览器配对凭证。
      await stopMobileWebService();
      // 共享端口要不要跟着关，交给两个开关的合成结果（App 通道还开着就继续听）
      await d.ensureBridge?.();
      return;
    }
    // 47778 是两条通道共享的桥接端口：浏览器要连它、App 也连它，所以这里按需拉起，
    // 但**是否监听由两条开关共同决定**（bridge-channel 的 syncBridge），不是网页开关独占。
    // 「关掉 App 通道后 App 仍能连」由服务端的设备准入挡住，而不是靠不监听端口。
    await d.ensureBridge?.();
    await startMobileWebService({ port });
    // Windows：首次监听（或端口变更后重监听）发一次防火墙提示，复用 device:firewall-hint 通道。
    if (d.isWindows) d.remoteTerminalService.emit("firewall-hint", { port });
  }

  /** 应用启动 / 主窗口创建时按磁盘开关装配：默认关闭，开启才监听。失败不让应用起不来。 */
  async bootstrap(): Promise<void> {
    if (!this.deps) return;
    if (!this.settings().enabled) return;
    try { await this.apply(true); }
    catch (error) { console.error("[mobile-web] startup failed:", (error as Error).message); }
    finally { this.broadcastStatus(); }
  }

  async setEnabled(enabled: boolean): Promise<MobileWebStatus> {
    const d = this.deps!;
    const s = d.store.getSettings();
    const prevEnabled = s.mobileWebEnabled ?? false;
    s.mobileWebEnabled = enabled;
    d.store.saveSettings(s);
    try {
      await this.apply(enabled);
    } catch (error) {
      // 与 setPort 对称：启动失败（EADDRINUSE / 缺静态产物）回滚磁盘开关，
      // 避免留下「设置里是开、服务却没在跑」的半开状态；错误照常抛给界面展示。
      const rollback = d.store.getSettings();
      rollback.mobileWebEnabled = prevEnabled;
      d.store.saveSettings(rollback);
      throw error;
    } finally { this.broadcastStatus(); }
    return this.getStatus();
  }

  async setPort(port: number): Promise<MobileWebStatus> {
    validatePort(port);
    const d = this.deps!;
    const s = d.store.getSettings();
    const prevPort = s.mobileWebPort ?? MOBILE_WEB_DEFAULT_PORT;
    const enabled = s.mobileWebEnabled ?? false;
    s.mobileWebPort = port;
    d.store.saveSettings(s);
    if (enabled) {
      const wasRunning = getMobileWebStatus().running;
      try {
        await startMobileWebService({ port });
        if (d.isWindows) d.remoteTerminalService.emit("firewall-hint", { port });
      } catch (error) {
        // EADDRINUSE 等失败：回滚磁盘端口并尽量恢复旧监听，明确把错误抛给界面，不静默换端口。
        const rollback = d.store.getSettings();
        rollback.mobileWebPort = prevPort;
        d.store.saveSettings(rollback);
        if (wasRunning) {
          try { await startMobileWebService({ port: prevPort }); } catch { /* 已尽力恢复 */ }
        }
        this.broadcastStatus();
        throw error;
      }
    }
    this.broadcastStatus();
    return this.getStatus();
  }
}

export const mobileWebController = new MobileWebController();
