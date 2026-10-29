import { uiI18n } from "../lib/i18n";
import type { ChatMessage } from "./chat-utils";
import type { StreamEntry } from "./StreamPanel";

export interface TurnPresentation {
  key: string;
  first: number;
  last: number;
  finalEntries: Map<number, StreamEntry[]>;
  durationMs?: number;
  active?: boolean;
  interrupted?: boolean;
  /** Interrupted/no-final executions retain their original interleaved presentation. */
  preserveSegments?: boolean;
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
    } else if (group.indices.length && message.customType === "system_message") group.indices.push(index);
  }
  groups.push(group);
  return groups;
}

function groupIsActive(messages: readonly ChatMessage[], indices: readonly number[], busy: boolean): boolean {
  if (!busy) return false;
  const lastAi = [...indices].reverse().find(i => messages[i]!.role === "ai");
  if (lastAi === undefined) return true;
  const last = messages[lastAi]!;
  return last.turnOutcome !== "cancelled" && last.turnOutcome !== "failed" && last.stopReason !== "aborted";
}

function groupIsTerminal(messages: readonly ChatMessage[], indices: readonly number[]): boolean {
  const lastAi = [...indices].reverse().find(i => messages[i]!.role === "ai");
  if (lastAi === undefined) return true;
  const last = messages[lastAi]!;
  return !!last.turnOutcome || ["stop", "error", "aborted"].includes(last.stopReason ?? "");
}

/** User/system-triggered segments stay in one execution through settlement and history reload. */
function presentationGroups(messages: readonly ChatMessage[], busy: boolean): Array<{ start?: ChatMessage; indices: number[]; active: boolean }> {
  const groups: Array<{ start?: ChatMessage; indices: number[] }> = [];
  for (const group of executionGroups(messages)) {
    const previous = groups.at(-1);
    if (previous && !groupIsTerminal(messages, previous.indices)) previous.indices.push(...group.indices);
    else groups.push(group);
  }
  return groups.map((group, index) => ({ ...group,
    active: index === groups.length - 1 && groupIsActive(messages, group.indices, busy),
  }));
}

/** A finished model/tool step alone is not an authoritative conclusion. */
function selectFinalEntries(messages: readonly ChatMessage[], indices: number[], active: boolean): Map<number, StreamEntry[]> {
  const result = new Map<number, StreamEntry[]>();
  const lastAi = [...indices].reverse().find(i => messages[i]!.role === 'ai');
  if (active || lastAi === undefined) return result;
  const last = messages[lastAi]!;
  const interrupted = last.turnOutcome ? last.turnOutcome === 'cancelled' : last.stopReason === 'aborted';
  const terminal = (!last.stopReason || last.stopReason === 'stop') &&
    (last.turnOutcome === 'completed' || (!last.streaming && last.stopReason === 'stop'));
  if (!interrupted && (!terminal || (last.turnOutcome && last.turnOutcome !== 'completed'))) return result;
  const taggedIndex = [...indices].reverse().find(i => messages[i]!.entries?.some(e => e.kind === 'text' && e.phase === 'final_answer'));
  // Only the latest conclusion stays outside the unified completed process.
  const finalIndex = taggedIndex ?? lastAi;
  for (const index of indices) {
    if (messages[index]!.role !== 'ai' || index !== finalIndex) continue;
    const selected = (messages[index]!.entries ?? []).filter(e => e.kind === 'text' &&
      (taggedIndex !== undefined ? e.phase === 'final_answer' : !interrupted && e.phase !== 'commentary'));
    if (selected.length) result.set(index, selected);
  }
  return result;
}

/** Shared with folding, including plain replies that do not need an execution heading. */
export function buildFinalAnswerEntries(messages: readonly ChatMessage[], busy: boolean): Map<number, StreamEntry[]> {
  const result = new Map<number, StreamEntry[]>();
  for (const group of presentationGroups(messages, busy)) {
    for (const [i, entries] of selectFinalEntries(messages, group.indices, group.active)) result.set(i, entries);
  }
  return result;
}

