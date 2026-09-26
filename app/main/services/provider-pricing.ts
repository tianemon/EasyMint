/**
 * 带时段定价的供应商（目前只有 DeepSeek）：把 SDK 按高峰价算出的费用，按每轮发生的时段折算。
 *
 * 背景：SDK 的模型目录里 deepseek 的单价就是官方**高峰价**（deepseek-v4-pro：输入未命中 $1.32 /
 * 输出 $3.96 / 命中 $0.044，与官方价目表的 PEAK 列逐项一致），而 DeepSeek 的空闲时段是**半价**。
 * 官方口径（api-docs.deepseek.com/quick_start/pricing）：
 *
 *   高峰 = 工作日 UTC 01:00–04:00 与 06:00–10:00（= 北京时间 09:00–12:00、14:00–18:00）
 *   其余时间（含整个周末与中国法定假日）全部为空闲时段，按高峰价的一半计费
 *
 * 不折算时，非高峰时段的用量会被高估最多一倍——用户实测：一次跨过 18:00 边界的会话，
 * 官方账单 1.32 元而程序显示 2.5 元。
 *
 * 中国法定节假日取 `cn-holidays.generated.ts`（国务院公告，由 scripts/gen-cn-holidays.mjs 生成）。
 * 为什么不自己算农历：节日的**实际放假日与调休是每年公告定的**（春节从除夕还是初一开始、连休几天），
 * 农历只能推出节日当天、推不出放假区间；公告未发布的年份，表里没有对应条目（按工作日 + 周末近似）。
 */

import { CN_HOLIDAYS } from "./cn-holidays.generated";

/** usage 里与计价有关的部分（SDK 已在每轮把 cost 算好写进 transcript） */
interface UsageLike {
  cost?: { total?: number };
}

/** transcript 条目里本模块用得到的字段（结构见 Pi SDK 的 SessionEntry） */
export interface PricingEntry {
  type?: string;
  /** ISO 时间串；折算按这一轮发生的时刻判定 */
  timestamp?: string;
  /** model_change / usage 条目携带 */
  provider?: string;
  message?: { role?: string; usage?: UsageLike };
  usage?: UsageLike;
}

export interface TimePricingSummary {
  /** transcript 里按高峰价累计的费用（仅为算比例用，与 SDK 的会话合计可能有微小出入） */
  peakUsd: number;
  /** 逐轮按各自时段折算后的费用 */
  adjustedUsd: number;
  /** 是否存在按 DeepSeek 规则计价的轮次 */
  hasTimeBasedTurns: boolean;
  /** 是否真有轮次落在空闲时段（即发生了折算） */
  hasOffPeakTurns: boolean;
}

/** 按北京时间（UTC+8）取日期串——法定节假日按中国日期定义，不能用 UTC 日期判 */
function beijingDateKey(at: Date): string {
  return new Date(at.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 是否为中国法定节假日（数据见 cn-holidays.generated.ts；未覆盖的年份返回 false） */
function isCnHoliday(at: Date): boolean {
  const key = beijingDateKey(at);
  return CN_HOLIDAYS[key.slice(0, 4)]?.includes(key) ?? false;
}

/** 高峰时段（UTC 小时，左闭右开） */
const DEEPSEEK_PEAK_WINDOWS_UTC: Array<[number, number]> = [[1, 4], [6, 10]];

/** DeepSeek 的空闲时段判定：法定节假日与周末全天 + 工作日高峰窗口之外 */
export function isDeepSeekOffPeak(at: Date): boolean {
  if (isCnHoliday(at)) return true; // 官方口径明确把中国法定节假日排除在高峰之外
  const day = at.getUTCDay();
  if (day === 0 || day === 6) return true; // 周末按官方口径全天空闲
  const hour = at.getUTCHours() + at.getUTCMinutes() / 60;
  const inPeak = DEEPSEEK_PEAK_WINDOWS_UTC.some(([from, to]) => hour >= from && hour < to);
  return !inPeak;
}

/** 某供应商空闲时段的折扣系数（1 = 无时段优惠） */
export function offPeakFactor(provider: string | undefined): number {
  return provider === "deepseek" ? 0.5 : 1;
}

/** usage 的聚合值（与 SDK 的 usage-totals 同口径） */
export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

/** 累加条目里的 token 与费用（费用用条目里已算好的 usage.cost.total） */
export function sumUsage(entries: Iterable<PricingEntry>): UsageTotals {
  const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const usage = (entry.type === "message" ? entry.message?.usage : entry.usage) as
      | { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } }
      | undefined;
    if (!usage) continue;
    totals.input += usage.input ?? 0;
    totals.output += usage.output ?? 0;
    totals.cacheRead += usage.cacheRead ?? 0;
    totals.cacheWrite += usage.cacheWrite ?? 0;
    if (usage.cost?.total) totals.costUsd += usage.cost.total;
  }
  return totals;
}

