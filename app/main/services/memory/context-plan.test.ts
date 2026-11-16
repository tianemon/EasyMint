import { expect, it } from "vitest";
import { DEFAULT_HEADER, estimateTokens, planDelivery, type Deliverable } from "./context-plan";

const rules: Deliverable = { key: "global.rules", revision: 11, text: "约定：别先给方案再问要不要做", priority: 1 };
const progress: Deliverable = { key: "project.progress", revision: 20261115, text: "项目：11/15 合并 Windows 修复", priority: 2 };
const machine: Deliverable = { key: "machine", revision: 4411, text: "本机：Apple M2 · 8 核 · 8GB", priority: 3 };

it("首轮全量交付，并记录每条版本号", () => {
  const plan = planDelivery([machine, progress, rules]);
  expect(plan.reason).toBe("first");
  expect(plan.block.startsWith(DEFAULT_HEADER)).toBe(true);
  expect(plan.items.map((item) => item.key)).toEqual(["global.rules", "project.progress", "machine"]);
  expect(plan.items.map((item) => item.revision)).toEqual([11, 20261115, 4411]);
});

it("内容未变时完全不注入，避免扰动上下文缓存", () => {
  const delivered = new Map(planDelivery([rules, progress, machine]).items.map((item) => [item.key, item.revision]));
  const plan = planDelivery([rules, progress, machine], { delivered });
  expect(plan).toEqual({ block: "", items: [], tokens: 0, reason: "none" });
});

it("只有变化的条目产生增量，且标题保持一致", () => {
  const delivered = new Map(planDelivery([rules, progress, machine]).items.map((item) => [item.key, item.revision]));
  const plan = planDelivery([rules, { ...progress, revision: 20261116, text: "项目：11/16 记忆改造" }, machine], { delivered });
  expect(plan.reason).toBe("delta");
  expect(plan.block).toContain("11/16 记忆改造");
  expect(plan.block).not.toContain("别先给方案");
  expect(plan.block).not.toContain("Apple M2");
  expect(plan.items).toEqual([{ key: "project.progress", revision: 20261116 }]);
});

it("条目被移除时给一条统一的作废提示，不沿用旧内容", () => {
  const delivered = new Map(planDelivery([rules, progress, machine]).items.map((item) => [item.key, item.revision]));
  const plan = planDelivery([rules, machine], { delivered });
  expect(plan.reason).toBe("delta");
  expect(plan.block).toContain("已移除");
  expect(plan.items).toContainEqual({ key: "project.progress", revision: -1 });
});

it("额度不足时按优先级丢弃，且不切半句", () => {
  const big: Deliverable = { key: "big", revision: 1, text: "长".repeat(3000), priority: 9 };
  const plan = planDelivery([rules, progress, big], { allowance: 200 });
  const keys = plan.items.map((item) => item.key);
  expect(keys).toContain("global.rules");
  expect(keys).not.toContain("big");
  expect(plan.block).not.toContain("长长长");
});

it("压缩后交付记录丢失会自动回到全量交付", () => {
  expect(planDelivery([rules, progress], { delivered: new Map() }).reason).toBe("first");
});

it("token 估算按 UTF-8 保守口径，且输出与入参顺序无关", () => {
  expect(estimateTokens("中文")).toBe(2);
  const a = planDelivery([rules, progress, machine]).block;
  const b = planDelivery([machine, rules, progress]).block;
  expect(a).toBe(b);
});
