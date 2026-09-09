/**
 * 供应商「测试接口」结果类型 —— 主进程探测（services/provider-test.ts）与设置页清单共用。
 *
 * 2026-09-09 起只做一件事：地址可达（连通测试）。
 * 模型列表、支持协议、密钥校验均已移除——各家模型列表/校验端点五花八门，
 * 只有「GET base 能否拿到 HTTP 响应」对任何供应商都成立。
 */

/** 连通结果 */
export interface ProviderReachability {
  ok: boolean;
  /** 通过时 = HTTP 状态 + 耗时；失败时 = 用户可读原因 */
  detail: string;
  /** 有 HTTP 响应时的状态码（网络层失败无值） */
  httpStatus?: number;
  /** 请求耗时 ms */
  ms: number;
}

export interface ProviderTestResult {
  reachability: ProviderReachability;
}
