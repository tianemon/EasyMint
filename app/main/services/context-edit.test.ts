import { describe, expect, it } from "vitest";
import { imageStrippedContextIds } from "./context-edit";

describe("图片上下文编辑的历史状态", () => {
  const original = { type: "message", id: "user-1", message: { role: "user", content: [{ type: "text", text: "请看图" }, { type: "image", data: "AAAA" }] } };

  it("图片移出后仍可从原条目恢复，最近一次编辑决定标记", () => {
    const stripped = { type: "context_edit", targetId: "user-1", replacement: { content: [{ type: "text", text: "请看图" }] } };
    expect(imageStrippedContextIds([original, stripped])).toEqual(new Set(["user-1"]));
    const restored = { type: "context_edit", targetId: "user-1", replacement: { content: original.message.content } };
    expect(imageStrippedContextIds([original, stripped, restored])).toEqual(new Set());
    expect(imageStrippedContextIds([original, stripped, { type: "context_edit", targetId: "user-1", replacement: null }])).toEqual(new Set());
  });
});
