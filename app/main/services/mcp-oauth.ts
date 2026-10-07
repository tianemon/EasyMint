/**
 * MCP OAuth 客户端（阶段D）——基于 @modelcontextprotocol/sdk 的 auth 模块。
 *
 * SDK 内置全套协议逻辑（DCR / PKCE / 元数据发现 / 刷新），EM 只需实现
 * OAuthClientProvider 接口的宿主侧回调：凭据存储、浏览器跳转、本地回调服务器。
 *
 * 设计决策：
 * - 回调端口固定 31173（DCR 的 redirect_uris 精确匹配，动态端口会导致注册与回调不符；
 *   避开 OMP 默认的 3000；可在配置 callbackPort 调整）
 * - 凭据用 Electron safeStorage（系统钥匙串）加密后落 ~/.easymint/agent/mcp-auth.json——
 *   比 OMP 的明文 db 更安全；safeStorage 不可用时（极少数 Linux 环境）降级明文并告警。
 *   路径与 Pi 自身摆放凭据的agentDir 同层（文件名对齐 Pi 的 mcp-auth.json），
 *   便于后续切到 Pi 内置 MCP 时由官方 store 接管同一位置
 * - 授权码等待超时 5 分钟（用户在浏览器操作的时间预算）
 */

import * as http from "node:http";
import * as crypto from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { emAgentDir, emHome } from "../utils/paths";

const DEFAULT_CALLBACK_PORT = 31173;
const CRED_FILE = path.join(emAgentDir(), "mcp-auth.json");
/** 归位前的旧位置——只读兜底，见 loadCreds。 */
const LEGACY_CRED_FILE = path.join(emHome(), "mcp-oauth.json");

export function oauthRedirectUrl(callbackPort: number): string {
  return `http://127.0.0.1:${callbackPort}/callback`;
}

// ── 凭据持久化（safeStorage 加密） ──────────────────

interface StoredCreds {
  tokens?: string;   // safeStorage 加密后的 base64
  client?: string;   // safeStorage 加密后的 base64（DCR 注册信息）
}

/**
 * 凭据文件的**生效路径**：新位置优先，新位置没有可读凭据时沿用旧位置。
 *
 * 读写必须同一个来源：只让读回落、写仍固定新位置的话，迁移失败期间新授权的 token 写进新文件，
 * 下一读又优先取新文件（里面只有那一个 server），旧文件里其余 server 的令牌就被"弄丢"了 ——
 * 表现为其它 MCP server 反复要求重新登录。
 */
function credFile(): string {
  for (const file of [CRED_FILE, LEGACY_CRED_FILE]) {
    if (!existsSync(file)) continue;
    try {
      const data = JSON.parse(readFileSync(file, "utf-8")) as Record<string, StoredCreds>;
      if (data && typeof data === "object" && Object.keys(data).length > 0) return file;
    } catch {
      // 损坏：当作这一份没有凭据，继续看下一个位置（迁移窗口内旧文件往往还是好的）
    }
  }
  return CRED_FILE; // 两边都没有（或都损坏）：新位置优先
}

function loadCreds(): Record<string, StoredCreds> {
  // 归位迁移是 best-effort（失败不阻断启动），新位置为空时沿用旧位置，
  // 否则用户会看到"已授权的 server 又要重新登录"
  const file = credFile();
  if (!existsSync(file)) return {};
  try {
    const data = JSON.parse(readFileSync(file, "utf-8")) as Record<string, StoredCreds>;
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveCreds(all: Record<string, StoredCreds>): void {
  const file = credFile();
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(all, null, 2));
}

let encWarned = false;
function encrypt(plain: string): string {
  // safeStorage 需 app ready；不可用时降级明文（极少数 Linux 无钥匙串环境），只告警一次
  try {
    // 延迟 require 避免 bundle 顶层依赖 electron（该文件在 adapter 中被引用，adapter 运行于 main 进程）
    const { safeStorage } = require("electron");
    if (safeStorage?.isEncryptionAvailable()) {
      return safeStorage.encryptString(plain).toString("base64");
    }
  } catch { /* fallthrough */ }
  if (!encWarned) {
    encWarned = true;
    console.warn("[mcp-oauth] safeStorage 不可用，OAuth 凭据降级为明文存储（建议检查系统钥匙串环境）");
  }
  return Buffer.from(plain, "utf-8").toString("base64");
}

function decrypt(b64: string): string {
  try {
    const { safeStorage } = require("electron");
    if (safeStorage?.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(b64, "base64"));
    }
  } catch { /* fallthrough */ }
  return Buffer.from(b64, "base64").toString("utf-8");
}

// ── OAuthClientProvider 实现 ────────────────────────

export class EmOAuthProvider implements OAuthClientProvider {
  private readonly callbackPort: number;
  private pendingCode: { code: string; state?: string } | null = null;
  /** PKCE code verifier（startAuthorization 生成，exchangeAuthorization 消费；同一流程内暂存内存） */
  private codeVerifierValue = "";
  private codeWaiter: ((code: string) => void) | null = null;
  /** loopback 回调服务器句柄（授权期间监听，完成后关闭） */
  private callbackServer: http.Server | null = null;

