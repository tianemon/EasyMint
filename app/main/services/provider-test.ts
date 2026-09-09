/**
 * 供应商「测试接口」——分层探测 baseUrl / Key / 模型（设置页「测试接口」按钮的唯一实现）。
 *
 * 分层语义照抄 cc-switch（src-tauri/src/services/stream_check.rs:205-231）：
 * 地址可达只看「能否拿到 HTTP 响应」——任何状态码（401/403/404/500）都算可达，
 * 仅 DNS 失败 / 连接失败 / TLS 错误 / 超时算不可达。其早期版本曾发真实模型请求，
 * 因第三方网关 401/403/WAF 误报被替换——这里沿用，避免把网关限制误判成 Key 无效。
 *
 * 只用 Node 内置 fetch（主进程 CJS bundle 对外部 ESM-only 包敏感，不引新依赖）。
 * apiKey 只进请求头：日志、返回文案、错误信息都不带它。
 */

import type { ProviderProtocol, ProviderProtocolTest, ProviderTestResult, ProviderTestStep } from "../../shared/provider-test";

const TIMEOUT_MS = 15_000;

export interface ProviderTestInput {
  baseUrl: string;
  apiKey: string;
  /** 表单里已填的默认模型 id（Key 校验必需） */
  model?: string;
  /** 表单里选择的协议（两种协议都通时用它决定校验哪个） */
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
    // 读 body 失败不影响「有响应」这一事实（模型列表/错误详情退化为空）
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

/** 从模型列表响应里解析出模型 id（兼容 OpenAI/Anthropic 的 data[] 与部分网关的 models[]） */
function parseModelIds(text: string): string[] | null {
  let json: { data?: unknown; models?: unknown };
  try { json = JSON.parse(text) as typeof json; } catch { return null; }
  const list = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : null;
  if (!list) return null;
  return list
    .map((m) => (typeof m === "string" ? m : ((m as { id?: string }).id ?? "")))
    .filter((id) => id.length > 0);
}

/** 模型列表端点的错误文案映射（口径同 cc-switch src/lib/api/model-fetch.ts:74-107） */
function modelListErrorDetail(status: number): string {
  if (status === 401 || status === 403) return "认证被拒绝（Key 可能无效，也可能是网关限制）";
  if (status === 404 || status === 405) return "该端点无模型列表接口";
  if (status >= 500) return `服务端错误（HTTP ${status}）`;
  return `HTTP ${status}`;
}

/** 步骤二：单协议模型列表探测，200 即判定支持该协议 */
async function probeModelList(url: string, protocol: ProviderProtocol, apiKey: string): Promise<ProviderProtocolTest> {
  const headers: Record<string, string> = protocol === "openai"
    ? { Authorization: `Bearer ${apiKey}` }
    : { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  const r = await request(url, { method: "GET", headers });
  if (!r.ok) return { ok: false, detail: r.detail };
  if (r.status !== 200) return { ok: false, detail: modelListErrorDetail(r.status), httpStatus: r.status };
  const ids = parseModelIds(r.text);
  return {
    ok: true,
    detail: ids && ids.length > 0 ? `${ids.length} 个模型` : "已响应，但未解析出模型列表",
    httpStatus: 200,
    modelCount: ids?.length ?? 0,
  };
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

/** 步骤三：按协议发 max_tokens=1 的最小调用（约 10 token） */
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
 * 分层探测：地址可达 → 双协议模型列表 → （可选）Key 校验。
 * 地址不可达时后续步骤必然失败，直接跳过（省一次往返，也让清单只标地址可达 ✗）。
 */
export async function testProvider(input: ProviderTestInput): Promise<ProviderTestResult> {
  const base = input.baseUrl.trim().replace(/\/+$/, "");
  const reachability = await probeReachability(base);
  if (!reachability.ok) {
    return {
      reachability,
      modelList: {
        openai: { ok: false, detail: "地址不可达，未探测" },
        anthropic: { ok: false, detail: "地址不可达，未探测" },
      },
    };
  }

  // 表单占位符形如 https://api.example.com/v1，已带 /v1 时不再重复拼接（否则 A 系会变成 /v1/v1/messages）
  const hasV1 = base.endsWith("/v1");
  const [openai, anthropic] = await Promise.all([
    probeModelList(`${base}/models`, "openai", input.apiKey),
    probeModelList(hasV1 ? `${base}/models` : `${base}/v1/models`, "anthropic", input.apiKey),
  ]);
  const result: ProviderTestResult = { reachability, modelList: { openai, anthropic } };

  if (!input.verifyKey) return result;
  if (!input.model?.trim()) {
    result.keyCheck = { ok: false, detail: "未填写模型 id，无法校验密钥" };
    return result;
  }
  const supported = (["openai", "anthropic"] as const).filter((p) => result.modelList[p].ok);
  // 两种协议都通时按表单选择的协议校验（用户实际用的那个）；只通一种就用那种
  const protocol: ProviderProtocol | undefined = supported.length === 1
    ? supported[0]
    : supported.length === 2
      ? (input.apiType === "anthropic-messages" ? "anthropic" : "openai")
      : undefined;
  if (!protocol) {
    result.keyCheck = { ok: false, detail: "模型列表未通过，无法判定协议" };
    return result;
  }
  const keyUrl = protocol === "openai"
    ? `${base}/chat/completions`
    : hasV1 ? `${base}/messages` : `${base}/v1/messages`;
  result.keyCheck = await verifyKey(keyUrl, protocol, input.apiKey, input.model.trim());
  return result;
}
