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

const TIMEOUT_MS = 15_000;

export interface ProviderTestInput {
  baseUrl: string;
}

type HttpOutcome =
  | { ok: true; status: number; text: string }
  | { ok: false; detail: string };

/** 网络层失败（无 HTTP 响应）→ 用户可读原因 */
function networkErrorMessage(err: unknown): string {
  const e = err as { name?: string; code?: string; cause?: { code?: string; message?: string }; message?: string };
  const cause = e?.cause;
  const code = cause?.code ?? e?.code ?? "";
  // undici 的顶层信息恒为 "fetch failed"，真正原因在 cause（DNS/连接/TLS 的系统错误）
  const msg = e?.message === "fetch failed" && cause?.message ? cause.message : (e?.message ?? String(err));
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return `请求超时（${TIMEOUT_MS / 1000}s）`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "域名解析失败（检查 Base URL）";
  if (code === "ECONNREFUSED") return "连接被拒绝（服务未监听或端口不对）";
  if (code === "ECONNRESET" || code === "ECONNABORTED") return "连接被重置";
  if (/CERT|TLS|SSL|UNABLE_TO_VERIFY/i.test(code) || /certificate|TLS/i.test(msg)) return "TLS 证书校验失败";
  // 非法 URL 会走到这里：undici 报 "Failed to parse URL from xxx"，直出不友好
  if (/Failed to parse URL|Invalid URL/i.test(msg)) return "Base URL 格式不正确（需以 http 开头）";
  return msg.length > 120 ? `${msg.slice(0, 120)}…` : msg;
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
  const base = input.baseUrl.trim().replace(/\/+$/, "");
  const started = Date.now();
  const r = await request(base);
  const ms = Date.now() - started;
  if (!r.ok) return { reachability: { ok: false, detail: r.detail, ms } };
  return { reachability: { ok: true, detail: `HTTP ${r.status} · ${ms}ms`, httpStatus: r.status, ms } };
}
