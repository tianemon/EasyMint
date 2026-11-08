/**
 * 桌面端命令结果（kind: result）的载荷解析。
 *
 * 抽成纯函数是为了能单测「错误码有没有留住」：桌面端在
 * `remote-terminal-service.ts` 回 `{ ok: false, error: { code, message } }`，
 * 其中 `code` 是 `COMMAND_FAILED` / `ABORT_TIMEOUT` 等可判定状态。
 * 调用方（`useSessionActions.stop`）靠它区分「停止未确认」这类可恢复状态，
 * 所以不能只把 message 塞进 Error 就丢掉 code，也不能靠文本匹配。
 */
export type RemoteResultPayload = {
  ok?: boolean;
  data?: unknown;
  error?: { code?: string; message?: string };
};

/** 成功返回 null；失败返回带 code 的 Error。 */
export function resultError(payload: RemoteResultPayload): (Error & { code?: string }) | null {
  if (payload.ok) return null;
  const error = new Error(payload.error?.message || '命令执行失败') as Error & { code?: string };
  if (payload.error?.code) error.code = payload.error.code;
  return error;
}
