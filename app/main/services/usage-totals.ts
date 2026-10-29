/**
 * transcript 条目的 token 汇总（口径与 SDK 的 usage-totals 一致）。
 *
 * 费用估算（含 DeepSeek 分时定价折算、USD→CNY 折算提示）已于 2026-10-29 整体移除：
 * 那个数字既不是用户的实付（订阅制供应商按 token 单价折算出来的只是"等价 API 花费"），
 * 也与账单对不上，摆在会话统计里只会误导。现在这里只负责 token。
 */

/** usage 里本模块用得到的部分 */
interface UsageLike {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
}

/** transcript 条目里本模块用得到的字段（结构见 Pi SDK 的 SessionEntry） */
export interface UsageEntry {
  type?: string;
  message?: { usage?: UsageLike };
  usage?: UsageLike;
}

/** usage 的聚合值 */
export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** 累加条目里的 token（消息条目与用量条目都算，与 SDK 同口径） */
export function sumUsage(entries: Iterable<UsageEntry>): UsageTotals {
  const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const usage = entry.type === "message" ? entry.message?.usage : entry.usage;
    if (!usage) continue;
    totals.input += usage.input ?? 0;
    totals.output += usage.output ?? 0;
    totals.cacheRead += usage.cacheRead ?? 0;
    totals.cacheWrite += usage.cacheWrite ?? 0;
  }
  return totals;
}
