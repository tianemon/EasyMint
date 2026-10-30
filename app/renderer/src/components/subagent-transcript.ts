import { applyNestedToolEvent, mergeConsecutiveText, piBlocksToEntries, toolResultEntry, type ChatMessage } from "./chat-utils";

/** Child events use the same entry conversion and tool identities as the main conversation. */
export function applySubagentEvent(messages: ChatMessage[], event: StreamEvent, nextId: () => number): ChatMessage[] {
  const now = event.timestamp ?? Date.now();
  if (event.type === "nested_tool") return messages.map(message => message.entries
    ? { ...message, entries: applyNestedToolEvent(message.entries, event) } : message);
  if (event.type === "tool_result" && event.toolCallId) return messages.map(message => {
    if (!message.entries?.some(entry => entry.kind === "tool_use" && entry.id === event.toolCallId)) return message;
    const entries = message.entries.filter(entry => entry.kind !== "tool_result" || entry.toolUseId !== event.toolCallId);
    return { ...message, entries: [...entries, toolResultEntry(event)] };
  });
  if (event.type === "custom_event") return [...messages, { id: nextId(), role: "user", text: event.text,
    timestamp: now, piTs: event.timestamp, customType: event.customType, details: event.details }];
  if (event.type === "turn_end") {
    const last = messages.reduce((found, message, index) => message.role === "ai" ? index : found, -1);
    return messages.map((message, index) => index === last ? { ...message, streaming: false, turnOutcome: event.outcome } : message);
  }
  if (event.type === "error") return [...messages, { id: nextId(), role: "ai", timestamp: now, stopReason: "error", turnOutcome: "failed",
    entries: [{ kind: "error", data: event.message ?? "", timestamp: now }] }];
  if (event.type !== "message" && event.type !== "message_start") return messages;
  const entries = mergeConsecutiveText(piBlocksToEntries(event.blocks ?? []));
  // A start frame seals the previous SDK message; the following snapshots replace only their own message.
  const previous = event.type === "message_start" ? messages.map(m => m.streaming ? { ...m, streaming: false } : m) : messages;
  if (!entries.length) return previous;
  const index = event.timestamp === undefined ? previous.reduce((last, m, i) => m.role === "ai" && m.streaming ? i : last, -1)
    : previous.reduce((last, m, i) => m.role === "ai" && (m.piTs ?? m.timestamp) === event.timestamp ? i : last, -1);
  const metadata = { streaming: event.partial !== false, stopReason: event.stopReason, durationMs: event.durationMs,
    provider: event.provider, model: event.model };
  if (index < 0) return [...previous, { id: nextId(), role: "ai", entries, timestamp: now, piTs: event.timestamp, ...metadata }];
  const existing = previous[index]!;
  // Tool results may arrive while a cumulative assistant snapshot is still in flight.
  const results = existing.entries?.filter(e => e.kind === "tool_result" || e.kind === "tool_output") ?? [];
  return previous.map((m, i) => i === index ? { ...existing, ...metadata, entries: [...entries, ...results] } : m);
}

/** Disk is authoritative for persisted entries; only genuinely newer live content survives a reload. */
export function mergeSubagentHistory(disk: ChatMessage[], live: ChatMessage[]): ChatMessage[] {
  const merged = [...disk];
  for (const message of live) {
    const timestamp = message.piTs;
    const index = timestamp === undefined ? -1 : merged.findIndex(m => m.role === message.role && (m.piTs ?? m.timestamp) === timestamp);
    if (index < 0) {
      if (!message.keyId) merged.push(message);
      continue;
    }
    const persisted = merged[index]!;
    const body = (m: ChatMessage) => JSON.stringify((m.entries ?? []).filter(e => e.kind !== "tool_result" && e.kind !== "tool_output"));
    // Preserve the viewer's identity: a disk refresh must not close a disclosure keyed to a live row.
    const selected = body(message).length > body(persisted).length ? message : persisted;
    const results = (message.entries ?? []).filter(e => (e.kind === "tool_result" || e.kind === "tool_output")
      && !(selected.entries ?? []).some(other => (other.kind === "tool_result" || other.kind === "tool_output") && other.toolUseId === e.toolUseId));
    merged[index] = { ...selected, id: message.id, keyId: message.keyId, entryId: persisted.entryId ?? message.entryId,
      entries: [...(selected.entries ?? []), ...results], turnOutcome: selected.turnOutcome ?? message.turnOutcome };
  }
  // Existing viewer IDs remain stable; newly discovered disk rows retain their positive IDs.
  return merged.sort((a, b) => (a.piTs ?? a.timestamp) - (b.piTs ?? b.timestamp));
}

export interface SubagentActivity {
  kind?: "thinking" | "text" | "tool";
  tools: Array<{ id: string; name: string; args?: Record<string, unknown> }>;
}
export function updateSubagentActivity(state: SubagentActivity, event: StreamEvent): SubagentActivity {
  if (event.type === "turn_end" || event.type === "error") return { tools: [] };
  if (event.type === "nested_tool" && event.parentToolCallId && event.toolCallId && event.toolName) {
    const id = `${event.parentToolCallId}/${event.toolCallId}`;
    const previous = state.tools.find(t => t.id === id);
    const tools = state.tools.filter(t => t.id !== id);
    return { kind: "tool", tools: event.nestedPhase === "end" ? tools : [...tools, {id,name:event.toolName,args:event.toolArgs ?? previous?.args}] };
  }
  if (event.type === "tool_progress" && event.toolCallId && event.toolName) {
    const previous = state.tools.find(t => t.id === event.toolCallId);
    return { kind: "tool", tools: [...state.tools.filter(t => t.id !== event.toolCallId),
      { id: event.toolCallId, name: event.toolName, args: event.toolArgs ?? previous?.args }] };
  }
  if (event.type === "tool_done" || event.type === "tool_result") return { kind: "thinking", tools: state.tools.filter(t => t.id !== event.toolCallId && !t.id.startsWith(`${event.toolCallId}/`)) };
  return event.activity ? { ...state, kind: event.activity } : state;
}