/**
 * 遍历 transcript 条目，按每轮的时间戳累计「高峰价合计」与「时段折算后合计」。
 * 逐轮计价用条目里已算好的 `usage.cost.total`（SDK 写的），本模块不重算单价。
 */
export function summarizeTimePricing(entries: Iterable<PricingEntry>): TimePricingSummary {
  let provider: string | undefined;
  let peakUsd = 0;
  let adjustedUsd = 0;
  let hasTimeBasedTurns = false;
  let hasOffPeakTurns = false;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.type === "model_change") {
      if (entry.provider) provider = entry.provider;
      continue;
    }
    // 计费条目：消息（assistant / toolResult 都可能带 usage）、用量条目（缓存预热等）
    // 与压缩/分支摘要 LLM 调用——口径对齐 SDK 的 getSessionStats（agent-session.js）
    const usage = entry.type === "message" ? entry.message?.usage : entry.usage;
    const cost = usage?.cost?.total;
    if (!cost) continue;

    // 用量条目自带 provider（与当前模型可能不同），以它为准
    const turnProvider = (entry.type === "usage" ? entry.provider : undefined) ?? provider;
    const factor = offPeakFactor(turnProvider);
    const at = entry.timestamp ? new Date(entry.timestamp) : null;
    const offPeak = factor < 1 && !!at && !Number.isNaN(at.getTime()) && isDeepSeekOffPeak(at);

    peakUsd += cost;
    adjustedUsd += offPeak ? cost * factor : cost;
    if (factor < 1) hasTimeBasedTurns = true;
    if (offPeak) hasOffPeakTurns = true;
  }

  return { peakUsd, adjustedUsd, hasTimeBasedTurns, hasOffPeakTurns };
}

export interface AdjustedCost {
  /** 折算后的费用（与传入的 cost 同单位） */
  cost: number;
  /** 未折算的高峰价合计；仅当发生折算时给出 */
  costPeak?: number;
  /** 费用口径（供界面标注）；无时段定价的会话为 undefined */
  costBasis?: "deepseek-offpeak" | "deepseek-peak";
  /** 实际用的时段系数（0.5~1）；供调用方把各部分拆开如实展示 */
  ratio?: number;
}

/**
 * 把 SDK 给的会话费用按时段折算。
 * 用**比例**而非替换总额：SDK 的合计口径（消息之外还有压缩/用量条目）与逐轮遍历不完全一致，
 * 只按比例缩放可保持与 SDK 同源。
 */
export function adjustCostForTimePricing(costUsd: number, summary: TimePricingSummary | null): AdjustedCost {
  if (!summary || !summary.hasTimeBasedTurns || summary.peakUsd <= 0) return { cost: costUsd };
  if (!summary.hasOffPeakTurns) return { cost: costUsd, costBasis: "deepseek-peak", ratio: 1 };
  const ratio = summary.adjustedUsd / summary.peakUsd;
  return { cost: costUsd * ratio, costPeak: costUsd, costBasis: "deepseek-offpeak", ratio };
}
