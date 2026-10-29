import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { uiText, useUiLocale } from "../lib/i18n";
import { useProcessDisclosure } from "./chat-process-disclosure";
import { AssistantContent } from "./AssistantContent";
import { ToolIcon } from "./ChatBlocks";
import { ModelGlyph } from "./ModelGlyph";
import { buildProcessRecords, type ProcessChunk, type ProcessRecord } from "./execution-process-model";
import { toolArguments } from "./tool-activity";
import type { ChatMessage } from "./chat-utils";

const scrollPositions = new Map<string, number>();

/** A segment may span many original messages, but owns one bounded scroll viewport. */
export function ExecutionProcess({ id, chunks, active, interrupted, onInspect, onContextMenu }: {
  id: string;
  chunks: ProcessChunk[];
  active: boolean;
  interrupted?: boolean;
  onInspect?: () => void;
  onContextMenu?: (message: ChatMessage, event: MouseEvent) => void;
}): JSX.Element {
  useUiLocale();
  const open = useProcessDisclosure(state => !!state.expanded[id]);
  const toggle = useProcessDisclosure(state => state.toggle);
  const viewport = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [faded, setFaded] = useState(false);
  const outcome = interrupted ? "cancelled" : chunks.at(-1)?.message.turnOutcome;
  const records = useMemo(() => buildProcessRecords(chunks, active, outcome), [chunks, active, outcome]);
  const summaryIcon = records.find(record => record.action)?.icon;
  const summary = [...new Map(records.filter(record => record.action).map(record => [record.action, record.label])).values()].join("、");
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

  return <section className="execution-process" data-process-id={id}>
    <button type="button" className="execution-process-toggle" aria-expanded={open} onClick={() => { rememberScroll(); onInspect?.(); toggle(id); }}>
      {summaryIcon ? <ToolIcon name={summaryIcon} /> : <ModelGlyph animated={false} />}
      <span className="min-w-0 truncate" title={summary || undefined}>{summary || uiText(records.some(record => record.icon === "thinking") ? "ui.ToolActivity.thinking" : "ui.ToolActivity.notice")}</span>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0" style={{ transform: open ? "rotate(90deg)" : undefined }}><path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.5" /></svg>
    </button>
    <div ref={viewport} className="execution-process-viewport" data-faded={faded} hidden={!open} onScroll={() => { rememberScroll(); updateFade(); }} tabIndex={open ? 0 : -1} role="region" aria-label={uiText("ui.ChatPanel.executionProcess")}>
      <div ref={body}>
        {records.map(record => <ProcessRecordView key={record.key} record={record} updateFade={updateFade} onContextMenu={onContextMenu} />)}
      </div>
    </div>
  </section>;
}

function ProcessRecordView({ record, updateFade, onContextMenu }: {
  record: ProcessRecord;
  updateFade: () => void;
  onContextMenu?: (message: ChatMessage, event: MouseEvent) => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  return <details className="execution-process-record" data-state={record.state} data-depth={record.depth ?? 0}
    onToggle={event => { setExpanded(event.currentTarget.open); updateFade(); }}
    onContextMenu={event => { if (onContextMenu) { event.stopPropagation(); onContextMenu(record.message, event); } }}>
    <summary title={record.fullText}>
      {record.icon === "thinking" ? <ModelGlyph animated={record.state === "running"} /> : <ToolIcon name={record.icon} />}
      <span className="min-w-0 truncate">{record.text}</span>
      {record.state === "running" && <span className="process-record-running" aria-label={uiText("ui.ChatPanel.processing")} />}
    </summary>
    {expanded && <div className="execution-process-detail"><ProcessDetails chunk={{ message: record.message, entries: record.entries }} /></div>}
  </details>;
}

function ProcessDetails({ chunk }: { chunk: ProcessChunk }): JSX.Element {
  const inputs = useMemo(() => {
    const values = new Map<string, Record<string, unknown>>();
    for (const entry of chunk.entries) if (entry.kind === "tool_use" && entry.id && entry.input && typeof entry.input === "object") values.set(entry.id, toolArguments(entry.input));
    return values;
  }, [chunk.entries]);
  if (!chunk.entries.length) return <div className="whitespace-pre-wrap">{chunk.message.text}</div>;
  return <AssistantContent entries={chunk.entries} conclusions={[]} messageId={`process:${chunk.message.id}`} toolInputs={inputs} streaming={false} initiallyExpanded />;
}
