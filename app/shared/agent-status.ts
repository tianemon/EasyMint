import type { RemotePendingAsk } from "./remote-protocol";

/** Authoritative host snapshot for restoring the current run's UI after a remount. */
export interface AgentBusyState {
  busy: boolean;
  running: boolean;
  sdkIdle: boolean;
  chatId?: string;
  compacting: boolean;
  waiting: boolean;
  pendingAsks: RemotePendingAsk[];
}
