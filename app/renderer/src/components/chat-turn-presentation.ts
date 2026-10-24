import { uiI18n } from "../lib/i18n";
import type { ChatMessage } from "./chat-utils";
import type { StreamEntry } from "./StreamPanel";

export interface TurnPresentation {
  key: string;
  first: number;
  last: number;
  finalEntries: Map<number, StreamEntry[]>;
  durationMs?: number;
}

/** Explicit markers survive reloads. Legacy notifications split only after a terminal reply. */
function startsExecution(message: ChatMessage, previousAi?: ChatMessage): boolean {
  if (message.role !== "user") return false;
  if (!message.customType) return true;
  if (message.customType !== "system_message") return false;
  if (typeof message.details?.startsExecution === "boolean") return message.details.startsExecution;
  const kind = String(message.details?.kind);
  if (["project-created", "direct-create", "flow", "learn"].includes(kind)) return true;
  return ["delegation", "shell"].includes(kind) && !!previousAi && !previousAi.streaming
    && (previousAi.turnOutcome !== undefined || previousAi.stopReason === "stop")
    && !!previousAi.entries?.some(entry => entry.kind === "text" && entry.phase !== "commentary");
}

/** Same boundaries drive folding and the live clock, including system-triggered runs. */
function executionGroups(messages: readonly ChatMessage[]): Array<{ start?: ChatMessage; indices: number[] }> {
  const groups: Array<{ start?: ChatMessage; indices: number[] }> = [];
  let group: { start?: ChatMessage; indices: number[] } = { indices: [] };
  let previousAi: ChatMessage | undefined;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (startsExecution(message, previousAi)) {
      groups.push(group);
      group = { start: message, indices: [] };
      previousAi = undefined;
    } else if (message.role === "ai") {
      // Completed runs may be followed by automatic output without a visible trigger.
      if (previousAi?.turnOutcome !== undefined) {
        groups.push(group);
        group = { indices: [] };
      }
      group.indices.push(index);
      previousAi = message;
    } else if (group.indices.length && message.customType === "system_message"
      && ["summary", "delegation", "shell", "learn", "flow"].includes(String(message.details?.kind))) group.indices.push(index);
  }
  groups.push(group);
  return groups;
}

/** A finished model/tool step alone is not an authoritative conclusion. */
function selectFinalEntries(messages: readonly ChatMessage[], indices: number[], active: boolean): Map<number, StreamEntry[]> {
  const result = new Map<number, StreamEntry[]>();
  const lastAi = [...indices].reverse().find(i => messages[i]!.role === 'ai');
  if (active || lastAi === undefined) return result;
  const last = messages[lastAi]!;
  const terminal = (!last.stopReason || last.stopReason === 'stop') &&
    (last.turnOutcome === 'completed' || (!last.streaming && last.stopReason === 'stop'));
  if (!terminal || (last.turnOutcome && last.turnOutcome !== 'completed')) return result;
  const tagged = indices.some(i => messages[i]!.entries?.some(e => e.kind === 'text' && e.phase === 'final_answer'));
  for (const index of indices) {
    if (messages[index]!.role !== 'ai') continue;
    const selected = (messages[index]!.entries ?? []).filter(e => e.kind === 'text' &&
      (tagged ? e.phase === 'final_answer' : index === lastAi && e.phase !== 'commentary'));
    if (selected.length) result.set(index, selected);
  }
  return result;
}

/** Shared with folding, including plain replies that do not need an execution heading. */
export function buildFinalAnswerEntries(messages: readonly ChatMessage[], busy: boolean): Map<number, StreamEntry[]> {
  const result = new Map<number, StreamEntry[]>();
  const groups = executionGroups(messages);
  groups.forEach((group, index) => {
    for (const [i, entries] of selectFinalEntries(messages, group.indices, busy && index === groups.length - 1)) result.set(i, entries);
  });
  return result;
}

/** Presentation only: original messages, entry IDs and tool associations stay intact. */
export function buildTurnPresentations(messages: readonly ChatMessage[], busy: boolean): Map<number, TurnPresentation> {
  const result = new Map<number, TurnPresentation>();
  const finish = (indices: number[], userStart: ChatMessage | undefined, active: boolean) => {
    if (!indices.length) return;
    // Notifications delivered after the last reply remain independent events.
    const lastAi = [...indices].reverse().find(i => messages[i]!.role === "ai");
    if (lastAi === undefined) return;
    indices = indices.filter(i => i <= lastAi);
    const group = indices.map(i => messages[i]!);
    const last = messages[lastAi]!;
    const terminal = (!last.stopReason || last.stopReason === "stop") && (last.turnOutcome === "completed" || (!last.streaming && last.stopReason === "stop"));
    if (active || (last.turnOutcome && last.turnOutcome !== "completed") || !terminal || group.some(m => m.agentRole || m.forwarded || m.outOfContext || m.imageStripped)) return;
    if (group.some(m => m.entries?.some(e => e.kind === "error"))) return;
    const finalEntries = selectFinalEntries(messages, indices, active);
    if (!finalEntries.size) return;
    const hasProcess = indices.some(i => messages[i]!.customType || (messages[i]!.entries ?? []).some(e => !finalEntries.get(i)?.includes(e)));
    if (!hasProcess) return;
    // Unanswered tools (especially ask_user) must remain visible.
    const entries = group.flatMap(m => m.entries ?? []);
    const completed = new Set(entries.filter(e => e.kind === "tool_result").map(e => e.kind === "tool_result" ? e.toolUseId : ""));
    if (entries.some(e => e.kind === "tool_use" && (!e.id || !completed.has(e.id)))) return;
    const first = indices[0]!;
    const startMessage = userStart ?? messages[first]!;
    const start = startMessage.piTs ?? startMessage.timestamp;
    const end = (last.piTs ?? last.timestamp) + (last.durationMs ?? 0);
    const durationMs = last.durationMs !== undefined && end >= start ? end - start : undefined;
    const turn = { key: messages[first]!.entryId ?? String(messages[first]!.id), first, last: indices.at(-1)!, finalEntries, durationMs };
    for (const i of indices) result.set(i, turn);
  };
  const groups = executionGroups(messages);
  groups.forEach((group, index) => finish(group.indices, group.start, busy && index === groups.length - 1));
  return result;
}

export function executionLabel(durationMs: number | undefined, english: boolean, running = false): string {
  if (durationMs === undefined) return uiI18n.t("ui.ChatPanel.executionProcess", { lng: english ? "en" : "zh-CN" });
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(seconds / 60);
  return uiI18n.t(running ? "ui.ChatPanel.runningTime" : "ui.ChatPanel.elapsedTime", { lng: english ? "en" : "zh-CN", minutes, seconds: seconds % 60 });
}

export function runningTurnPosition(messages: readonly ChatMessage[]): { first: number; startedAt: number } | undefined {
  const group = executionGroups(messages).at(-1)!;
  const first = group.indices.find(index => messages[index]!.role === "ai") ?? -1;
  const start = group.start ?? (first >= 0 ? messages[first] : undefined);
  return start ? { first, startedAt: start.piTs ?? start.timestamp } : undefined;
}
