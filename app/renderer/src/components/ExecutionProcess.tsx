import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { uiText, useUiLocale } from "../lib/i18n";
import { useProcessDisclosure } from "./chat-process-disclosure";
import { AssistantContent } from "./AssistantContent";
import { ToolIcon } from "./ChatBlocks";
import { StatusBar } from "./StatusBar";
import { ThinkingIcon } from "./ThinkingIcon";
import { splitTailText, TAIL_FADE_CHARS } from "../lib/tail-fade";
import { buildProcessRecords, type ProcessChunk, type ProcessRecord } from "./execution-process-model";
import { toolArguments } from "./tool-activity";
import type { ChatMessage } from "./chat-utils";

const scrollPositions = new Map<string, number>();

/** A segment may span many original messages, but owns one bounded scroll viewport. */
export function ExecutionProcess({ id, chunks, active, interrupted, onInspect, onContextMenu, liveStatusSessionId }: {
  id: string;
  liveStatusSessionId?: string;
  chunks: ProcessChunk[];
  active: boolean;
  interrupted?: boolean;
  onInspect?: () => void;
  onContextMenu?: (message: ChatMessage, event: MouseEvent) => void;
}): JSX.Element {
  const locale = useUiLocale();
  const open = useProcessDisclosure(state => !!state.expanded[id]);
  const toggle = useProcessDisclosure(state => state.toggle);
  const section = useRef<HTMLElement>(null);
  const revealOnOpen = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [faded, setFaded] = useState(false);
  const openedSingleKey = useRef<string | undefined>(undefined);
  const outcome = interrupted ? "cancelled" : chunks.at(-1)?.message.turnOutcome;
  const records = useMemo(() => buildProcessRecords(chunks, active, outcome), [chunks, active, outcome, locale]);
  const single = records.length === 1 ? records[0] : undefined;
  const summaryIcon = records[0]?.icon ?? "read";
  const summary = [...new Map(records.flatMap(record => record.icon === "thinking"
    ? [["thinking", uiText("ui.ToolActivity.thinking")] as const]
    : record.action ? [[record.action, record.label!] as const] : [])).values()].join("、");
  useLayoutEffect(() => {
    if (open && single) openedSingleKey.current = single.key;
  }, [open, single]);
  const updateFade = useCallback(() => {
    const node = viewport.current;
    if (node && !node.hidden) setFaded(node.scrollHeight - node.scrollTop - node.clientHeight > 1);
  }, []);
  const rememberScroll = useCallback(() => {
    const node = viewport.current;
    if (!node || node.hidden) return;
    scrollPositions.set(id, node.scrollTop);
    if (scrollPositions.size > 300) scrollPositions.delete(scrollPositions.keys().next().value!);
  }, [id]);
  useLayoutEffect(() => {
    const node = viewport.current;
    if (node && open) node.scrollTop = scrollPositions.get(id) ?? node.scrollTop;
    updateFade();
  }, [id, open, updateFade]);
  useLayoutEffect(() => {
    updateFade();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateFade);
    if (viewport.current) observer.observe(viewport.current);
    if (body.current) observer.observe(body.current);
    return () => observer.disconnect();
  }, [updateFade]);
  useLayoutEffect(updateFade, [records, updateFade]);

  useLayoutEffect(() => {
    if (open && revealOnOpen.current) {
      revealOnOpen.current = false;
      section.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [open]);
  const toggleProcess = () => {
    rememberScroll();
    revealOnOpen.current = !!liveStatusSessionId && !open;
    onInspect?.();
    toggle(id);
  };
  const latestRunning = records.slice().reverse().find(record => record.state === "running");
  return <section ref={section} className="execution-process" data-process-id={id}>
    {liveStatusSessionId ? <StatusBar sessionId={liveStatusSessionId} expanded={open} onToggle={toggleProcess} showCompletedOutcome={false}
      fallback={latestRunning?.icon === "thinking" ? {text:uiText("ui.ChatPanel.thinking"),icon:"thinking"}
        : latestRunning ? {text:latestRunning.text,fullText:latestRunning.fullText,icon:latestRunning.icon} : {text:uiText("ui.ChatPanel.processing")}} /> : <button type="button" className="execution-process-toggle" aria-expanded={open} data-state={single?.state} onClick={toggleProcess}>
      {summaryIcon === "thinking" ? <ThinkingIcon className="shrink-0" /> : <ToolIcon name={summaryIcon} />}
      <span className="min-w-0 truncate" title={single?.fullText || summary || undefined}>{summary || single?.text || uiText(records.some(record => record.icon === "thinking") ? "ui.ToolActivity.thinking" : "ui.ToolActivity.notice")}</span>
      {single?.state === "running" && <span className="process-record-running" aria-label={uiText("ui.ChatPanel.processing")} />}
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0" style={{ transform: open ? "rotate(90deg)" : undefined }}><path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.5" /></svg>
    </button>}
    <div ref={viewport} className="execution-process-viewport" data-faded={faded} hidden={!open} onScroll={() => { rememberScroll(); updateFade(); }} tabIndex={open ? 0 : -1} role="region" aria-label={uiText("ui.ChatPanel.executionProcess")}>
      <div ref={body}>
        {single ? <div className="execution-process-detail" data-state={single.state} onContextMenu={event => { if (onContextMenu) { event.stopPropagation(); onContextMenu(single.message, event); } }}>
          {open && <ProcessDetails chunk={{ message: single.message, entries: single.entries }} nested={single.nested} state={single.state} active={single.state === "running"} />}
        </div> : records.map(record => <ProcessRecordView key={record.key} record={record} disclosureId={`${id}:record:${record.key}`} updateFade={updateFade} initiallyExpanded={record.key === openedSingleKey.current} onContextMenu={onContextMenu} />)}
      </div>
    </div>
  </section>;
}

function ProcessRecordView({ record, disclosureId, updateFade, onContextMenu, initiallyExpanded = false }: {
  record: ProcessRecord;
  disclosureId: string;
  initiallyExpanded?: boolean;
  updateFade: () => void;
  onContextMenu?: (message: ChatMessage, event: MouseEvent) => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(() => !!useProcessDisclosure.getState().expanded[disclosureId] || initiallyExpanded);
  useLayoutEffect(() => {
    const disclosure = useProcessDisclosure.getState();
    if (!!disclosure.expanded[disclosureId] !== expanded) disclosure.toggle(disclosureId);
  }, [disclosureId, expanded]);
  return <details open={expanded} className="execution-process-record" data-state={record.state} data-depth={record.depth ?? 0}
    onToggle={event => { setExpanded(event.currentTarget.open); updateFade(); }}
    onContextMenu={event => { if (onContextMenu) { event.stopPropagation(); onContextMenu(record.message, event); } }}>
    <summary title={record.fullText}>
      {record.icon === "thinking" ? <ThinkingIcon className="shrink-0" /> : <ToolIcon name={record.icon} />}
      <span className="min-w-0 truncate">{record.text}</span>
      {record.state === "running" && <span className="process-record-running" aria-label={uiText("ui.ChatPanel.processing")} />}
    </summary>
    {expanded && <div className="execution-process-detail"><ProcessDetails chunk={{ message: record.message, entries: record.entries }} nested={record.nested} state={record.state} active={record.state === "running"} /></div>}
  </details>;
}

function ProcessDetails({ chunk, nested, state, active = false }: { chunk: ProcessChunk; nested?: ProcessRecord["nested"]; state?: ProcessRecord["state"]; active?: boolean }): JSX.Element {
  const inputs = useMemo(() => {
    const values = new Map<string, Record<string, unknown>>();
    for (const entry of chunk.entries) if (entry.kind === "tool_use" && entry.id && entry.input && typeof entry.input === "object") values.set(entry.id, toolArguments(entry.input));
    return values;
  }, [chunk.entries]);
  if (nested) {
    const status = state === "running" ? uiText("ui.ChatBlocks.running") : state === "failed" ? uiText("ui.ChatBlocks.failed")
      : state === "cancelled" ? uiText("pi.cancelled") : state === "unfinished" ? uiText("ui.ChatBlocks.incomplete") : uiText("common.done");
    return <div className="space-y-2" data-nested-tool-details="true" data-state={state}>
      <div className="flex items-center gap-2 text-text-secondary"><span>{status}</span>
        {nested.durationMs !== undefined && <span className="tabular-nums" title={uiText("pi.toolDuration")}>{nested.durationMs} ms</span>}
      </div>
      <pre className="font-mono whitespace-pre-wrap break-all">{nested.arguments === undefined ? uiText("ui.ChatBlocks.argumentsNotRetained") : JSON.stringify(nested.arguments, null, 2)}</pre>
      {nested.error && <pre className="font-mono whitespace-pre-wrap break-all text-danger">{nested.error}</pre>}
    </div>;
  }
  if (chunk.entries.length && chunk.entries.every(entry => entry.kind === "thinking")) {
    const text = chunk.entries.map(entry => entry.kind === "thinking" ? entry.text : "").join("\n");
    const [head, tail] = active ? splitTailText(text, TAIL_FADE_CHARS) : [text, ""];
    return <pre className="text-text-secondary font-mono whitespace-pre-wrap leading-[1.625]" style={{ fontSize: "var(--text-detail)" }}>{head}{tail && <span className="stream-tail-fade">{tail}</span>}</pre>;
  }
  if (!chunk.entries.length) return <div className="whitespace-pre-wrap">{chunk.message.text}</div>;
  return <AssistantContent entries={chunk.entries} conclusions={[]} messageId={`process:${chunk.message.id}`} toolInputs={inputs} streaming={false} initiallyExpanded />;
}
