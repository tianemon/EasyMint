import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPiRunStatus, restorePiRunStatus } from "./pi-run-status";
import { useStatusStore } from "../stores/status-store";
import { useAskStore } from "../stores/ask-store";

afterEach(() => { useStatusStore.getState().reset(); useAskStore.setState({ asks: {} }); vi.useRealTimers(); });
describe("Pi status transitions", () => {
  it("handles a normal run and an interrupted run without leaking dialog signals", () => {
    applyPiRunStatus("normal", { type: "waiting_user", waiting: true });
    expect(useStatusStore.getState().bySession.normal?.signals[0]?.id).toBe("dialog");
    applyPiRunStatus("normal", { type: "turn_end", outcome: "completed" });
    expect(useStatusStore.getState().bySession.normal?.signals.map(signal => signal.id)).toEqual(["outcome"]);
    applyPiRunStatus("stopped", { type: "waiting_user", waiting: true }, true);
    expect(useStatusStore.getState().bySession.stopped?.signals ?? []).toEqual([]);
    applyPiRunStatus("stopped", { type: "turn_end", outcome: "cancelled" }, true);
    expect(useStatusStore.getState().bySession.stopped?.signals[0]?.id).toBe("outcome");
    expect(useStatusStore.getState().bySession.normal?.signals).toHaveLength(1);
  });
  it("clears active signals at settlement while retaining the actual error", () => {
    const status = useStatusStore.getState();
    for (const id of ["request", "retry", "dialog", "stopping", "tool:a", "tool:b", "error"]) status.pushSignal("s", id, id);
    applyPiRunStatus("s", { type: "turn_end", outcome: "failed" });
    expect(useStatusStore.getState().bySession.s?.signals.map(signal => signal.id)).toEqual(["error", "outcome"]);
    applyPiRunStatus("s", { type: "turn_start" });
    expect(useStatusStore.getState().bySession.s?.signals).toEqual([]);
  });
  it("never invents success for an outcome-less event", () => {
    applyPiRunStatus("s", { type: "turn_end" });
    expect(useStatusStore.getState().bySession.s?.signals ?? []).toEqual([]);
  });
  it("expires the result without clearing another session or the next run", () => {
    vi.useFakeTimers();
    applyPiRunStatus("one", { type: "turn_end", outcome: "completed" });
    applyPiRunStatus("two", { type: "waiting_user", waiting: true });
    vi.advanceTimersByTime(3999);
    expect(useStatusStore.getState().bySession.one?.signals).toHaveLength(1);
    applyPiRunStatus("one", { type: "turn_start" });
    useStatusStore.getState().pushSignal("one", "request", "new run");
    vi.advanceTimersByTime(1);
    expect(useStatusStore.getState().bySession.one?.signals[0]?.text).toBe("new run");
    expect(useStatusStore.getState().bySession.two?.signals[0]?.id).toBe("dialog");
  });
  it("restores waiting and compaction without crossing session boundaries or inventing completion", () => {
    useAskStore.getState().setAsk({ sessionId: "other", requestId: "other", questions: [], allowCustom: true });
    restorePiRunStatus("s", { busy: true, running: true, sdkIdle: false, compacting: true, waiting: true,
      pendingAsks: [{ sessionId: "s", requestId: "ask", questions: [], allowCustom: true, createdAt: 1 }] });
    expect(useStatusStore.getState().bySession.s?.compacting).toBe(true);
    expect(useStatusStore.getState().bySession.s?.signals.map(signal => signal.id)).toEqual(["request", "compact", "dialog"]);
    applyPiRunStatus("s", { type: "compaction_finished" });
    expect(useStatusStore.getState().bySession.s?.compacting).toBe(false);
    expect(useStatusStore.getState().bySession.s?.signals.some(signal => signal.id === "compact")).toBe(false);
    restorePiRunStatus("s", { busy: false, running: false, sdkIdle: true, compacting: false, waiting: false, pendingAsks: [] });
    expect(useStatusStore.getState().bySession.s?.signals).toEqual([]);
    expect(Object.keys(useAskStore.getState().asks)).toEqual(["other"]);
  });
});
