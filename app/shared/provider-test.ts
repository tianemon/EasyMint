/**
 * 供应商「测试接口」结果类型 —— 主进程探测（services/provider-test.ts）与设置页清单共用。
 *
 * 2026-09-09 起只做两件事（用户决定：各家模型列表接口不同，不做模型列表测试）：
 *   1. 地址可达（连通，0 token，GET base 任何 HTTP 状态都算可达）
 *   2. 密钥校验（可选勾选，按表单所选协议发 max_tokens=1 最小请求，约 10 token）
 */

/** 单步结果：通过时 detail 是明细，失败时 detail 是原因 */
export interface ProviderTestStep {
  ok: boolean;
  detail: string;
  /** 有 HTTP 响应时的状态码（网络层失败无值） */
  httpStatus?: number;
}

export type ProviderProtocol = "openai" | "anthropic";

export interface ProviderTestResult {
  /** 步骤一：GET baseUrl，任何 HTTP 状态算可达 */
  reachability: ProviderTestStep & { ms: number };
  /** 步骤二：密钥校验（用户未勾选时不返回） */
  keyCheck?: ProviderTestStep & { protocol?: ProviderProtocol };
}