/** Timing is independent of process folding, including plain replies and failed runs. */
export function buildTurnTimings(messages: readonly ChatMessage[], busy: boolean): Map<number, { first: number; startedAt: number; durationMs?: number; active: boolean }> {
  const result = new Map<number, { first: number; startedAt: number; durationMs?: number; active: boolean }>();
  for (const group of presentationGroups(messages, busy)) {
    const indices = group.indices.filter(index => messages[index]!.role === "ai");
    const first = indices[0];
    const lastIndex = indices.at(-1);
    if (first === undefined || lastIndex === undefined) continue;
    const timing = { first, startedAt: messageTime(group.start ?? messages[first]!),
      durationMs: group.active ? undefined : turnDuration(messages, first, lastIndex, group.start), active: group.active };
    for (const index of indices) result.set(index, timing);
  }
  return result;
}

function messageTime(message: ChatMessage): number {
  return message.piTs ?? message.timestamp;
}

function turnDuration(messages: readonly ChatMessage[], first: number, lastIndex: number, startMessage?: ChatMessage): number | undefined {
  const last = messages[lastIndex]!;
  const start = messageTime(startMessage ?? messages[first]!);
  const end = messageTime(last) + (last.durationMs ?? 0);
  const interrupted = last.turnOutcome ? last.turnOutcome === "cancelled" : last.stopReason === "aborted";
  const fallback = interrupted ? Math.max(0, messageTime(last) - start) : undefined;
  return last.turnDurationMs ?? (last.durationMs !== undefined && end >= start ? end - start : fallback);
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
    if (active) {
      const first = indices[0]!;
      const turn = { key: String(messages[first]!.id), first, last: indices.at(-1)!, finalEntries: new Map<number, StreamEntry[]>(), active: true };
      for (const i of indices) result.set(i, turn);
      return;
    }
    const interrupted = last.turnOutcome ? last.turnOutcome === "cancelled" : last.stopReason === "aborted";
    const terminal = (!last.stopReason || last.stopReason === "stop") && (last.turnOutcome === "completed" || (!last.streaming && last.stopReason === "stop"));
    if (!interrupted && ((last.turnOutcome && last.turnOutcome !== "completed") || !terminal)) return;
    if (group.some(m => m.agentRole || m.forwarded || m.outOfContext || m.imageStripped)) return;
    const finalEntries = selectFinalEntries(messages, indices, active);
    const hasProcess = indices.some(i => messages[i]!.customType || (messages[i]!.entries ?? []).some(e => !finalEntries.get(i)?.includes(e)));
    if (!hasProcess) return;
    // Missing tool results stay explicit as unfinished records inside the replay.
    const first = indices[0]!;
    const durationMs = turnDuration(messages, first, lastAi, userStart);
    const turn = { key: String(messages[first]!.id), first, last: indices.at(-1)!, finalEntries, durationMs, interrupted, preserveSegments: finalEntries.size === 0 };
    for (const i of indices) result.set(i, turn);
  };
  for (const group of presentationGroups(messages, busy)) finish(group.indices, group.start, group.active);
  return result;
}

export function executionLabel(durationMs: number | undefined, english: boolean, running = false, interrupted = false): string {
  if (interrupted) {
    if (durationMs === undefined) return uiI18n.t("ui.ChatPanel.interruptedProcess", { lng: english ? "en" : "zh-CN" });
    return uiI18n.t("ui.ChatPanel.interruptedTime", { lng: english ? "en" : "zh-CN", seconds: Math.max(0, Math.floor(durationMs / 1000)) });
  }
  if (durationMs === undefined) return uiI18n.t("ui.ChatPanel.executionProcess", { lng: english ? "en" : "zh-CN" });
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(seconds / 60);
  return uiI18n.t(running ? "ui.ChatPanel.runningTime" : "ui.ChatPanel.elapsedTime", { lng: english ? "en" : "zh-CN", minutes, seconds: seconds % 60 });
}

export function runningTurnPosition(messages: readonly ChatMessage[]): { first: number; startedAt: number } | undefined {
  const group = presentationGroups(messages, true).at(-1)!;
  const first = group.indices.find(index => messages[index]!.role === "ai") ?? -1;
  const start = group.start ?? (first >= 0 ? messages[first] : undefined);
  return start ? { first, startedAt: start.piTs ?? start.timestamp } : undefined;
}
