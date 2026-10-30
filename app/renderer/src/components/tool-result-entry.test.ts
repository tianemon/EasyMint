/**
 * `toolResultEntry` 的字段契约。
 *
 * 这个函数是主会话与子 Agent 唯一的共用映射——两处曾经各写一份（加字段要凭记忆改两处）。
 * 合并后风险转移到「两边都靠它」，所以这里钉住：字段映射一个不漏、缺省值与旧实现一致、
 * 不带 `source` 时不能凭空多出这个键（子 Agent 的结果块本来就没有它）。
 */
import { describe, expect, it } from "vitest";
import { toolResultEntry } from "./chat-utils";

describe("toolResultEntry", () => {
  it("把事件字段逐个搬到 entry 上", () => {
    const entry = toolResultEntry({
      toolCallId: "call-1",
      toolName: "bash",
      content: "hello",
      isError: true,
      nestedCalls: { calls: [], complete: true },
      presentation: { kind: "edit_diff", diff: "- a\n+ b" },
      durationMs: 1200,
      imagePath: "/tmp/a.png",
      timestamp: 1_700_000_000_000,
    }, "chat");

    expect(entry).toEqual({
      kind: "tool_result",
      toolUseId: "call-1",
      name: "bash",
      content: "hello",
      isError: true,
      nestedCalls: { calls: [], complete: true },
      presentation: { kind: "edit_diff", diff: "- a\n+ b" },
      durationMs: 1200,
      imagePath: "/tmp/a.png",
      timestamp: 1_700_000_000_000,
      source: "chat",
    });
  });

  it("不给 source 时不产生 source 键（子 Agent 的结果块没有它）", () => {
    const entry = toolResultEntry({ toolCallId: "c", content: "x" });
    expect("source" in entry).toBe(false);
  });

  it("缺省值与旧的两份手写实现一致：content 空串、isError false、toolUseId 空串", () => {
    const entry = toolResultEntry({});
    expect(entry.content).toBe("");
    expect(entry.isError).toBe(false);
    expect(entry.toolUseId).toBe("");
    expect(typeof entry.timestamp).toBe("number");
  });
});
