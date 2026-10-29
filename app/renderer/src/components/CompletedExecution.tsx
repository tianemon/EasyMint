import type { MouseEvent } from "react";
import { useUiLocale, uiText } from "../lib/i18n";
import { useProcessDisclosure } from "./chat-process-disclosure";
import { IdentityTime } from "./ExecutionTimer";
import { RunningAssistantContent } from "./RunningAssistantContent";
import type { ProcessChunk } from "./execution-process-model";
import type { RunningProcessSlice } from "./chat-running-process";
import { toolArguments } from "./tool-activity";
import type { ChatMessage } from "./chat-utils";

/** A completed turn reveals the same interleaved transcript, with independently folded segments. */
export function CompletedExecution({ id, sessionId, durationMs, chunks, slicesByMessage, interrupted, onInspect, onContextMenu }: {
  id: string;
  sessionId: string;
  durationMs?: number;
  interrupted?: boolean;
  chunks: ProcessChunk[];
  slicesByMessage: ReadonlyMap<number, RunningProcessSlice[]>;
  onInspect?: () => void;
  onContextMenu?: (message: ChatMessage, event: MouseEvent) => void;
}): JSX.Element {
  useUiLocale();
  const open = useProcessDisclosure(state => !!state.expanded[id]);
  const toggle = useProcessDisclosure(state => state.toggle);
  const label = durationMs === undefined ? uiText("ui.ChatPanel.elapsedUnknown") : <IdentityTime durationMs={durationMs} />;
  return <section className="completed-execution">
    <button type="button" className="execution-turn-time" disabled={!chunks.length} aria-expanded={chunks.length ? open : undefined} onClick={() => { onInspect?.(); toggle(id); }}>
      <span>{label}</span>
      {!!chunks.length && <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{transform:open ? "rotate(90deg)" : undefined}}><path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.5" /></svg>}
    </button>
    <div hidden={!open} className="execution-transcript">
      {chunks.filter(chunk => chunk.message.role !== "ai" || slicesByMessage.get(chunk.message.id)?.length).map(chunk => <div key={chunk.message.id} className="execution-transcript-message" onContextMenu={event => { if (onContextMenu) { event.stopPropagation(); onContextMenu(chunk.message, event); } }}>
        {chunk.message.role === "ai" ? <RunningAssistantContent sessionId={sessionId} messageId={String(chunk.message.id)}
          slices={slicesByMessage.get(chunk.message.id) ?? []} toolInputs={toolInputs(chunk.message)} streaming={false} active={false} interrupted={interrupted} onInspect={onInspect} onContextMenu={onContextMenu} />
          : <div className="whitespace-pre-wrap text-text-secondary">{chunk.message.text}</div>}
      </div>)}
    </div>
  </section>;
}

function toolInputs(message: ChatMessage): Map<string, Record<string, unknown>> {
  const inputs = new Map<string, Record<string, unknown>>();
  for (const entry of message.entries ?? []) if (entry.kind === "tool_use" && entry.id) inputs.set(entry.id, toolArguments(entry.input));
  return inputs;
}
