import type { ChatMessage } from "./chat-utils";
import type { StreamEntry } from "./StreamPanel";
import type { TurnPresentation } from "./chat-turn-presentation";

export interface RunningProcessSlice {
  entries: StreamEntry[];
  /** Absent for visible prose/questions. Shared across rows in one process segment. */
  key?: string;
  header?: boolean;
}

/** Keep original records/entry references: folding never changes the model's context. */
export function buildRunningProcessSlices(messages: readonly ChatMessage[], turns: ReadonlyMap<number, TurnPresentation>): Map<number, RunningProcessSlice[]> {
  const rows = new Map<number, RunningProcessSlice[]>();
  for (const turn of new Set(turns.values())) {
    if (!turn.active) continue;
    const questionIds = new Set<string>();
    const answeredIds = new Set<string>();
    for (let i = turn.first; i <= turn.last; i++) {
      for (const entry of messages[i]?.entries ?? []) {
        if (entry.kind === "tool_use" && entry.name === "ask_user" && entry.id) questionIds.add(entry.id);
        if (entry.kind === "tool_result") answeredIds.add(entry.toolUseId);
      }
    }
    let processKey: string | undefined;
    for (let i = turn.first; i <= turn.last; i++) {
      const message = messages[i]!;
      if (message.role !== "ai") { processKey = undefined; continue; }
      const slices: RunningProcessSlice[] = [];
      for (const [entryIndex, entry] of (message.entries ?? []).entries()) {
        // Pending questions already have an interactive AskUserCard at the live tail.
        // After answering, the original call/result becomes the in-order question history.
        if (entry.kind === "tool_use" && entry.name === "ask_user" && entry.id && !answeredIds.has(entry.id)) {
          processKey = undefined;
          continue;
        }
        const question = entry.kind === "tool_use" && entry.name === "ask_user"
          || (entry.kind === "tool_result" || entry.kind === "tool_output") && !!entry.toolUseId && questionIds.has(entry.toolUseId);
        const visible = question || entry.kind === "text" || entry.kind === "error" || entry.kind === "user_message";
        const header = !visible && !processKey;
        if (visible) processKey = undefined;
        else processKey ??= `${turn.key}:process:${message.id}:${entryIndex}`;
        const last = slices.at(-1);
        if (last && last.key === processKey) last.entries.push(entry);
        else slices.push({ entries: [entry], key: processKey, header });
      }
      rows.set(i, slices);
    }
  }
  return rows;
}
