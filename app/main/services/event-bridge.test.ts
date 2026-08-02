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
