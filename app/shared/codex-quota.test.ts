import { describe, expect, it } from "vitest";
import { formatPlanLabel } from "./codex-quota";

/**
 * 弹窗标题里的套餐括号：已知值各有固定写法，未识别值按词首大写原样展示
 * （后端给出更细档位时界面自动跟上，不必改代码）。
 */
describe("formatPlanLabel", () => {
  it("已知套餐给出固定显示名", () => {
    expect(formatPlanLabel("plus")).toBe("Plus");
    expect(formatPlanLabel("pro")).toBe("Pro");
    expect(formatPlanLabel("free")).toBe("Free");
    expect(formatPlanLabel("team")).toBe("Team");
  });

  it("Pro 的更细档位（pro_lite / prolite）显示为 Pro Lite", () => {
    expect(formatPlanLabel("prolite")).toBe("Pro Lite");
    expect(formatPlanLabel("pro_lite")).toBe("Pro Lite");
  });

  it("未识别值按分隔符切词后首字母大写，不吞掉数字", () => {
    expect(formatPlanLabel("pro_5x")).toBe("Pro 5x");
    expect(formatPlanLabel("PRO-max")).toBe("Pro Max");
    expect(formatPlanLabel("PLUS")).toBe("Plus");
  });

  it("空值一律返回 undefined（标题据此不显示括号）", () => {
    expect(formatPlanLabel(undefined)).toBeUndefined();
    expect(formatPlanLabel("")).toBeUndefined();
    expect(formatPlanLabel("   ")).toBeUndefined();
  });
});
