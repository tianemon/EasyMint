import { describe, it, expect } from "vitest";
import { lookupBySegmentPrefix } from "./pi-init-static";

/** 模拟静态表（deepseek 同族 + 近亲干扰项） */
const table = new Map<string, { id: string }>([
  ["deepseek-v4-flash", { id: "deepseek-v4-flash" }],
  ["deepseek-v4-flash-vision-exp", { id: "deepseek-v4-flash-vision-exp" }],
  ["deepseek-v4-pro", { id: "deepseek-v4-pro" }],
  ["gpt-4", { id: "gpt-4" }],
  ["gpt-4o", { id: "gpt-4o" }],
]);

describe("段级模糊反查（同品牌新版本继承能力）", () => {
  it("内测版本号命中基础型号：deepseek-v4.1-flash-expires-on-0910 → deepseek-v4-flash", () => {
    const hit = lookupBySegmentPrefix(table, "deepseek-v4.1-flash-expires-on-0910");
    expect(hit?.id).toBe("deepseek-v4-flash");
  });

  it("匹配段数相同取 id 最短（基础型号优先于带后缀变体）", () => {
    const hit = lookupBySegmentPrefix(table, "deepseek-v4.2-flash-preview");
    expect(hit?.id).toBe("deepseek-v4-flash");
  });

  it("段内前缀需边界：gpt-4o 不命中 gpt-4（4o 的 4 后接字母）", () => {
    expect(lookupBySegmentPrefix(table, "gpt-4o")).toBeUndefined();
  });

  it("只匹配 1 段（品牌）不命中，至少 2 段", () => {
    expect(lookupBySegmentPrefix(table, "deepseek-x1")).toBeUndefined();
  });

  it("更具体的变体不作为继承源（继承源段数不得超过目标）", () => {
    const hit = lookupBySegmentPrefix(table, "deepseek-v4-flash");
    expect(hit?.id).not.toBe("deepseek-v4-flash-vision-exp");
  });
});
