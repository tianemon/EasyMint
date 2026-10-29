/**
 * Codex（ChatGPT 订阅）额度 & 「手动重置」凭据。
 *
 * 数据来自 ChatGPT 后端给**官方客户端**用的那两个端点（网页版与 Codex CLI 共用）：
 *
 *   GET  {base}/wham/usage                       → rate_limit.primary_window / secondary_window
 *   GET  {base}/wham/rate-limit-reset-credits    → 可用重置凭据列表（含到期时间）
 *   POST {base}/wham/rate-limit-reset-credits/consume  → 消耗一次重置（**不可逆**）
 *
 * 它们**没有公开文档**（社区实现都标注 undocumented，接口随时可能变），所以整块按旁路做：
 * 失败就不显示，不影响聊天与计费任何主流程。
 *
 * 认证只用 EM 里已有的 Codex 登录凭据（`runtime.getAuth("openai-codex")` → access + accountId），
 * 不新增登录、不落盘任何 token。请求走主进程的全局 fetch，因此自动遵循系统代理接管
 * （见 services/system-proxy.ts）。
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { emAgentDir } from "../utils/paths";
import type { Store } from "./store";
import type {
  CodexQuotaResult,
  CodexQuotaView,
  CodexQuotaWindow,
  ConsumeResetResult,
} from "../../shared/codex-quota";

export type { CodexQuotaResult, CodexQuotaView, CodexQuotaWindow, ConsumeResetResult };

const BASE = "https://chatgpt.com/backend-api";
/** 汇总缓存：弹窗反复打开时别每次都打两个请求；重置成功后会主动清 */
const CACHE_MS = 60_000;

interface CodexAuth {
  access: string;
  accountId?: string;
}

/**
 * 取 EM 当前保存的 Codex 凭据。
 *
 * **直接读 auth.json，不经模型运行时**：`getModelRuntime()` 会把整个 Pi SDK 冷导入
 * （Windows 实测 7~10 秒），而这里只是要看一眼额度——为一块旁路信息触发 SDK 加载，
 * 等于把启动优化（见 native-config 的注释）白做。auth.json 是 SDK 写的明文 pi 格式，
 * 路径与 native-config 的 `files.auth` 同源（都取 emAgentDir()）。
 *
 * 过期判断只做"明显过期就判需要重新登录"：真正的刷新仍由 SDK 在下次调用时完成。
 */
function readAuth(_store: Store): CodexAuth | null {
  const file = path.join(emAgentDir(), "auth.json");
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
    const entry = raw["openai-codex"] as { type?: string; access?: string; accountId?: string; expires?: number } | undefined;
    if (!entry?.access) return null;
    if (typeof entry.expires === "number" && entry.expires < Date.now()) return null;
    return { access: entry.access, accountId: entry.accountId };
  } catch (e) {
    console.warn("[codex-usage] 读取 Codex 凭据失败:", (e as Error).message);
    return null;
  }
}

/** 两个端点共用的一套请求头（Authorization + 账号 id 缺一不可） */
function headers(auth: CodexAuth): Record<string, string> {
  return {
    authorization: `Bearer ${auth.access}`,
    accept: "application/json",
    ...(auth.accountId ? { "chatgpt-account-id": auth.accountId } : {}),
  };
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseWindow(raw: unknown): CodexQuotaWindow | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const w = raw as Record<string, unknown>;
  const usedPercent = num(w.used_percent);
  const minutes = num(w.window_minutes);
  const windowSeconds = num(w.limit_window_seconds) ?? (minutes === undefined ? undefined : minutes * 60);
  if (usedPercent === undefined || !windowSeconds) return undefined;
  return {
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    windowSeconds,
    resetAt: num(w.reset_at),
    reached: usedPercent >= 100,
  };
}

/**
 * 把两个端点的原始 JSON 合成一个视图（纯函数，回归见 codex-usage.test.ts）。
 *
 * 两个端点的形状都是从真实响应里抄的：
 * - usage：`rate_limit.primary_window{used_percent,limit_window_seconds,reset_at}`、`plan_type`
 * - credits：`credits[]{id,status,title,granted_at,expires_at}`、`available_count`
 * `available_count` 是权威计数（后端可能截断 `credits` 数组），只把 `status: "available"`
 * 的条目当可用。
 */
export function parseCodexQuota(usage: unknown, credits: unknown): CodexQuotaView {
  const u = (usage ?? {}) as Record<string, unknown>;
  const rateLimit = (u.rate_limit ?? {}) as Record<string, unknown>;
  const c = (credits ?? {}) as Record<string, unknown>;
  const items = (Array.isArray(c.credits) ? c.credits : [])
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .filter((item) => (item.status === undefined || item.status === "available") && typeof item.id === "string")
    .map((item) => ({
      id: item.id as string,
      title: typeof item.title === "string" ? item.title : undefined,
      grantedAt: typeof item.granted_at === "string" ? item.granted_at : undefined,
      expiresAt: typeof item.expires_at === "string" ? item.expires_at : undefined,
    }));
  const available = num(c.available_count) ?? items.length;
  return {
    plan: typeof u.plan_type === "string" ? u.plan_type : undefined,
    primary: parseWindow(rateLimit.primary_window),
    secondary: parseWindow(rateLimit.secondary_window),
    credits: { available, items },
    fetchedAt: Date.now(),
  };
}

