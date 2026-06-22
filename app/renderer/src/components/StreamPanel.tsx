import { useState, useEffect, useRef, useCallback } from "react";

export interface TextEntry {
  kind: "text";
  text: string;
  timestamp: number;
  source?: string;
}

interface ToolUseEntry {
  kind: "tool_use";
  id?: string;
  name: string;
  input: unknown;
  timestamp: number;
  collapsed: boolean;
  source?: string;
}

interface ToolResultEntry {
  kind: "tool_result";
  toolUseId: string;
  content: string;
  isError: boolean;
  timestamp: number;
  source?: string;
}

interface SystemEntry {
  kind: "system";
  message: string;
  timestamp: number;
  source?: string;
}

interface ErrorEntry {
  kind: "error";
  data: string;
  timestamp: number;
  source?: string;
}

interface ExitEntry {
  kind: "exit";
  code: number;
  timestamp: number;
  source?: string;
}

interface UserMessageEntry {
  kind: "user_message";
  text: string;
  timestamp: number;
  source?: string;
}

interface ThinkingEntry {
  kind: "thinking";
  text: string;
  timestamp: number;
  source?: string;
}

export type StreamEntry =
  | TextEntry
  | ThinkingEntry
  | ToolUseEntry
  | ToolResultEntry
  | SystemEntry
  | ErrorEntry
  | ExitEntry
  | UserMessageEntry;

export function StreamPanel(): JSX.Element {
  const [entries, setEntries] = useState<StreamEntry[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    if (autoScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, []);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  }, []);

  useEffect(() => {
    const unsubStream = window.electronAPI.agent.onStream(
      (event: StreamEvent) => {
        setEntries((prev) => {
          const entry = normalizeEvent(event);
          return entry ? [...prev, entry] : prev;
        });
      }
    );

    const unsubStderr = window.electronAPI.agent.onStderr(
      (data: { runId: string; data: string; timestamp: number }) => {
        setEntries((prev) => [
          ...prev,
          {
            kind: "error",
            data: data.data,
            timestamp: data.timestamp,
          },
        ]);
      }
    );

    const unsubExit = window.electronAPI.agent.onExit(
      (data: { runId: string; code: number }) => {
        setEntries((prev) => [
          ...prev,
          {
            kind: "exit",
            code: data.code,
            timestamp: Date.now(),
          },
        ]);
      }
    );

    return () => {
      unsubStream();
      unsubStderr();
      unsubExit();
    };
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [entries, scrollToBottom]);

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        <div className="text-center">
          <svg className="w-10 h-10 mb-4 opacity-40 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 2a14.5 14.5 0 000 20"/><path d="M2 12h20"/></svg>
          <p>流式输出</p>
          <p className="text-sm mt-1">AI 自动化开发输出将在此实时展示</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="h-full overflow-y-auto p-4 font-mono text-sm"
    >
      <div className="space-y-3">
        {entries.map((entry, i) => (
          <StreamEntryView key={i} entry={entry} />
        ))}
      </div>
    </div>
  );
}

