import { useStatusStore } from "../stores/status-store";
import { uiText } from "./i18n";
import { useAskStore } from "../stores/ask-store";
import type { AgentBusyState } from "@shared/agent-status";

/** These events update status only; prompt/exit still own the running flag. */
export function applyPiRunStatus(sessionId: string, event: { type: string; waiting?: boolean; outcome?: "completed" | "cancelled" | "failed" }, stopped = false): void {
  const status = useStatusStore.getState();
  if (event.type === "turn_start" && !stopped) {
    status.popSignal(sessionId, "outcome");
    status.popSignal(sessionId, "error");
    status.popSignal(sessionId, "stopping");
  } else if (event.type === "waiting_user") {
    if (event.waiting && !stopped) status.pushSignal(sessionId, "dialog", uiText("pi.waitingUser"));
    else status.popSignal(sessionId, "dialog");
  } else if (event.type === "turn_end") {
    clearPiRunSignals(sessionId);
    // Older/notification-only events do not prove a successful model run.
    if (event.outcome) status.pushSignal(sessionId, "outcome", uiText(event.outcome === "cancelled" ? "pi.cancelled" : event.outcome === "failed" ? "pi.failed" : "pi.completed"), 4000);
  } else if (event.type === "compaction_finished") {
    status.setCompacting(sessionId, false);
    status.setSummarizing(sessionId, false);
    status.popSignal(sessionId, "compact");
  }
}

export function restorePiRunStatus(sessionId: string, state: AgentBusyState): void {
  const status = useStatusStore.getState();
  clearPiRunSignals(sessionId);
  status.popSignal(sessionId, "compact");
  status.setCompacting(sessionId, state.compacting);
  if (state.busy) status.pushSignal(sessionId, "request", uiText("ui.ChatPanel.processing"));
  if (state.compacting) status.pushSignal(sessionId, "compact", uiText("ui.ChatPanel.compactingSession"));
  applyPiRunStatus(sessionId, { type: "waiting_user", waiting: state.waiting });
  useAskStore.getState().clearForSession(sessionId);
  for (const ask of state.pendingAsks) useAskStore.getState().setAsk(ask);
}

export function clearPiRunSignals(sessionId: string): void {
  const status = useStatusStore.getState();
  for (const id of ["request", "retry", "dialog", "stopping"]) status.popSignal(sessionId, id);
  status.popSignalsByPrefix(sessionId, "tool:");
}
