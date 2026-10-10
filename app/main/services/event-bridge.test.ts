import { describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "./pi-sdk";
import { bridgeSessionEvents } from "./event-bridge";

describe("Pi settled and response metadata", () => {
  it("does not end on a retried low-level run and distinguishes final cancellation", () => {
    const setPendingResult = vi.fn(), onEvent = vi.fn();
    const callbacks = { onEvent, setPendingResult, getSession: () => ({ getLastAssistantText: () => "", messages: [{ role: "assistant", stopReason: "error" }] }) };
    bridgeSessionEvents({ type: "agent_end", willRetry: true, messages: [] } as AgentSessionEvent, callbacks);
    expect(setPendingResult).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
    bridgeSessionEvents({ type: "agent_settled", aborted: true }, callbacks);
    expect(setPendingResult).toHaveBeenLastCalledWith(expect.objectContaining({ type: "turn_end", outcome: "cancelled" }));
    bridgeSessionEvents({ type: "agent_settled", aborted: false }, callbacks);
    expect(setPendingResult).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: "failed" }));
  });
  it.each([
    { type: "compaction_end", aborted: true },
    { type: "compaction_end", aborted: false, errorMessage: "failed" },
    { type: "compaction_end", aborted: false, result: { summary: "summary" } },
  ])("ends the compaction UI lifetime for $aborted / $errorMessage", event => {
    const onEvent = vi.fn();
    bridgeSessionEvents(event as AgentSessionEvent, { onEvent, setPendingResult: vi.fn(), getSession: () => null });
    expect(onEvent).toHaveBeenLastCalledWith(expect.objectContaining({ type: "compaction_finished" }));
    const types = onEvent.mock.calls.map(([event]) => event.type);
    expect(types.includes("compacted")).toBe("result" in event);
    expect(types.includes("error")).toBe("errorMessage" in event);
  });

  it("preserves the physical model and zero response/tool durations", () => {
    const onEvent = vi.fn();
    const callbacks = { onEvent, setPendingResult: vi.fn(), getSession: () => null };
    bridgeSessionEvents({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }], provider: "physical", model: "fast", durationMs: 0 } } as AgentSessionEvent, callbacks);
    expect(onEvent).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "physical", model: "fast", durationMs: 0 }));
    bridgeSessionEvents({ type: "tool_execution_end", toolCallId: "id", toolName: "edit", durationMs: 0 } as AgentSessionEvent, callbacks);
    expect(onEvent).toHaveBeenLastCalledWith(expect.objectContaining({ type: "tool_done", durationMs: 0 }));
  });
});
