import { describe, expect, it } from "vitest";
import { costFormula, formatCostCny, USD_CNY_RATE, USD_CNY_RATE_DATE } from "./usd-cny-rate";

describe("formatCostCny 估算费用显示", () => {
  it("两位小数 + ≈（不假装精确）", () => {
    expect(formatCostCny(1)).toBe(`≈¥${(1 * USD_CNY_RATE).toFixed(2)}`);
    expect(formatCostCny(0.4273)).toBe("≈¥2.90");
  });

  it("不足 1 分钱给 <¥0.01，与弹窗里「命中率」的 <0.01% 同风格", () => {
    expect(formatCostCny(0.0001)).toBe("<¥0.01");
  });

  it("无数据（<= 0）显示「—」", () => {
    expect(formatCostCny(0)).toBe("—");
    expect(formatCostCny(-1)).toBe("—");
  });
});

describe("costFormula 换算算式", () => {
  it("给出美元值、汇率与报价日，便于核对", () => {
    expect(costFormula(0.4268)).toBe(`$0.4268 × ${USD_CNY_RATE}（${USD_CNY_RATE_DATE} 中间价）`);
  });

  it("汇率与报价日是常量（改这一处即可全站生效）", () => {
    expect(USD_CNY_RATE).toBeGreaterThan(1);
    expect(USD_CNY_RATE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
