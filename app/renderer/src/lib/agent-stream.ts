/** Form requests consume only their own chat's latest assistant snapshot and final exit. */
export interface PostAgentOptions {
  cwd: string;
  sessionId: string | null;
  permissionMode?: string;
  model?: string;
  systemPayload?: { customType: string; content: string; display: boolean; details: Record<string, unknown> };
  /** Identity comes from this request's IPC result, never a global session broadcast. */
  onStarted?: (identity: { chatId: string; sessionId: string }) => void;
}

export interface PostAgentResult {
  chatId: string;
  sessionId: string;
  replyText: Promise<string>;
}

interface ResponseState {
  text: string;
  error?: string;
  outcome?: "completed" | "cancelled" | "failed";
  exited: boolean;
  exitCode?: number;
}

export function postToAgent(opts: PostAgentOptions, text: string): Promise<PostAgentResult> {
  return new Promise((resolve, reject) => {
    let chatId = "", sessionId = "";
    let settled = false;
    let unsubStream: (() => void) | undefined;
    let unsubExit: (() => void) | undefined;
    // Streaming/exit may precede the sendMessage response. Retain only per-chat
    // summaries until that response identifies our owner; unrelated exits never settle us.
    const responses = new Map<string, ResponseState>();
    const stateFor = (id: string) => {
      let state = responses.get(id);
      if (!state) { state = { text: "", exited: false }; responses.set(id, state); }
      return state;
    };
    const teardown = () => { unsubStream?.(); unsubExit?.(); unsubStream = undefined; unsubExit = undefined; responses.clear(); };
    const finish = () => {
      if (!chatId || settled) return;
      const state = responses.get(chatId);
      if (!state?.exited) return;
      settled = true;
      teardown();
      if (state.outcome === "cancelled") reject(new Error("Request cancelled"));
      else if (state.outcome === "failed" || state.error || (state.exitCode != null && state.exitCode !== 0)) {
        reject(new Error(state.error || "Agent request failed"));
      } else resolve({ chatId, sessionId, replyText: Promise.resolve(state.text.trim()) });
    };
    unsubStream = window.electronAPI.agent.onStream((event: StreamEvent) => {
      if (settled || event.source === "worker") return;
      const id = event.chatId || event.runId;
      if (!id || (chatId && id !== chatId) || (opts.sessionId && event.sessionId && event.sessionId !== opts.sessionId)) return;
      const state = stateFor(id);
      if (event.type === "message" && event.blocks) state.text = event.blocks.filter(block => block.type === "text").map(block => block.text ?? "").join("");
      if (event.type === "error") state.error = event.message || "Agent request failed";
      if (event.type === "turn_end") {
        state.outcome = event.outcome;
        if (event.outcome === "completed") state.error = undefined;
      }
    });
    unsubExit = window.electronAPI.agent.onExit(event => {
      if (settled || !event.runId || (chatId && event.runId !== chatId)) return;
      const state = stateFor(event.runId);
      state.exited = true; state.exitCode = event.code;
      finish();
    });
    window.electronAPI.agent.sendMessage(opts.cwd, text, {
      sessionId: opts.sessionId, permissionMode: opts.permissionMode, model: opts.model, systemPayload: opts.systemPayload,
    }).then(identity => {
      chatId = identity.chatId; sessionId = identity.sessionId;
      const own = responses.get(chatId); responses.clear(); if (own) responses.set(chatId, own);
      opts.onStarted?.(identity);
      finish();
    }).catch(error => {
      teardown();
      if (!settled) { settled = true; reject(error); }
    });
  });
}