export function normalizeEvent(event: StreamEvent): StreamEntry | null {
  const { type, data, timestamp, source } = event;

  switch (type) {
    case "user_message": {
      // Internal SDK commands (e.g. /model), suppress from chat display
      return null;
    }
    case "assistant": {
      // Separate thinking (delta) from final text
      if (typeof data.delta === "string" && data.delta) {
        return { kind: "thinking", text: data.delta, timestamp, source };
      }
      const text = typeof data.text === "string" ? data.text : "";
      if (!text) return null;
      return { kind: "text", text, timestamp, source };
    }
    case "message_delta": {
      if (typeof data.delta === "string" && data.delta) {
        return { kind: "thinking", text: data.delta, timestamp, source };
      }
      const text = typeof data.text === "string" ? data.text : "";
      return { kind: "text", text, timestamp, source };
    }
    case "tool_use": {
      const id = typeof data.id === "string" ? data.id : undefined;
      const name =
        typeof data.name === "string"
          ? data.name
          : typeof data.tool === "string"
            ? data.tool
            : "unknown";
      const input = data.input ?? data.args ?? null;
      return { kind: "tool_use", id, name, input, timestamp, collapsed: false, source };
    }
    case "tool_result": {
      const toolUseId =
        typeof data.toolUseId === "string"
          ? data.toolUseId
          : typeof data.tool_use_id === "string"
            ? data.tool_use_id
            : "";
      const content =
        typeof data.content === "string"
          ? data.content
          : typeof data.result === "string"
            ? data.result
            : JSON.stringify(data);
      const isError = Boolean(data.isError ?? data.is_error);
      return { kind: "tool_result", toolUseId, content, isError, timestamp, source };
    }
    case "system": {
      // result events come through as system type from agent-service
      // Don't show result text — it duplicates the assistant's final message
      const subtype = typeof data.subtype === "string" ? data.subtype : "";
      if (subtype === "success" || subtype === "error") {
        // Suppress — exit code is irrelevant to the user
        return null;
      }
      const message =
        typeof data.message === "string"
          ? data.message
          : subtype
            ? `System: ${subtype}`
            : JSON.stringify(data);
      return { kind: "system", message, timestamp, source };
    }
    case "error": {
      return { kind: "error", data: JSON.stringify(data), timestamp, source };
    }
    default:
      return { kind: "system", message: JSON.stringify(event), timestamp, source };
  }
}