  constructor(
    private readonly serverName: string,
    private readonly serverUrl: string,
    private readonly callbackPortOpt?: number,
  ) {
    this.callbackPort = callbackPortOpt ?? DEFAULT_CALLBACK_PORT;
  }

  get redirectUrl(): string | URL {
    return oauthRedirectUrl(this.callbackPort);
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "EasyMint",
      client_uri: "https://github.com/AmonXP/easymint",
      redirect_uris: [this.redirectUrl as string],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none", // 公共客户端 + PKCE
    };
  }

  state(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  codeVerifier(): string {
    return this.codeVerifierValue;
  }

  saveCodeVerifier(verifier: string): void {
    this.codeVerifierValue = verifier;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const cred = loadCreds()[this.serverName];
    if (!cred?.client) return undefined;
    try {
      return JSON.parse(decrypt(cred.client)) as OAuthClientInformationMixed;
    } catch {
      return undefined;
    }
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    const all = loadCreds();
    all[this.serverName] = { ...all[this.serverName], client: encrypt(JSON.stringify(info)) };
    saveCreds(all);
  }

  tokens(): OAuthTokens | undefined {
    const cred = loadCreds()[this.serverName];
    if (!cred?.tokens) return undefined;
    try {
      return JSON.parse(decrypt(cred.tokens)) as OAuthTokens;
    } catch {
      return undefined;
    }
  }

  saveTokens(tokens: OAuthTokens): void {
    const all = loadCreds();
    all[this.serverName] = { ...all[this.serverName], tokens: encrypt(JSON.stringify(tokens)) };
    saveCreds(all);
  }

  /**
   * 跳转系统浏览器授权 + 在本地 loopback 等待授权码。
   * SDK 会在收到 code 后调 exchangeAuthorization 换 token（走 saveTokens 持久化）。
   */
  redirectToAuthorization(url: string | URL): void {
    // 启动 loopback 监听（占用则报清晰错误——用户可改 callbackPort）
    const port = this.callbackPort;
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (u.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const code = u.searchParams.get("code");
      const error = u.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(error
        ? `<body style="font-family:sans-serif;padding:40px"><h2>授权失败</h2><p>${error}</p><p>可关闭此页面，回到 EasyMint 重试。</p></body>`
        : `<body style="font-family:sans-serif;padding:40px"><h2>✅ 授权成功</h2><p>已收到授权码，可关闭此页面，回到 EasyMint 继续。</p></body>`);
      this.stopCallbackServer();
      if (code) {
        this.pendingCode = { code, state: u.searchParams.get("state") ?? undefined };
        this.codeWaiter?.(code);
      }
    });
    server.on("error", (e) => {
      this.stopCallbackServer();
      this.codeWaiter?.("");
      console.error(`[mcp-oauth] 端口 ${port} 监听失败（可能被占用，可在配置 callbackPort 调整）:`, (e as Error).message);
    });
    server.listen(port, "127.0.0.1");
    this.callbackServer = server;

    // 5 分钟超时（用户浏览器操作预算）
    const timeout = setTimeout(() => {
      this.stopCallbackServer();
      this.codeWaiter?.("");
    }, 5 * 60 * 1000);
    this.codeWaiter = (code: string) => {
      clearTimeout(timeout);
      this.codeWaiter = null;
      if (!code) return;
      this.pendingCode = { code, state: undefined };
      // SDK 的 auth() 流程从 provider 读取——此处仅记录，exchange 由 SDK 驱动
      console.log(`[mcp-oauth] ${this.serverName} 收到授权码`);
    };
    // 重置旧 code，等待新的
    this.pendingCode = null;

    // 跳系统浏览器（EM 优势：GUI 应用天然支持）
    const { shell } = require("electron");
    shell.openExternal(url.toString()).catch((e: Error) => {
      console.error("[mcp-oauth] 打开浏览器失败:", e.message);
      this.stopCallbackServer();
      this.codeWaiter?.("");
    });
  }

  /** 等待浏览器回调带回的授权码（redirectToAuthorization 内部启动监听） */
  waitForAuthorizationCode(timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("授权超时（5 分钟内未完成浏览器授权）")), timeoutMs);
      this.codeWaiter = (code: string) => {
        clearTimeout(t);
        resolve(code);
      };
    });
  }

  stopCallbackServer(): void {
    if (this.callbackServer) {
      try { this.callbackServer.close(); } catch { /* ignore */ }
      this.callbackServer = null;
    }
  }

  /** 撤销授权（界面「清除授权」）：删除该 server 的凭据 */
  static clearCredentials(serverName: string): void {
    const all = loadCreds();
    delete all[serverName];
    saveCreds(all);
  }

  /** 是否已有该 server 的授权凭据 */
  static hasCredentials(serverName: string): boolean {
    const cred = loadCreds()[serverName];
    return !!cred?.tokens;
  }

  /** 当前 pending 的授权码（SDK exchangeAuthorization 用） */
  takePendingCode(): { code: string; state?: string } | null {
    const p = this.pendingCode;
    this.pendingCode = null;
    return p;
  }
}
