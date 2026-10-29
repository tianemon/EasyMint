import type { ChatMessage } from "./chat-utils";
import type { StreamEntry } from "./StreamPanel";
import type { TurnPresentation } from "./chat-turn-presentation";
import { toolActivity, toolArguments, type ActivityState } from "./tool-activity";
import { uiText } from "../lib/i18n";

export interface ProcessChunk { message: ChatMessage; entries: StreamEntry[] }
export interface ProcessRecord {
  key: string;
  message: ChatMessage;
  entries: StreamEntry[];
  text: string;
  fullText: string;
  icon: string;
  state: ActivityState;
  action?: string;
  label?: string;
  depth?: number;
}

/** One view at the first row; final conclusions keep their original rows and action targets. */
export function completedProcessChunks(messages: readonly ChatMessage[], turns: ReadonlyMap<number, TurnPresentation>): Map<number, ProcessChunk[]> {
  const result = new Map<number, ProcessChunk[]>();
  for (const turn of new Set(turns.values())) {
    if (turn.active || turn.preserveSegments) continue;
    const chunks: ProcessChunk[] = [];
    for (let i = turn.first; i <= turn.last; i++) {
      if (turns.get(i) !== turn) continue;
      const message = messages[i]!;
      const final = new Set(turn.finalEntries.get(i));
      const entries = (message.entries ?? []).filter(entry => !final.has(entry));
      if (entries.length || message.customType) chunks.push({ message, entries });
    }
    result.set(turn.first, chunks);
  }
  return result;
}

export function buildProcessRecords(chunks: readonly ProcessChunk[], active: boolean, outcome?: ChatMessage["turnOutcome"]): ProcessRecord[] {
  const entries = chunks.flatMap(chunk => chunk.entries);
  const results = new Map(entries.filter(entry => entry.kind === "tool_result").map(entry => [entry.toolUseId, entry]));
  const calls = new Set(entries.filter(entry => entry.kind === "tool_use").map(entry => entry.id));
  const outputs = new Map<string, StreamEntry[]>();
  for (const entry of entries) if (entry.kind === "tool_output" && entry.toolUseId) {
    const list = outputs.get(entry.toolUseId) ?? []; list.push(entry); outputs.set(entry.toolUseId, list);
  }
  const unfinished: ActivityState = active ? "running" : outcome === "cancelled" ? "cancelled" : "unfinished";
  const records: ProcessRecord[] = [];
  for (const chunk of chunks) {
    const add = (key: string, parts: StreamEntry[], text: string, icon: string, state: ActivityState) => records.push({ key, message: chunk.message, entries: parts, text, fullText: text, icon, state });
    if (chunk.message.customType && !chunk.entries.length) add(`${chunk.message.id}:notice`, [], chunk.message.text || uiText("ui.ToolActivity.notice"), "read", "done");
    for (const [index, entry] of chunk.entries.entries()) {
      const key = `${chunk.message.id}:${index}`;
      if (entry.kind === "tool_use") {
        const result = entry.id ? results.get(entry.id) : undefined;
        const state = result ? result.isError ? "failed" : "done" : unfinished;
        const activity = toolActivity(entry.name, entry.input, state);
        records.push({ key, message: chunk.message, entries: [entry, ...(outputs.get(entry.id ?? "") ?? []), ...(result ? [result] : [])], ...activity, state });
        for (const nested of (result?.nestedCalls ?? entry.nestedCalls)?.calls ?? []) {
          const state: ActivityState = nested.status === "ok" ? "done" : nested.status === "error" ? "failed" : result ? "unfinished" : unfinished;
          const activity = toolActivity(nested.name, nested.arguments, state);
          records.push({ key: `${key}:${nested.id}`, message: chunk.message, entries: [{ ...entry, id: nested.id, name: nested.name, input: toolArguments(nested.arguments), nestedCalls: undefined }], ...activity, state, depth: 1 });
        }
      } else if (entry.kind === "tool_result") {
        if (calls.has(entry.toolUseId)) continue;
        const activity = toolActivity(entry.name ?? "tool", {}, entry.isError ? "failed" : "done");
        records.push({ key, message: chunk.message, entries: [entry], ...activity, state: entry.isError ? "failed" : "done" });
      } else if (entry.kind === "thinking") add(key, [entry], uiText("ui.ToolActivity.thinking"), "thinking", active && chunk.message.streaming && chunk.message.entries?.at(-1) === entry ? "running" : "done");
      else if (entry.kind === "text" || entry.kind === "user_message") add(key, [entry], `${uiText("ui.ToolActivity.progress")}: ${entry.text.replace(/\s+/g, " ")}`, "read", "done");
      else if (entry.kind === "error") add(key, [entry], entry.data, "read", "failed");
      else if (entry.kind === "system") add(key, [entry], entry.message, "read", "done");
    }
  }
  return records;
}
