import type { ProcessChunk } from "./execution-process-model";
import type { ChatMessage } from "./chat-utils";
import type { StreamEntry } from "./StreamPanel";
import type { TurnPresentation } from "./chat-turn-presentation";

export interface RunningProcessSlice {
  entries: StreamEntry[];
  /** Absent for visible prose/questions. Shared across rows in one process segment. */
  key?: string;
  header?: boolean;
  /** Only the currently trailing process is represented by the live status control. */
  live?: boolean;
  active?: boolean;
  chunks?: ProcessChunk[];
}

/** Keep original records/entry references: folding never changes the model's context. */
export function buildRunningProcessSlices(messages: readonly ChatMessage[], turns: ReadonlyMap<number, TurnPresentation>, includeCompleted = false, includePendingQuestions = false): Map<number, RunningProcessSlice[]> {
  const rows = new Map<number, RunningProcessSlice[]>();
  for (const turn of new Set(turns.values())) {
    if (!turn.active && !turn.preserveSegments && !includeCompleted) continue;
    const questionIds = new Set<string>();
    const answeredIds = new Set<string>();
    for (let i = turn.first; i <= turn.last; i++) {
      for (const entry of messages[i]?.entries ?? []) {
        if (entry.kind === "tool_use" && entry.name === "ask_user" && entry.id) questionIds.add(entry.id);
        if (entry.kind === "tool_result") answeredIds.add(entry.toolUseId);
      }
    }
    const callSlices = new Map<string, RunningProcessSlice>();
    const append = (slice: RunningProcessSlice, message: ChatMessage, entry: StreamEntry) => {
      slice.entries.push(entry);
      const chunk = slice.chunks!.at(-1);
      if (chunk?.message === message) chunk.entries.push(entry);
      else slice.chunks!.push({ message, entries: [entry] });
    };
    let processKey: string | undefined;
    let processSlice: RunningProcessSlice | undefined;
    for (let i = turn.first; i <= turn.last; i++) {
      const message = messages[i]!;
      if (message.role !== "ai") { processKey = undefined; processSlice = undefined; continue; }
      const slices: RunningProcessSlice[] = [];
      const finalEntries = !turn.active && !turn.preserveSegments ? new Set(turn.finalEntries.get(i)) : undefined;
      for (const [entryIndex, entry] of (message.entries ?? []).entries()) {
        if (finalEntries?.has(entry)) continue;
        // Pending questions already have an interactive AskUserCard at the live tail.
        // After answering, the original call/result becomes the in-order question history.
        if (!includePendingQuestions && entry.kind === "tool_use" && entry.name === "ask_user" && entry.id && !answeredIds.has(entry.id) && turn.active) {
          processKey = undefined;
          processSlice = undefined;
          continue;
        }
        if ((entry.kind === "tool_result" || entry.kind === "tool_output") && entry.toolUseId) {
          const owner = callSlices.get(entry.toolUseId);
          if (owner) { append(owner, message, entry); continue; }
        }
        const question = entry.kind === "tool_use" && entry.name === "ask_user"
          || (entry.kind === "tool_result" || entry.kind === "tool_output") && !!entry.toolUseId && questionIds.has(entry.toolUseId);
        const visible = question || entry.kind === "text" || entry.kind === "error" || entry.kind === "user_message";
        const header = !visible && !processKey;
        if (visible) {
          processKey = undefined;
          processSlice = undefined;
          const last = slices.at(-1);
          if (last && !last.key) last.entries.push(entry);
          else slices.push({ entries: [entry] });
        } else {
          processKey ??= `${turn.key}:process:${message.id}:${entryIndex}`;
          if (header) {
            processSlice = { entries: [], key: processKey, header: true, active: !!turn.active, chunks: [] };
            slices.push(processSlice);
          }
          // Continuations share the first slice's viewport rather than rendering another row.
          append(processSlice!, message, entry);
          if (entry.kind === "tool_use" && entry.id) callSlices.set(entry.id, processSlice!);
        }
      }
      rows.set(i, slices);
    }
    if (turn.active && processSlice) processSlice.live = true;
  }
  return rows;
}

export function liveProcessSlice(rows: ReadonlyMap<number, RunningProcessSlice[]>, activeToolId?: string): RunningProcessSlice | undefined {
  let trailing: RunningProcessSlice | undefined;
  for (const slices of rows.values()) for (const slice of slices) {
    if (slice.live) trailing = slice;
    // Real call identity also covers a tool still running while commentary has already arrived.
    if (activeToolId && slice.active && slice.entries.some(entry => entry.kind === "tool_use" && entry.id
      && (activeToolId === entry.id || activeToolId.startsWith(`${entry.id}/`)))) return slice;
  }
  return trailing;
}
