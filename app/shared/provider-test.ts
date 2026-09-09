/**
 * 供应商「测试接口」结果类型 —— 主进程探测（services/provider-test.ts）与设置页清单共用。
 *
 * 分三步：地址可达（0 token）→ 双协议模型列表（0 token）→ Key 校验（可选，消耗 token）。
 */

/** 单步结果：通过时 detail 是明细，失败时 detail 是原因 */
export interface ProviderTestStep {
  ok: boolean;
  detail: string;
  /** 有 HTTP 响应时的状态码（网络层失败无值） */
  httpStatus?: number;
}

/** 单协议模型列表探测结果 */
export interface ProviderProtocolTest extends ProviderTestStep {
  /** 解析出的模型条目数（仅 200 且解析成功时有值） */
  modelCount?: number;
}

export type ProviderProtocol = "openai" | "anthropic";

export interface ProviderTestResult {
  /** 步骤一：GET baseUrl，任何 HTTP 状态算可达 */
  reachability: ProviderTestStep & { ms: number };
  /** 步骤二：两种协议都试，哪个 200 就支持哪个 */
  modelList: Record<ProviderProtocol, ProviderProtocolTest>;
  /** 步骤三：Key 校验（用户未勾选时不返回） */
  keyCheck?: ProviderTestStep & { protocol?: ProviderProtocol };
}
