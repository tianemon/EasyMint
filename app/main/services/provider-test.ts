/**
 * 供应商「测试接口」——连通 + 可选密钥校验（设置页「测试接口」按钮的唯一实现）。
 *
 * 2026-09-09 用户决定：各家供应商的模型列表接口五花八门，不一定走 OpenAI/Anthropic 协议，
 * 所有供应商（含内置）都不做模型列表测试，只做连通测试。
 *   - 连通：GET baseUrl，任何 HTTP 状态码（401/403/404/500）都算可达——沿用 cc-switch
 *     口径：仅 DNS / 连接 / TLS / 超时算不可达（早期版本曾发真实模型请求，因第三方网关
 *     401/403/WAF 误报被替换，这里避免把网关限制误判成 Key 无效）。
 *   - 密钥校验（可选勾选，约 10 token）：按表单所选协议直接发 max_tokens=1 的最小请求，
 *     不再依赖模型列表判定协议；网关端点路径各异，失败只如实报 HTTP 状态，不断言 Key 无效。
 *
 * 只用 Node 内置 fetch（主进程 CJS bundle 对外部 ESM-only 包敏感，不引新依赖）。
 * apiKey 只进请求头：日志、返回文案、错误信息都不带它。
 */

import type { ProviderProtocol, ProviderTestResult, ProviderTestStep } from "../../shared/provider-test";

const TIMEOUT_MS = 15_000;

export interface ProviderTestInput {
  baseUrl: string;
  apiKey: string;
  /** 表单里已填的默认模型 id（Key 校验必需） */
  model?: string;
  /** 表单里选择的协议：Key 校验按它选端点与请求头 */
  apiType?: string;
  /** 用户勾选「验证密钥」时才发最小请求 */
  verifyKey?: boolean;
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
async function request(url: string, init: RequestInit): Promise<HttpOutcome> {
  try {
    const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await resp.text().catch(() => "");
    return { ok: true, status: resp.status, text };
  } catch (err) {
    return { ok: false, detail: networkErrorMessage(err) };
  }
}

/** 步骤一：GET baseUrl，任何 HTTP 状态都算可达 */
async function probeReachability(baseUrl: string): Promise<ProviderTestResult["reachability"]> {
  const started = Date.now();
  const r = await request(baseUrl, { method: "GET", headers: { accept: "*/*" } });
  const ms = Date.now() - started;
  if (!r.ok) return { ok: false, detail: r.detail, ms };
  return { ok: true, detail: `HTTP ${r.status} · ${ms}ms`, httpStatus: r.status, ms };
}

/** Key 校验的错误文案映射 */
function keyCheckErrorDetail(status: number, body: string): string {
  if (status === 401 || status === 403) return "认证被拒绝（Key 可能无效，也可能是网关限制）";
  if (status === 429) return "配额不足或请求过于频繁（HTTP 429）";
  if (status === 400 && /model/i.test(body)) return "模型 id 可能不正确（服务端未识别该模型）";
  if (status === 404) return "该端点不存在（HTTP 404）";
  if (status >= 500) return `服务端错误（HTTP ${status}）`;
  return `HTTP ${status}`;
}

/** 步骤二：按协议发 max_tokens=1 的最小调用（约 10 token） */
async function verifyKey(
  url: string,
  protocol: ProviderProtocol,
  apiKey: string,
  model: string,
): Promise<ProviderTestStep & { protocol: ProviderProtocol }> {
  const headers: Record<string, string> = protocol === "openai"
    ? { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" }
    : { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" };
  const body = JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "hi" }] });
  const r = await request(url, { method: "POST", headers, body });
  if (!r.ok) return { ok: false, detail: r.detail, protocol };
  if (r.status === 200) return { ok: true, detail: "密钥有效", httpStatus: 200, protocol };
  return { ok: false, detail: keyCheckErrorDetail(r.status, r.text), httpStatus: r.status, protocol };
}

/**
 * 连通 → （可选）密钥校验。地址不可达时跳过校验（省一次往返，也让清单只标地址可达 ✗）。
 * Key 校验端点按表单所选协议 + base 归一化（已是 /v1 结尾不重复拼接）。
 */
export async function testProvider(input: ProviderTestInput): Promise<ProviderTestResult> {
  const base = input.baseUrl.trim().replace(/\/+$/, "");
  const reachability = await probeReachability(base);
  const result: ProviderTestResult = { reachability };
  if (!reachability.ok || !input.verifyKey) return result;
  if (!input.model?.trim()) {
    result.keyCheck = { ok: false, detail: "未填写模型 id，无法校验密钥" };
    return result;
  }
  const apiBase = base.endsWith("/v1") ? base : `${base}/v1`;
  const anthropic = input.apiType === "anthropic-messages";
  const url = anthropic ? `${apiBase}/messages` : `${apiBase}/chat/completions`;
  result.keyCheck = await verifyKey(url, anthropic ? "anthropic" : "openai", input.apiKey, input.model.trim());
  return result;
}
