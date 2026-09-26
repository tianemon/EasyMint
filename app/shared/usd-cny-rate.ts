/**
 * USD → CNY 的估算换算口径（会话统计里「估算费用」显示用）。
 *
 * 为什么需要它：Pi SDK 的模型目录里，所有模型的 `cost` 都是**美元/百万 token**——包括人民币计价的
 * 供应商（它们在中英价目页各有一套价，SDK 取的是美元列）。所以要把费用显示成 ¥ 就只能按一个汇率折算。
 *
 * 口径：中国人民银行 / 中国外汇交易中心 **人民币对美元中间价**。它是一个**会漂移的估算口径**：
 * 对人民币计价的供应商（DeepSeek 等）现在偏差约 ±2%（官方人民币价页本身也有四舍五入），
 * 美元计价的供应商还要叠用户实际扣款的汇兑差——所以显示上不假装精确（见 formatCostCny）。
 *
 * 更新策略：**每季度复核一次，或发现与官方价目页（人民币列）偏差超过 3% 时立即更新**。
 * 只需改下面这两个常量，显示层的算式与文案会自动跟着变。
 *
 * 刻意不联网取实时汇率：那会给应用增加一个周期性外部请求（见 PRIVACY.md 的说法——
 * 「唯一不来自对话的周期性外部请求是更新检查」），为这点精度不值得。
 */

/** 人民币对美元中间价（1 USD = ? CNY） */
export const USD_CNY_RATE = 6.7884;

/** 上面的汇率取自哪一天的中间价——显示层写进算式，便于用户核对 */
export const USD_CNY_RATE_DATE = "2026-08-10";

/**
 * 估算费用显示：两位小数 + `≈`（不假装精确）；金额不足 1 分钱时给 `<¥0.01`，与弹窗里「命中率」的
 * `<0.01%` 同一风格；`<= 0` 视为无数据（界面显示「—」）。
 */
export function formatCostCny(costUsd: number): string {
  if (costUsd <= 0) return "—";
  const cny = costUsd * USD_CNY_RATE;
  if (cny < 0.01) return "<¥0.01";
  return `≈¥${cny.toFixed(2)}`;
}

/** 换算算式（悬停提示用）：让用户能自己核，也一眼看出汇率是哪天的 */
export function costFormula(costUsd: number): string {
  return `$${costUsd.toFixed(4)} × ${USD_CNY_RATE}（${USD_CNY_RATE_DATE} 中间价）`;
}
