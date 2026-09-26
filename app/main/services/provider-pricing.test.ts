import { describe, expect, it } from "vitest";
import { adjustCostForTimePricing, isDeepSeekOffPeak, summarizeTimePricing, type PricingEntry } from "./provider-pricing";

/** 造一个带时间戳的 assistant 消息条目 */
function turn(iso: string, cost: number, provider?: string): PricingEntry {
  return provider
    ? { type: "model_change", timestamp: iso, provider }
    : { type: "message", timestamp: iso, message: { role: "assistant", usage: { cost: { total: cost } } } };
}

describe("isDeepSeekOffPeak 时段判定", () => {
  it("工作日高峰窗口内为高峰（UTC 01:00–04:00、06:00–10:00）", () => {
    expect(isDeepSeekOffPeak(new Date("2026-09-25T01:00:00Z"))).toBe(false); // 周五（北京 09:00）
    expect(isDeepSeekOffPeak(new Date("2026-09-25T03:59:00Z"))).toBe(false);
    expect(isDeepSeekOffPeak(new Date("2026-09-25T06:00:00Z"))).toBe(false); // 北京 14:00
    expect(isDeepSeekOffPeak(new Date("2026-09-25T09:59:00Z"))).toBe(false);
  });

  it("工作日高峰窗口之外为空闲", () => {
    expect(isDeepSeekOffPeak(new Date("2026-09-25T00:59:00Z"))).toBe(true);
    expect(isDeepSeekOffPeak(new Date("2026-09-25T04:00:00Z"))).toBe(true); // 窗口右开
    expect(isDeepSeekOffPeak(new Date("2026-09-25T05:30:00Z"))).toBe(true);
    expect(isDeepSeekOffPeak(new Date("2026-09-25T10:00:00Z"))).toBe(true); // 北京 18:00 起空闲
    expect(isDeepSeekOffPeak(new Date("2026-09-25T23:00:00Z"))).toBe(true);
  });

  it("周末全天为空闲（含工作日的同一钟点）", () => {
    expect(isDeepSeekOffPeak(new Date("2026-09-26T02:00:00Z"))).toBe(true); // 周六
    expect(isDeepSeekOffPeak(new Date("2026-09-27T07:00:00Z"))).toBe(true); // 周日
  });
});

describe("summarizeTimePricing 逐轮折算", () => {
  it("全部落在空闲时段 → 折算为一半", () => {
    const entries = [
      { type: "model_change", timestamp: "2026-09-25T10:00:00Z", provider: "deepseek" } as PricingEntry,
      turn("2026-09-25T10:05:00Z", 4),
      turn("2026-09-25T10:10:00Z", 6),
    ];
    const summary = summarizeTimePricing(entries)!;
    expect(summary.peakUsd).toBe(10);
    expect(summary.adjustedUsd).toBe(5);
    expect(summary.hasOffPeakTurns).toBe(true);
    expect(adjustCostForTimePricing(10, summary)).toEqual({ cost: 5, costPeak: 10, costBasis: "deepseek-offpeak" });
  });

  it("跨过 18:00（北京）边界 → 按各自时段分别计，比例介于 0.5 与 1 之间", () => {
    const entries = [
      { type: "model_change", timestamp: "2026-09-25T09:00:00Z", provider: "deepseek" } as PricingEntry,
      turn("2026-09-25T09:30:00Z", 3),  // 高峰（北京 17:30）
      turn("2026-09-25T10:00:00Z", 9),  // 空闲（北京 18:00）
    ];
    const summary = summarizeTimePricing(entries)!;
    expect(summary.peakUsd).toBe(12);
    expect(summary.adjustedUsd).toBe(3 + 4.5);
    // 用户实测形态：官方账单 1.32 元、程序按高峰价显示 2.5 元 → 比例 1.894
    expect(12 / summary.adjustedUsd).toBeCloseTo(1.6, 5);
  });

  it("全程高峰 → 不折算，但标出口径", () => {
    const entries = [
      { type: "model_change", timestamp: "2026-09-25T02:00:00Z", provider: "deepseek" } as PricingEntry,
      turn("2026-09-25T02:30:00Z", 5),
    ];
    const summary = summarizeTimePricing(entries)!;
    expect(summary.hasOffPeakTurns).toBe(false);
    expect(adjustCostForTimePricing(5, summary)).toEqual({ cost: 5, costBasis: "deepseek-peak" });
  });

  it("非 DeepSeek 供应商不折算、不标口径", () => {
    const entries = [
      { type: "model_change", timestamp: "2026-09-25T10:00:00Z", provider: "anthropic" } as PricingEntry,
      turn("2026-09-25T10:05:00Z", 4),
    ];
    const summary = summarizeTimePricing(entries)!;
    expect(summary.hasTimeBasedTurns).toBe(false);
    expect(adjustCostForTimePricing(4, summary)).toEqual({ cost: 4 });
  });

  it("会话中途切到 DeepSeek：只折算切换之后的轮次", () => {
    const entries = [
      turn("2026-09-25T10:05:00Z", 2), // 无 provider 信息 → 不折算
      { type: "model_change", timestamp: "2026-09-25T10:10:00Z", provider: "deepseek" } as PricingEntry,
      turn("2026-09-25T10:15:00Z", 2), // 空闲 → 半价
    ];
    const summary = summarizeTimePricing(entries)!;
    expect(summary.adjustedUsd).toBe(3);
    expect(summary.peakUsd).toBe(4);
  });

  it("用量条目（缓存预热等）按自带 provider 判定", () => {
    const entries = [
      { type: "usage", timestamp: "2026-09-25T11:00:00Z", provider: "deepseek", usage: { cost: { total: 2 } } } as PricingEntry,
    ];
    const summary = summarizeTimePricing(entries)!;
    expect(summary.adjustedUsd).toBe(1);
  });

  it("无 usage.cost 的条目（工具结果 / 无计费消息）被忽略", () => {
    const summary = summarizeTimePricing([
      { type: "message", timestamp: "2026-09-25T11:00:00Z", message: { role: "user" } } as PricingEntry,
      { type: "message", timestamp: "2026-09-25T11:00:01Z", message: { role: "assistant", usage: {} } } as PricingEntry,
      { type: "label", timestamp: "2026-09-25T11:00:02Z" } as PricingEntry,
    ])!;
    expect(summary.peakUsd).toBe(0);
    expect(adjustCostForTimePricing(1.5, summary)).toEqual({ cost: 1.5 });
  });

  it("非法时间戳不参与折算（按高峰处理）", () => {
    const entries = [
      { type: "model_change", timestamp: "2026-09-25T10:00:00Z", provider: "deepseek" } as PricingEntry,
      { type: "message", timestamp: "not-a-date", message: { role: "assistant", usage: { cost: { total: 2 } } } } as PricingEntry,
    ];
    const summary = summarizeTimePricing(entries)!;
    expect(summary.adjustedUsd).toBe(2);
    expect(summary.hasOffPeakTurns).toBe(false);
  });

  it("summary 为 null 时原样返回（读不到 transcript 的兜底）", () => {
    expect(adjustCostForTimePricing(2.5, null)).toEqual({ cost: 2.5 });
  });
});
