import { useMemo, type MouseEvent, type ReactNode } from "react";
import { useUiLocale, uiText } from "../lib/i18n";
import { useProcessDisclosure } from "./chat-process-disclosure";
import { IdentityTime } from "./ExecutionTimer";
import { RunningAssistantContent } from "./RunningAssistantContent";
import { completedProcessChunks } from "./execution-process-model";
import { buildRunningProcessSlices } from "./chat-running-process";
import type { TurnPresentation } from "./chat-turn-presentation";
import { toolArguments } from "./tool-activity";
import type { ChatMessage } from "./chat-utils";

interface CompletedExecutionProps {
  id: string;
  sessionId: string;
  durationMs?: number;
  interrupted?: boolean;
  messages: readonly ChatMessage[];
  turn?: TurnPresentation;
  renderSystemMessage: (message: ChatMessage) => ReactNode;
  onInspect?: () => void;
  onContextMenu?: (message: ChatMessage, event: MouseEvent) => void;
}

/** Closed history owns only a heading; no replay is constructed or mounted. */
export function CompletedExecution(props: CompletedExecutionProps): JSX.Element {
  useUiLocale();
  const { id, durationMs, turn, onInspect } = props;
  const open = useProcessDisclosure(state => !!state.expanded[id]);
  const toggle = useProcessDisclosure(state => state.toggle);
  const label = durationMs === undefined ? uiText("ui.ChatPanel.elapsedUnknown") : <IdentityTime durationMs={durationMs} />;
  return <section className="completed-execution">
    <button type="button" className="execution-turn-time" disabled={!turn} aria-expanded={turn ? open : undefined} onClick={() => { onInspect?.(); toggle(id); }}>
      <span>{label}</span>
      {turn && <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{transform:open ? "rotate(90deg)" : undefined}}><path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.5" /></svg>}
    </button>
    {open && turn && <ExecutionTranscript {...props} turn={turn} />}
  </section>;
}

function ExecutionTranscript({ messages, turn, sessionId, interrupted, renderSystemMessage, onInspect, onContextMenu }: CompletedExecutionProps & { turn: TurnPresentation }): JSX.Element {
  const { chunks, rows } = useMemo(() => {
    // Preserve exact turn membership: ordinary prompts and separate triggers stay outside.
    const turns = new Map(turn.indices.map(index => [index, turn]));
    const chunks = completedProcessChunks(messages, turns).get(turn.first) ?? [];
    const rows = new Map(Array.from(buildRunningProcessSlices(messages, turns, true), ([index, slices]) => [messages[index]!.id, slices]));
    return { chunks, rows };
  }, [messages, turn]);
  return <div className="execution-transcript">
    {chunks.filter(chunk => chunk.message.role !== "ai" || rows.get(chunk.message.id)?.length).map(chunk => <div key={chunk.message.id} className="execution-transcript-message" onContextMenu={event => { if (onContextMenu) { event.stopPropagation(); onContextMenu(chunk.message, event); } }}>
      {chunk.message.role === "ai" ? <RunningAssistantContent sessionId={sessionId} messageId={String(chunk.message.id)}
        slices={rows.get(chunk.message.id) ?? []} toolInputs={toolInputs(chunk.message)} streaming={false} active={false} interrupted={interrupted} onInspect={onInspect} onContextMenu={onContextMenu} />
        : renderSystemMessage(chunk.message)}
    </div>)}
  </div>;
}

function toolInputs(message: ChatMessage): Map<string, Record<string, unknown>> {
  const inputs = new Map<string, Record<string, unknown>>();
  for (const entry of message.entries ?? []) if (entry.kind === "tool_use" && entry.id) inputs.set(entry.id, toolArguments(entry.input));
  return inputs;
}
