import { expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { bridgeSessionEvents } from "./event-bridge";
import { responsePhase } from "../../shared/response-phase";

it("carries provider phases and the terminal reason through the live bridge", () => {
  const onEvent = vi.fn();
  const content = [
    { type: "text", text: "checking", textSignature: '{"v":1,"id":"a","phase":"commentary"}' },
    { type: "text", text: "answer", textSignature: '{"v":1,"id":"b","phase":"final_answer"}' },
  ];
  bridgeSessionEvents({ type: "message_end", message: { role: "assistant", content, stopReason: "stop" } } as AgentSessionEvent,
    { onEvent, setPendingResult: vi.fn(), getSession: () => null });
  expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ stopReason: "stop", blocks: [
    { type: "text", text: "checking", phase: "commentary" }, { type: "text", text: "answer", phase: "final_answer" },
  ] }));
});
it.each([undefined, "legacy-id", "{bad", '{"v":2,"phase":"final_answer"}', '{"v":1,"phase":"unknown"}'])("ignores unsupported text signature %s", signature => {
  expect(responsePhase(signature)).toBeUndefined();
});
