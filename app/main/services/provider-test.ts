/**
 * 供应商「测试接口」——只做连通测试（设置页「测试接口」按钮的唯一实现）。
 *
 * 2026-09-09 用户决定：模型列表接口各家不同、密钥校验端点同样五花八门，一律不做——
 * 只验证「GET baseUrl 能否拿到 HTTP 响应」：任何状态码（401/403/404/500）都算连通，
 * 沿用 cc-switch 口径（仅 DNS / 连接 / TLS / 超时算不可达），避免把网关限制误判成问题。
 *
 * 只用 Node 内置 fetch（主进程 CJS bundle 对外部 ESM-only 包敏感，不引新依赖）。
 * apiKey 不进请求头、不进日志——连通不需要凭据。
 */

import type { ProviderTestResult } from "../../shared/provider-test";
import { currentSystemProxy, redactProxyUrl } from "./system-proxy";

const TIMEOUT_MS = 15_000;

export interface ProviderTestInput {
  baseUrl: string;
}

type HttpOutcome =
  | { ok: true; status: number; text: string }
  | { ok: false; detail: string };

/** 详情里附带的长度上限：原文要留（排查靠它），但不能把整个 URL 铺满一行 */
function clip(value: string, max = 120): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * 把失败归因说清楚：当前是否经系统代理。
 *
 * 为什么值得占这几行：同一句「连接失败」在"直连"和"经代理"下的含义完全不同，而这正是
 * **开发者本机复现不出来**的那类报告（本机 TUN/代理正常，用户机器上是另一个代理）。
 * 带上实际的代理地址，用户截图就能定位问题在哪一层。
 */
function proxyNote(): string {
  const proxy = currentSystemProxy();
  return proxy ? ` · 经系统代理 ${redactProxyUrl(proxy)}` : "";
}

/**
 * 先把 Base URL 校验干净再发请求。
 *
 * 不能靠 fetch 报错来判格式：`TypeError: Invalid URL` 同时也是 undici `ProxyAgent` 解析
 * **代理地址**失败时的报错——它在 `new ProxyAgent(代理串)` 构造时就 `new URL()`（undici 7.x 的
 * `#getUrl`），而我们的代理 agent 是懒构造的，所以爆点落在首次请求那一刻。旧实现把两者一股脑
 * 归成「Base URL 格式不正确（需以 http 开头）」——于是"系统代理地址不对"被报成了"你 URL 写错了"，
 * 用户改 URL 也没用。现在：格式问题在这里一次说清（附原文），fetch 之后出现的解析错误只可能是
 * 代理/重定向那一层。
 */
function normalizeBaseUrl(raw: string): { url: string } | { error: string } {
  const value = raw.trim();
  if (!value) return { error: "Base URL 为空" };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { error: `Base URL 格式不正确（需以 http:// 或 https:// 开头）：${clip(value)}` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: `Base URL 只支持 http / https，当前是 ${parsed.protocol.replace(":", "")}：${clip(value)}` };
  }
  return { url: value.replace(/\/+$/, "") };
}

/** 网络层失败（无 HTTP 响应）→ 用户可读原因 */
function networkErrorMessage(err: unknown): string {
  const e = err as { name?: string; code?: string; cause?: { code?: string; message?: string }; message?: string };
  const cause = e?.cause;
  const code = cause?.code ?? e?.code ?? "";
  // undici 的顶层信息恒为 "fetch failed"，真正原因在 cause（DNS/连接/TLS 的系统错误）
  const msg = e?.message === "fetch failed" && cause?.message ? cause.message : (e?.message ?? String(err));
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return `请求超时（${TIMEOUT_MS / 1000}s）${proxyNote()}`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `域名解析失败（检查 Base URL）${proxyNote()}`;
  if (code === "ECONNREFUSED") return `连接被拒绝（服务未监听或端口不对）${proxyNote()}`;
  if (code === "ECONNRESET" || code === "ECONNABORTED") return `连接被重置${proxyNote()}`;
  if (/CERT|TLS|SSL|UNABLE_TO_VERIFY/i.test(code) || /certificate|TLS/i.test(msg)) return `TLS 证书校验失败${proxyNote()}`;
  // Base URL 已在 normalizeBaseUrl 里校验过：还能走到这里的解析错误属于**代理或重定向**这一层
  // （undici 的 ProxyAgent 在构造时对代理串做 `new URL`，不合法即抛 `TypeError: Invalid URL`）
  if (/Failed to parse URL|Invalid URL/i.test(msg)) {
    return `代理或重定向地址无法解析（原文：${clip(msg)}）${proxyNote()}`;
  }
  // undici 自己的错误码（socks 代理、代理握手失败、socket 异常等）都带 UND_ERR_ 前缀。
  // 这类没有中文归类，但**也不能只甩一句英文**——给中文定性、原文照旧附上。
  if (code.startsWith("UND_ERR") || /^UND_ERR/.test(msg)) {
    return `连接失败（${code || "undici 错误"}）：${clip(msg)}${proxyNote()}`;
  }
  return clip(msg) + proxyNote();
}

/** 单次请求：只区分「拿到响应」与「网络层失败」，状态码一律交给调用方判定 */
async function request(url: string): Promise<HttpOutcome> {
  try {
    const resp = await fetch(url, { method: "GET", headers: { accept: "*/*" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await resp.text().catch(() => "");
    return { ok: true, status: resp.status, text };
  } catch (err) {
    return { ok: false, detail: networkErrorMessage(err) };
  }
}

/** GET baseUrl，任何 HTTP 状态都算连通 */
export async function testProvider(input: ProviderTestInput): Promise<ProviderTestResult> {
  const normalized = normalizeBaseUrl(input.baseUrl);
  if ("error" in normalized) return { reachability: { ok: false, detail: normalized.error, ms: 0 } };
  const started = Date.now();
  const r = await request(normalized.url);
  const ms = Date.now() - started;
  if (!r.ok) return { reachability: { ok: false, detail: r.detail, ms } };
  return { reachability: { ok: true, detail: `HTTP ${r.status} · ${ms}ms`, httpStatus: r.status, ms } };
}
