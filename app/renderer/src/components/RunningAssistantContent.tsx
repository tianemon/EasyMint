import { uiText } from "../lib/i18n";
import { AssistantContent } from "./AssistantContent";
import { useProcessDisclosure } from "./chat-process-disclosure";
import type { RunningProcessSlice } from "./chat-running-process";

export function RunningAssistantContent({ slices, sessionId, messageId, toolInputs, streaming }: {
  slices: RunningProcessSlice[];
  sessionId: string;
  messageId: string;
  toolInputs: Map<string, Record<string, unknown>>;
  streaming: boolean;
}): JSX.Element {
  const expanded = useProcessDisclosure(state => state.expanded);
  const toggle = useProcessDisclosure(state => state.toggle);
  return <>{slices.map((slice, index) => {
    const key = `${sessionId}:${slice.key}`;
    const open = !!expanded[key];
    return <div key={slice.key ?? `text:${index}`}>
      {slice.header && <button type="button" className="execution-process-toggle" style={{ marginLeft: 0, width: "100%" }} aria-expanded={open} onClick={() => toggle(key)}>
        <span>{uiText("ui.ChatPanel.executionProcess")}</span>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ transform: open ? "rotate(90deg)" : undefined }}><path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>}
      {(!slice.key || open) && <AssistantContent entries={slice.entries} conclusions={[]} messageId={`${messageId}:${index}`} toolInputs={toolInputs} streaming={streaming && index === slices.length - 1} />}
    </div>;
  })}</>;
}