/**
 * 从 access token 的 JWT payload 里读套餐等级（`chatgpt_plan_type`）。
 *
 * 只在 `wham/usage` 没给 `plan_type` 时当回落用：凭据已在内存里，解码不额外发请求、
 * 不落盘、不打印任何 token 内容。JWT 形状变了就返回 undefined，界面只是不显示括号。
 */
export function planFromAccessToken(access: string): string | undefined {
  const payload = access.split(".")[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as Record<string, unknown>;
    const auth = claims["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
    const plan = auth?.chatgpt_plan_type ?? claims.chatgpt_plan_type;
    return typeof plan === "string" && plan.trim() ? plan.trim() : undefined;
  } catch {
    return undefined;
  }
}

let cached: { at: number; result: CodexQuotaResult } | null = null;

/** 缓存只对"成功"和"网络失败"生效；凭据类失败每次重查（用户可能刚好重新登录） */
export function clearCodexQuotaCache(): void {
  cached = null;
}

/** 查一次额度（含可用重置凭据）。任何失败都降级成 reason，不抛。 */
export async function fetchCodexQuota(store: Store, options: { force?: boolean } = {}): Promise<CodexQuotaResult> {
  if (!options.force && cached && Date.now() - cached.at < CACHE_MS) return cached.result;
  const auth = await readAuth(store);
  if (!auth) return { ok: false, reason: "no-credential" };
  try {
    const [usageRes, creditsRes] = await Promise.all([
      fetch(`${BASE}/wham/usage`, { headers: headers(auth) }),
      fetch(`${BASE}/wham/rate-limit-reset-credits`, { headers: headers(auth) }),
    ]);
    if (usageRes.status === 401 || usageRes.status === 403) return { ok: false, reason: "reauth" };
    if (!usageRes.ok) return { ok: false, reason: "unsupported" };
    const usage = await usageRes.json().catch(() => null);
    // 明细端点失败不该让整块消失：拿到多少算多少（计数退化成"未知"）
    const credits = creditsRes.ok ? await creditsRes.json().catch(() => null) : null;
    const quota = parseCodexQuota(usage, credits);
    // 端点偶尔不带 plan_type：退回凭据里的套餐声明（拿不到就留白，不猜）
    quota.plan ??= planFromAccessToken(auth.access);
    const result: CodexQuotaResult = { ok: true, quota };
    cached = { at: Date.now(), result };
    return result;
  } catch (e) {
    console.warn("[codex-usage] 查询额度失败:", (e as Error).message);
    return { ok: false, reason: "network" };
  }
}

/**
 * 幂等键（`redeem_request_id`）：**一次逻辑消耗必须复用同一个 uuid**。
 * 网络超时后用户再点，若换成新 uuid，服务端会当成"又一次消耗"——那是不可逆的。
 * 所以按 creditId 记住在途的 uuid，拿到终态（reset / no_credit / nothing_to_reset / already_redeemed）
 * 或明确失败（4xx）后清掉。
 */
const pendingRedeem = new Map<string, string>();

export function consumeResetBody(creditId: string | undefined, requestId: string): Record<string, string> {
  return creditId ? { redeem_request_id: requestId, credit_id: creditId } : { redeem_request_id: requestId };
}

/**
 * 消耗一次重置（不可逆）。界面必须先做二次确认再调这里。
 *
 * `creditId` 不传 = 让后端自己挑一张（官方客户端的做法）；指定 id 时优先用快过期的那张。
 */
export async function consumeCodexResetCredit(store: Store, creditId?: string): Promise<ConsumeResetResult> {
  const auth = await readAuth(store);
  if (!auth) return { code: "error", error: "no-credential" };
  const key = creditId ?? "auto";
  const requestId = pendingRedeem.get(key) ?? randomUUID();
  pendingRedeem.set(key, requestId);
  try {
    const res = await fetch(`${BASE}/wham/rate-limit-reset-credits/consume`, {
      method: "POST",
      headers: { ...headers(auth), "content-type": "application/json" },
      body: JSON.stringify(consumeResetBody(creditId, requestId)),
    });
    if (res.status === 401 || res.status === 403) {
      pendingRedeem.delete(key);
      return { code: "error", error: "reauth" };
    }
    const data = (await res.json().catch(() => null)) as { code?: string; windows_reset?: number } | null;
    const code = data?.code;
    if (code === "reset" || code === "nothing_to_reset" || code === "no_credit" || code === "already_redeemed") {
      pendingRedeem.delete(key);      // 终态：下次点击是一次新的消耗
      clearCodexQuotaCache();         // 让界面拿到重置后的窗口
      return { code, windowsReset: num(data?.windows_reset) };
    }
    // 4xx 且不是上面四个码：请求本身有问题，留痕并允许重试（同一 uuid 仍安全）
    console.warn(`[codex-usage] 消耗重置返回异常 HTTP ${res.status}`);
    return { code: "error", error: `http-${res.status}` };
  } catch (e) {
    // 网络层失败：**故意保留同一个 requestId**，用户重试时服务端按幂等键处理
    console.warn("[codex-usage] 消耗重置失败:", (e as Error).message);
    return { code: "error", error: (e as Error).message };
  }
}