export function StreamEntryView({ entry }: { entry: StreamEntry }): JSX.Element {
  const sourceBadge = entry.source ? (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${
        entry.source === "evaluator"
          ? "bg-warning-bg text-warning"
          : entry.source === "chat"
            ? "bg-info-bg text-info"
            : "bg-surface-alt text-text-secondary"
      }`}
    >
      {entry.source}
    </span>
  ) : null;

  switch (entry.kind) {
    case "text":
      return (
        <div>
          {sourceBadge}
          <TextBlock text={entry.text} />
        </div>
      );
    case "tool_use":
      return (
        <div>
          {sourceBadge}
          <ToolUseBlock entry={entry} />
        </div>
      );
    case "tool_result":
      return (
        <div>
          {sourceBadge}
          <ToolResultBlock entry={entry} />
        </div>
      );
    case "system": {
      const isEvalFail = entry.source === "evaluator" && entry.message.toUpperCase().includes("FAIL");
      return (
        <div>
          {sourceBadge}
          <div
            className={`text-xs rounded px-2 py-1 ${
              isEvalFail
                ? "text-warning bg-warning-bg border border-warning font-semibold"
                : "text-text-secondary bg-surface-alt"
            }`}
          >
            {entry.message}
          </div>
        </div>
      );
    }
    case "error": {
      const isEvalError = entry.source === "evaluator";
      return (
        <div>
          {sourceBadge}
          <div
            className={`text-xs rounded px-2 py-1 whitespace-pre-wrap ${
              isEvalError
                ? "text-warning bg-warning-bg border border-warning"
                : "text-danger bg-danger-bg"
            }`}
          >
            {entry.data}
          </div>
        </div>
      );
    }
    case "exit": {
      const isEvalFail = entry.source === "evaluator" && entry.code !== 0;
      return (
        <div>
          {sourceBadge}
          <div
            className={`text-xs rounded px-2 py-1 font-semibold ${
              isEvalFail
                ? "text-warning bg-warning-bg border border-warning"
                : entry.code === 0
                  ? "text-success bg-success-bg"
                  : "text-danger bg-danger-bg"
            }`}
          >
            {entry.code === 0
              ? "✓ 进程正常退出 (exit 0)"
              : `✗ 进程异常退出 (exit ${entry.code})`}
          </div>
        </div>
      );
    }
    case "user_message":
      return <UserChatBubble text={entry.text} />;
    case "thinking":
      return <ThinkingBlock text={entry.text} />;
  }
}

function ThinkingBlock({ text }: { text: string }): JSX.Element {
  return (
    <div className="text-xs text-text-secondary italic px-2 py-1 opacity-60">
      {text}
    </div>
  );
}

function ToolUseBlock({ entry }: { entry: ToolUseEntry }): JSX.Element {
  const [collapsed, setCollapsed] = useState(entry.collapsed);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-surface-alt hover:bg-surface-hover transition-colors text-left"
      >
        <span className="text-xs">{collapsed
          ? <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5"><path d="M3.5 2l3 3-3 3"/></svg>
          : <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5"><path d="M2 3.5l3 3 3-3"/></svg>
        }</span>
        <span className="text-xs text-accent font-semibold">{entry.name}</span>
        <span className="text-xs text-text-secondary truncate flex-1">
          {summarizeInput(entry.input)}
        </span>
      </button>
      {!collapsed && (
        <pre className="px-3 py-2 text-xs text-text-secondary bg-surface border-t border-border overflow-x-auto">
          {formatJson(entry.input)}
        </pre>
      )}
    </div>
  );
}

function ToolResultBlock({ entry }: { entry: ToolResultEntry }): JSX.Element {
  return (
    <div
      className={`ml-4 text-xs rounded px-2 py-1 whitespace-pre-wrap border ${
        entry.isError
          ? "border-danger border bg-danger-bg text-danger"
          : "border-border bg-surface text-text-secondary"
      }`}
    >
      {truncate(entry.content, 2000)}
    </div>
  );
}

function TextBlock({ text }: { text: string }): JSX.Element {
  return <div className="text-sm text-text-primary">{renderMarkdown(text)}</div>;
}

// --- inline helpers ---

function summarizeInput(input: unknown): string {
  if (input === null || input === undefined) return "";
  if (typeof input === "string") return truncate(input, 60);
  if (typeof input === "object") {
    const record = input as Record<string, unknown>;
    const keys = Object.keys(record).slice(0, 3);
    return keys
      .map((k) => `${k}=${truncate(String(record[k]), 20)}`)
      .join(", ");
  }
  return truncate(String(input), 60);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "...";
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function UserChatBubble({ text }: { text: string }): JSX.Element {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] bg-accent/20 text-text-primary rounded-2xl rounded-br-md px-4 py-2 text-sm">
        {text}
      </div>
    </div>
  );
}

function renderMarkdown(text: string): JSX.Element[] {
  const elements: JSX.Element[] = [];
  let i = 0;
  let key = 0;

  while (i < text.length) {
    const remainder = text.slice(i);

    // Code block ```
    if (remainder.startsWith("```")) {
      const end = text.indexOf("```", i + 3);
      const code = end !== -1 ? text.slice(i + 3, end) : text.slice(i + 3);
      elements.push(
        <pre
          key={key++}
          className="bg-surface-alt rounded px-2 py-1 my-1 overflow-x-auto text-xs"
        >
          {code || " "}
        </pre>
      );
      i = end !== -1 ? end + 3 : text.length;
      continue;
    }

    // Inline code `...`
    if (remainder.startsWith("`")) {
      const end = text.indexOf("`", i + 1);
      const code = end !== -1 ? text.slice(i + 1, end) : text.slice(i + 1);
      elements.push(
        <code key={key++} className="bg-surface-alt rounded px-1 text-xs">
          {code || " "}
        </code>
      );
      i = end !== -1 ? end + 1 : text.length;
      continue;
    }

    // Bold **...**
    if (remainder.startsWith("**")) {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        elements.push(
          <strong key={key++} className="font-semibold">
            {text.slice(i + 2, end)}
          </strong>
        );
        i = end + 2;
        continue;
      }
    }

    // Italic *...* (single *, not **)
    if (remainder.startsWith("*") && !remainder.startsWith("**")) {
      const end = text.indexOf("*", i + 1);
      if (end !== -1) {
        elements.push(
          <em key={key++}>{text.slice(i + 1, end)}</em>
        );
        i = end + 1;
        continue;
      }
    }

    // Paragraph break (double newline)
    if (remainder.startsWith("\n\n")) {
      elements.push(<div key={key++} className="h-2" />);
      i += 2;
      continue;
    }

    // Single newline
    if (remainder.startsWith("\n")) {
      elements.push(<br key={key++} />);
      i += 1;
      continue;
    }

    // Regular text — collect until next special char
    const specialChars = ["`", "*", "\n"];
    let next = text.length;
    for (const ch of specialChars) {
      const idx = text.indexOf(ch, i);
      if (idx !== -1 && idx < next) {
        next = idx;
      }
    }
    elements.push(
      <span key={key++}>{text.slice(i, next)}</span>
    );
    i = next;
  }

  return elements;
}
