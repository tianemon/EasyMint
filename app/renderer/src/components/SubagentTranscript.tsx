import { useMemo } from "react";
import { uiText, useUiLocale } from "../lib/i18n";
import { AssistantContent } from "./AssistantContent";
import { CompletedExecution } from "./CompletedExecution";
import { ExecutionProcess } from "./ExecutionProcess";
import { ExecutionTimer } from "./ExecutionTimer";
import { RunningAssistantContent } from "./RunningAssistantContent";
import { StatusBar } from "./StatusBar";
import { UserMessageText } from "./UserMessageText";
import { buildFinalAnswerEntries, buildTurnPresentations, buildTurnTimings, executionLabel, type TurnPresentation } from "./chat-turn-presentation";
import { buildRunningProcessSlices, liveProcessSlice } from "./chat-running-process";
import { buildProcessRecords } from "./execution-process-model";
import { toolActivity, toolArguments } from "./tool-activity";
import type { ChatMessage } from "./chat-utils";
import type { SubagentActivity } from "./subagent-transcript";

/** A stopped child without an authoritative final answer retains its interleaved transcript. */
function childTurns(messages: ChatMessage[], running: boolean): Map<number, TurnPresentation> {
  const turns = buildTurnPresentations(messages, running);
  const lastIndex = messages.reduce((last, m, i) => m.role === "ai" ? i : last, -1);
  if (!running && lastIndex >= 0 && !turns.has(lastIndex)) {
    const last = messages[lastIndex]!;
    // Use the shared execution boundaries, but do not promote an unknown/failed tool step to a final answer.
    if (last.stopReason !== "stop" || last.turnOutcome === "failed") {
      const pending = messages.map((m, i) => i === lastIndex ? { ...m, stopReason: undefined, turnOutcome: undefined } : m);
      const unfinished = buildTurnPresentations(pending, true).get(lastIndex);
      if (unfinished) {
        const preserved = { ...unfinished, active: false, preserveSegments: true,
          interrupted: last.turnOutcome === "cancelled" || last.stopReason === "aborted" };
        for (const index of unfinished.indices) turns.set(index, preserved);
      }
    }
  }
  return turns;
}

function systemMessage(message: ChatMessage): JSX.Element {
  return <details className="execution-system-message"><summary>{uiText("ui.ToolActivity.notice")}</summary>
    <UserMessageText text={message.text ?? ""} /></details>;
}

export function SubagentTranscript({ messages, running, sessionId, title, activity }: {
  messages: ChatMessage[]; running: boolean; sessionId: string; title: string; activity: SubagentActivity;
}): JSX.Element {
  const locale = useUiLocale();
  const turns = useMemo(() => childTurns(messages, running), [messages, running]);
  const final = useMemo(() => buildFinalAnswerEntries(messages, running), [messages, running]);
  const timings = useMemo(() => buildTurnTimings(messages, running), [messages, running]);
  const rows = useMemo(() => buildRunningProcessSlices(messages, turns, false, true), [messages, turns]);
  const currentTool = activity.tools.at(-1);
  const live = liveProcessSlice(rows, currentTool?.id);
  const fallback = live && buildProcessRecords(live.chunks ?? [], true).filter(record => record.state === "running").at(-1);
  const current = currentTool ? toolActivity(currentTool.name, currentTool.args)
    : activity.kind === "thinking" ? { text: uiText("ui.ChatPanel.thinking"), icon: "thinking" }
      : activity.kind === "text" ? { text: uiText("ui.ChatPanel.processing") }
        : fallback ? { text: fallback.text, fullText: fallback.fullText, icon: fallback.icon } : { text: uiText("ui.ChatPanel.processing") };
  const status = { ...current, busy: running };
  return <>
    {messages.map((message, index) => {
      const turn = turns.get(index);
      if (message.role === "user") {
        if (turn && !turn.active && !turn.preserveSegments) return null;
        return <div key={message.keyId ?? message.id} className={message.customType ? "subagent-ai-content" : "flex justify-end"}>
          {message.customType ? systemMessage(message) : <div className="msg-bubble-user rounded-[var(--radius-lg)] px-[14px] py-1.5 leading-[1.55] max-w-[80%]"><UserMessageText text={message.text ?? ""} /></div>}
        </div>;
      }
      const timing = timings.get(index);
      const header = (turn?.first ?? timing?.first) === index;
      const grouped = !!(turn?.active || turn?.preserveSegments);
      const entries = turn && !grouped ? turn.finalEntries.get(index) ?? [] : message.entries ?? [];
      if (!header && (grouped ? !(rows.get(index) ?? []).some(slice => !slice.key || slice.key !== live?.key) : !entries.length)) return null;
      const inputs = new Map((message.entries ?? []).flatMap(e => e.kind === "tool_use" && e.id ? [[e.id, toolArguments(e.input)] as const] : []));
      return <div key={message.keyId ?? message.id} data-subagent-message={message.id} className="subagent-flow-row">
        {header && <div className="flex gap-3 items-center"><div className="msg-avatar agent shrink-0">M</div><span className="font-medium">{title}</span></div>}
        <div className="subagent-ai-content">
          {header && timing?.active && <div className="execution-time-heading"><ExecutionTimer startedAt={timing.startedAt} /></div>}
          {header && turn?.preserveSegments && !turn.active && <div className="execution-time-heading">{(turn.durationMs ?? timing?.durationMs) === undefined ? uiText("ui.ChatPanel.elapsedUnknown") : executionLabel(turn.durationMs ?? timing?.durationMs, locale.startsWith("en"), true)}</div>}
          {header && !running && !grouped && <CompletedExecution id={`${sessionId}:${turn?.key ?? `plain:${message.id}`}`} sessionId={sessionId}
            durationMs={turn?.durationMs ?? timing?.durationMs} messages={messages} turn={turn} renderSystemMessage={systemMessage} readOnlyQuestions />}
          {grouped ? <RunningAssistantContent slices={rows.get(index) ?? []} omitProcessKey={live?.key} sessionId={sessionId}
            messageId={String(message.id)} toolInputs={inputs} streaming={running && !!message.streaming} active={!!turn?.active} interrupted={turn?.interrupted} readOnlyQuestions />
            : entries.length > 0 && <AssistantContent entries={entries} conclusions={final.get(index) ?? []} messageId={String(message.id)} toolInputs={inputs} streaming={false} />}
        </div>
      </div>;
    })}
    {running && <div className="subagent-ai-content">
      {live ? <ExecutionProcess id={`${sessionId}:${live.key}`} chunks={live.chunks!} active liveStatus={status} />
        : <StatusBar sessionId={sessionId} presentation={status} showCompletedOutcome={false} />}
    </div>}
  </>;
}
