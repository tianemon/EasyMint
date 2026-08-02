import { describe, it, expect } from "vitest";
import { bridgeSessionEvents, type PiChatEvent } from "./event-bridge";

describe("event-bridge 工具事件转换", () => {
  it("tool_execution_start → tool_progress（状态栏显示工具名）", () => {
    const events: PiChatEvent[] = [];
    bridgeSessionEvents(
      { type: "tool_execution_start", toolCallId: "tc1", toolName: "read", args: { file_path: "a.ts" } } as any,
      {
        onEvent: (ev) => events.push(ev),
        getSession: () => null,
        setPendingResult: () => {},
      },
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("tool_progress");
    expect(events[0]!.toolName).toBe("read");
    expect(events[0]!.toolArgs).toEqual({ file_path: "a.ts" });
  });

  it("message_update 的 toolCall 块 arguments → tool_use input（参数不丢）", () => {
    const events: PiChatEvent[] = [];
    bridgeSessionEvents(
      {
        type: "message_update",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "开始" },
            { type: "toolCall", id: "call_01", name: "read", arguments: { path: "/a/b.ts" } },
          ],
        },
      } as any,
      {
        onEvent: (ev) => events.push(ev),
        getSession: () => null,
        setPendingResult: () => {},
      },
    );
    const msg = events.find((e) => e.type === "message")!;
    const toolBlock = msg.blocks!.find((b) => b.type === "tool_use")!;
    expect(toolBlock.input).toEqual({ path: "/a/b.ts" });
  });

  it("tool_execution_end → tool_done（清除状态栏工具名）", () => {
    const events: PiChatEvent[] = [];
    bridgeSessionEvents(
      { type: "tool_execution_end", toolCallId: "tc1", toolName: "read", result: {}, isError: false } as any,
      {
        onEvent: (ev) => events.push(ev),
        getSession: () => null,
        setPendingResult: () => {},
      },
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("tool_done");
    expect(events[0]!.toolCallId).toBe("tc1");
    expect(events[0]!.toolName).toBe("read");
  });
});
