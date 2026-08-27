/**
 * API 错误归一化 — 前后端共用。
 * 将上游 LLM 的原始错误(503 JSON/堆栈)转成用户友好的中文提示,
 * 避免状态栏/消息区直接显示原始错误文本。
 */
export function normalizeApiError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // abort 是用户打断/主动中止的正常副作用（fetch AbortError 标准文案），非错误
  if (/abort|aborted|cancelled|canceled|operation was aborted/i.test(msg)) {
    return "已停止";
  }
  if (/503|service_unavailable|Service is too busy/i.test(msg)) {
    return "AI 服务繁忙(503)，请稍后重试，或切换模型/服务商";
  }
  if (/429|rate.?limit/i.test(msg)) {
    return "请求过于频繁，请稍后再试";
  }
  if (/timeout|timed out|超时/i.test(msg)) {
    return "请求超时，请稍后重试";
  }
  return msg.length > 120 ? msg.slice(0, 120) + "…" : msg;
}
