/**
 * 会话待办校验规则单测（todo_write 全量替换语义——docs/design/会话待办功能设计方案.md §8 验收）。
 */
import { describe, it, expect } from "vitest";
import { validateSessionTodos } from "./session-todos";

describe("validateSessionTodos（todo_write 校验）", () => {
  it("合法清单通过（多项 + 单 in_progress）", () => {
    expect(validateSessionTodos([
      { content: "核实 task.json 真实进度", status: "completed" },
      { content: "委派 Builder 实现 id=3", status: "in_progress" },
      { content: "Evaluator 验收 id=3", status: "pending" },
    ])).toBeNull();
  });
  it("空数组拒绝（至少 1 项）", () => {
    expect(validateSessionTodos([])).toContain("至少 1 项");
  });
  it("超过 20 项拒绝", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ content: `步骤 ${i}`, status: "pending" as const }));
    expect(validateSessionTodos(many)).toContain("最多 20 项");
  });
  it("空 content 拒绝", () => {
    expect(validateSessionTodos([{ content: "  ", status: "pending" }])).toContain("不能为空");
  });
  it("content 超长（>200）拒绝", () => {
    expect(validateSessionTodos([{ content: "长".repeat(201), status: "pending" }])).toContain("超长");
  });
  it("非法 status 拒绝", () => {
    expect(validateSessionTodos([{ content: "x", status: "doing" as never }])).toContain("status 非法");
  });
  it("多个 in_progress 拒绝（当前焦点唯一）", () => {
    expect(validateSessionTodos([
      { content: "a", status: "in_progress" },
      { content: "b", status: "in_progress" },
    ])).toContain("至多 1 项");
  });
});
