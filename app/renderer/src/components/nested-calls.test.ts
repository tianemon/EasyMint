import { describe, expect, it, vi } from "vitest";
import { applyNestedToolEvent, mapSessionMessages } from "./chat-utils";
import { buildBlocks } from "./ChatBlocks";
import type { StreamEntry } from "./StreamPanel";
vi.mock("../lib/diff-highlight", () => ({ inferLang: () => "text", tokenizeLines: () => [] }));

describe("nested tool live and history display", () => {
  it("attaches concurrent child calls to their parent without creating model tool calls", () => {
    const entries: StreamEntry[] = [{ kind: "tool_use", id: "outer", name: "codemode", input: { code: "..." }, timestamp: 1, collapsed: false }];
    const first = applyNestedToolEvent(entries, { parentToolCallId: "outer", toolCallId: "outer/1", toolName: "bash", toolArgs: { command: "echo hi" }, nestedPhase: "start" });
    const second = applyNestedToolEvent(first, { parentToolCallId: "outer", toolCallId: "outer/2", toolName: "read", toolArgs: { path: "a" }, nestedPhase: "start" });
    const finished = applyNestedToolEvent(second, { parentToolCallId: "outer", toolCallId: "outer/1", toolName: "bash", nestedPhase: "end", isError: true, content: "denied" });
    expect(finished).toHaveLength(1);
    const blocks = buildBlocks(finished) as any[];
    expect(blocks[0].items[0].nestedCalls.calls).toMatchObject([{ name: "bash", status: "error", error: "denied" }, { name: "read", status: "unfinished" }]);
  });
  it("restores persisted summaries, durations and incomplete metadata", () => {
    const nestedCalls = { calls: [{ id: "outer/1", name: "bash", status: "ok", durationMs: 23, argumentsBytes: 9000 }], complete: false };
    const messages = mapSessionMessages([
      { type: "assistant", message: { timestamp: 1, content: [{ type: "tool_use", id: "outer", name: "codemode", input: {} }] } },
      { type: "toolResult", message: { toolCallId: "outer", content: [{ type: "text", text: "done" }], nestedCalls } },
    ]);
    const blocks = buildBlocks(messages[0]!.entries!) as any[];
    expect(blocks[0].items[0].nestedCalls).toEqual(nestedCalls);
    expect(blocks[0].items[0].pending).toBe(false);
  });
});
