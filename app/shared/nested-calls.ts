import type { NestedToolCalls } from "@earendil-works/pi-ai";
export type { NestedToolCalls } from "@earendil-works/pi-ai";

export interface NestedToolEvent {
  parentToolCallId?: string;
  toolCallId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  nestedPhase?: "start" | "update" | "end";
  isError?: boolean;
  content?: string;
}

/** Provisional live record. Pi's persisted outer result supplies duration and completeness. */
export function updateNestedCalls(current: NestedToolCalls | undefined, event: NestedToolEvent): NestedToolCalls {
  const calls = (current?.calls ?? []).map(call => ({ ...call }));
  const id = event.toolCallId ?? "unknown";
  let call = calls.find(call => call.id === id);
  if (!call && calls.length < 256) {
    const json = JSON.stringify(event.toolArgs ?? {});
    const bytes = new TextEncoder().encode(json).length;
    const totalBytes = calls.reduce((total, item) => total + new TextEncoder().encode(JSON.stringify(item.arguments ?? {})).length, 0);
    call = { id, name: event.toolName ?? "工具", status: "unfinished",
      ...(bytes <= 8192 && totalBytes + bytes <= 32768 ? { arguments: JSON.parse(json) } : { argumentsBytes: bytes }) };
    calls.push(call);
  }
  if (call && event.nestedPhase === "end") {
    call.status = event.isError ? "error" : "ok";
    if (event.isError) call.error = event.content?.slice(0, 500);
  }
  return { calls, complete: false };
}
