import type { MouseEvent } from "react";
import { AssistantContent } from "./AssistantContent";
import { ExecutionProcess } from "./ExecutionProcess";
import type { ChatMessage } from "./chat-utils";
import type { RunningProcessSlice } from "./chat-running-process";

export function RunningAssistantContent({ slices, sessionId, messageId, toolInputs, streaming, onInspect, onContextMenu, active = true, interrupted = false, omitProcessKey, readOnlyQuestions = false }: {
  slices: RunningProcessSlice[];
  omitProcessKey?: string;
  readOnlyQuestions?: boolean;
  sessionId: string;
  messageId: string;
  toolInputs: Map<string, Record<string, unknown>>;
  streaming: boolean;
  active?: boolean;
  interrupted?: boolean;
  onInspect?: () => void;
  onContextMenu?: (message: ChatMessage, event: MouseEvent) => void;
}): JSX.Element {
  return <div className="assistant-flow">{slices.map((slice, index) => slice.key && slice.key === omitProcessKey ? null : slice.key
    ? <ExecutionProcess key={slice.key} id={`${sessionId}:${slice.key}`} chunks={slice.chunks!} active={active} interrupted={interrupted} onInspect={onInspect} onContextMenu={onContextMenu} />
    : <AssistantContent key={`text:${index}`} entries={slice.entries} conclusions={[]} messageId={`${messageId}:${index}`} toolInputs={toolInputs} streaming={streaming && index === slices.length - 1} readOnlyQuestions={readOnlyQuestions} />
  )}</div>;
}
