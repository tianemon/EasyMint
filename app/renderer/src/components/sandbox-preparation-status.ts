export interface SandboxPreparationEvent {
  sessionId: string;
  tabId?: string;
  preparationId: string;
  state: "preparing" | "ready" | "failed" | "stopping" | "stopped";
  error?: string;
}
export type ActiveSandboxPreparation = { sessionId: string; preparationId: string; state: "preparing" | "stopping" };

/** Reject other tabs and late completions from an older worker. */
export function acceptSandboxPreparation(
  current: ActiveSandboxPreparation | null,
  event: SandboxPreparationEvent,
  visibleSession: string,
  tabId: string | undefined,
  pendingFirstTurn: boolean,
): { accepted: boolean; current: ActiveSandboxPreparation | null } {
  if (event.sessionId !== visibleSession && !(pendingFirstTurn && tabId && event.tabId === tabId)) return { accepted: false, current };
  if (event.state !== "preparing" && current?.preparationId !== event.preparationId) return { accepted: false, current };
  return { accepted: true, current: event.state === "preparing" || event.state === "stopping"
    ? { sessionId: event.sessionId, preparationId: event.preparationId, state: event.state } : null };
}
