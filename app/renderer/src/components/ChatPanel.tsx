import { useState, useEffect, useRef, useCallback } from "react";
import { normalizeEvent } from "./StreamPanel";
import type { StreamEntry } from "./StreamPanel";
import { TASK_ALLOCATION_INSTRUCTION } from "../../../shared/prompts";
import { buildBlocks, ChatBlockView } from "./ChatBlocks";
import { chatActions } from "../stores/chat-actions";
import { useProjectStatusStore } from "../stores/project-status-store";
import { useSettingsStore } from "../stores/settings-store";


interface ChatMessage {
  id: number;
  role: "user" | "ai";
  text?: string;
  entries?: StreamEntry[];
  timestamp: number;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

/** Map raw SDK session messages to ChatMessage[], extracting user text + assistant entries. */
function mapSessionMessages(msgs: Array<{ type: string; message: unknown }>): ChatMessage[] {
  let nextId = 0;
  const mapped: ChatMessage[] = [];
  for (const m of msgs) {
    if (m.type === "user") {
      const content = (m.message as { content?: string | unknown[] })?.content;
      const text = typeof content === "string" ? content : Array.isArray(content)
        ? content.map((b: unknown) => (b as { text?: string })?.text ?? "").join("")
        : "";
      if (text && !text.includes("Request interrupted") && !text.includes("No response requested")) {
        mapped.push({ id: ++nextId, role: "user", text, timestamp: Date.now() });
      }
    } else if (m.type === "assistant") {
      const content = (m.message as { content?: unknown[] })?.content;
      if (Array.isArray(content)) {
        const entries: StreamEntry[] = [];
        for (const block of content) {
          const b = block as { type?: string; text?: string; thinking?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean };
          if (b.type === "text" && b.text) {
            if (!b.text.includes("Request interrupted") && !b.text.includes("No response requested")) {
              entries.push({ kind: "text", text: b.text, timestamp: Date.now() });
            }
          } else if (b.type === "thinking" && b.thinking) {
            entries.push({ kind: "thinking", text: b.thinking, timestamp: Date.now() });
          } else if (b.type === "tool_use") {
            entries.push({ kind: "tool_use", id: (b as { id?: string }).id || "", name: b.name || "?", input: b.input || {}, timestamp: Date.now(), collapsed: false, source: "chat" });
          } else if (b.type === "tool_result") {
            entries.push({ kind: "tool_result", toolUseId: b.tool_use_id || "", content: String(b.content ?? ""), isError: !!b.is_error, timestamp: Date.now(), source: "chat" });
          }
        }
        if (entries.length > 0) {
          mapped.push({ id: ++nextId, role: "ai", entries, timestamp: Date.now() });
        }
      }
    }
  }
  return mapped;
}

interface ChatPanelProps {
  projectPath: string;
  /** SDK session ID to resume, undefined = new session */
  sessionId?: string;
  /** Called when SDK returns the real session_id (first message of a new session) */
  onSessionCreated?: (sessionId: string) => void;
  /** Called whenever a response completes — triggers sidebar re-sort */
  onActivity?: () => void;
}

export function ChatPanel({ projectPath, sessionId: existingSid, onSessionCreated, onActivity }: ChatPanelProps): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [statusText, setStatusText] = useState("思考中...");
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const currentRunRef = useRef<string | null>(null);
  const stoppedRef = useRef(false);
  const [permissionMode, setPermissionMode] = useState("auto");
  const storeModel = useSettingsStore((s) => s.model);
  const setStoreModel = useSettingsStore((s) => s.setModel);
  const availableModels = useSettingsStore((s) => s.availableModels);
  const [chatModel, setChatModel] = useState("");
  const [balanceText, setBalanceText] = useState("");

  const refreshBalance = useCallback(async () => {
    try {
      const data = await window.electronAPI.settings.fetchBalance();
      if (data?.balance_infos?.length) {
        const b = data.balance_infos[0]!;
        setBalanceText(`${b.total_balance} ${b.currency}`);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refreshBalance();
    const timer = setInterval(refreshBalance, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [refreshBalance]);

  const handleModelChange = useCallback(async (m: string) => {
    setChatModel(m);
    setStoreModel(m);
    const sid = sidRef.current;
    if (sid) {
      try { await window.electronAPI.agent.setModel(sid, m); } catch { /* no active query yet */ }
    }
  }, [setStoreModel]);
  const allocPhase = useProjectStatusStore((s) => s.allocPhase);
  const msgIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // SDK session_id — starts as the incoming prop (null for new sessions)
  const sidRef = useRef<string | null>(existingSid ?? null);

  useEffect(() => {
    if (existingSid) sidRef.current = existingSid;
  }, [existingSid]);

  const scrollToBottom = useCallback((force = false) => {
    if (!containerRef.current) return;
    if (force || autoScrollRef.current) {
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      });
    }
  }, []);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  // Replay buffered stream events (missed during window-creation gap) + load history
  useEffect(() => {
    if (!existingSid) return;
    let cancelled = false;
    const projectDir = projectPath || "~/EasyMintProject/workspace/";

    (async () => {
      // 1. Replay any stream events buffered in main process memory
      try {
        const buffered = await window.electronAPI.agent.getBufferedStream(existingSid);
        if (!cancelled && buffered.length > 0) {
          let currentAiId = 0;
          for (const raw of buffered) {
            const entry = normalizeEvent(raw as StreamEvent);
            if (!entry) continue;
            if (!currentAiId) {
              currentAiId = ++msgIdRef.current;
              setMessages((prev) => [...prev, { id: currentAiId, role: "ai", entries: [entry], timestamp: Date.now() }]);
            } else {
              setMessages((prev) => prev.map((m) => m.id === currentAiId ? { ...m, entries: [...(m.entries || []), entry] } : m));
            }
          }
        }
      } catch { /* ignore */ }

      // 2. Load past turns from SDK file storage (retry once if empty)
      if (cancelled) return;
      const snapshot = msgIdRef.current;
      try {
        let msgs = await window.electronAPI.conv.messages(existingSid, projectDir);
        if (!cancelled && msgs.length === 0) {
          await new Promise((r) => setTimeout(r, 500));
          if (cancelled) return;
          msgs = await window.electronAPI.conv.messages(existingSid, projectDir);
        }
        if (!cancelled && msgs.length > 0 && msgIdRef.current <= snapshot) {
          const mapped = mapSessionMessages(msgs);
          if (mapped.length > 0) setMessages(mapped);
        }
      } catch { /* ignore */ }
    })();

    return () => { cancelled = true; };
  }, [existingSid, projectPath]);

  // Stream listener — live events after mount
  useEffect(() => {
    let currentAiId = 0;
    const unsub = window.electronAPI.agent.onStream((event: StreamEvent) => {
      // Buffer replay already handled missed events; only process new ones.
      if (event.source !== "chat") return;
      if (currentRunRef.current && event.runId !== currentRunRef.current) return;
      if (stoppedRef.current) return;
      // Track runId from stream events (may be set by sendMessage, but also
      // needed when another window initiated the turn, e.g. after project creation)
      if (!currentRunRef.current) {
        currentRunRef.current = event.runId;
        setCurrentRunId(event.runId);
      }
      setLoading(true);
      setStreaming(true);
      if (event.type === "status") {
        setStatusText(typeof event.data.text === "string" ? event.data.text : "处理中...");
        return;
      }
      const entry = normalizeEvent(event);
      if (!entry) return;
      if (!currentAiId) {
        currentAiId = ++msgIdRef.current;
        setMessages((prev) => [...prev, { id: currentAiId, role: "ai", entries: [entry], timestamp: entry.timestamp }]);
      } else {
        setMessages((prev) => prev.map((m) => m.id === currentAiId ? { ...m, entries: [...(m.entries || []), entry], timestamp: entry.timestamp } : m));
      }
      // Don't force-scroll — let user read history while assistant streams
      scrollToBottom();
    });
    const unsubExit= window.electronAPI.agent.onExit(({ runId }) => { if (currentRunRef.current && runId !== currentRunRef.current) return; currentAiId = 0; setLoading(false); setStreaming(false); onActivity?.(); });
    // SDK returns session_id in first stream message — capture it
    const unsubSession = window.electronAPI.agent.onChatSession(({ sessionId: realSid }) => {
      if (!sidRef.current) {
        sidRef.current = realSid;
        onSessionCreated?.(realSid);
      }
    });
    return () => { unsub(); unsubExit(); unsubSession(); };
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const sendText = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const ts = Date.now();

    setMessages((prev) => [...prev, { id: ++msgIdRef.current, role: "user", text: trimmed, timestamp: ts }]);
    setInput("");
    setLoading(true);
    setStatusText("思考中...");
    stoppedRef.current = false;
    autoScrollRef.current = true;
    scrollToBottom(true);

    try {
      setStreaming(true);
      currentRunRef.current = null; // clear stale ref before new message
      const result = await window.electronAPI.agent.sendMessage(projectPath, trimmed, {
        sessionId: sidRef.current,
        permissionMode,
      });
      setCurrentRunId(result.chatId);
      currentRunRef.current = result.chatId;
    } catch {
      setLoading(false);
      currentRunRef.current = null;
    }
  }, [projectPath, loading, permissionMode]);

  // Register sendText for cross-component chat triggers
  useEffect(() => {
    chatActions.register((text: string) => sendText(text));
    return () => chatActions.unregister();
  }, [sendText]);

  const handleSend = useCallback(async () => {
    await sendText(input);
  }, [input, sendText]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const hasMessages = messages.length > 0;

  return (
    <div className="absolute inset-0 flex flex-col">
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
        {!hasMessages ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-text-secondary">开始对话，让 Mint 帮你开发项目。</p>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {messages.map((msg, idx) => {
              const isLast = idx === messages.length - 1;
              const aiText = msg.role === "ai" && msg.entries
                ? msg.entries.filter((e) => e.kind === "text").map((e) => e.text ?? "").join("")
                : "";
              const hasInitPrompt = isLast && aiText.includes("帮我初始化开发环境");
              const hasTaskPrompt = isLast && aiText.includes("开始分配开发任务") && allocPhase === "pending";
              const handleAllocateTasks = async () => {
                try {
                  await sendText(TASK_ALLOCATION_INSTRUCTION);
                } catch { /* ignore */ }
              };
              return (
                <div key={msg.id} className="msg-in">
                  {msg.role === "user" && msg.text ? (
                    <div className="flex justify-end">
                      <div className="flex flex-col items-end max-w-[82%]">
                        <div className="bg-accent text-text-inverse rounded-[10px] rounded-br-[4px] px-[14px] py-[10px] text-[13px] leading-[1.55] whitespace-pre-wrap">
                          {msg.text}
                        </div>
                        <span className="text-[10px] text-text-secondary mt-0.5 px-1">{formatTime(msg.timestamp)}</span>
                      </div>
                    </div>
                  ) : msg.entries ? (
                    <div className="flex flex-col max-w-[85%]">
                      <div className="bg-surface border border-border rounded-[10px] rounded-bl-[4px] px-[14px] py-2">
                        {buildBlocks(msg.entries).map((block, i) => <ChatBlockView key={i} block={block} streaming={streaming} />)}
                      </div>
                      {hasInitPrompt && !loading && (
                        <button
                          className="mt-2 self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-xs hover:bg-accent/20 transition-colors"
                          onClick={() => sendText("帮我初始化开发环境")}
                        >
                          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                            <path d="M1 7h10M9 3l4 4-4 4" />
                          </svg>
                          帮我初始化开发环境
                        </button>
                      )}
                      {hasTaskPrompt && !loading && (
                        <button
                          className="mt-2 self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-xs hover:bg-accent/20 transition-colors"
                          onClick={handleAllocateTasks}
                        >
                          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                            <path d="M1 7h10M9 3l4 4-4 4" />
                          </svg>
                          开始分配开发任务
                        </button>
                      )}
                      <span className="text-[10px] text-text-secondary mt-0.5 px-1">{formatTime(msg.timestamp)}</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {/* Streaming indicator — fixed position above input */}
      {(streaming || loading) && (
        <div className="flex items-center gap-2 px-4 py-1.5 text-text-secondary text-xs bg-surface-alt/50 border-t border-border/50 shrink-0">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" style={{ animationDelay: "0.2s" }} />
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" style={{ animationDelay: "0.4s" }} />
          <span className="ml-1">{statusText}</span>
        </div>
      )}
      {/* Toolbar — permission mode, placeholders */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border/50 bg-surface shrink-0">
        <button className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:bg-surface-hover transition-colors opacity-40 cursor-not-allowed" title="附件上传（即将推出）" disabled>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M3 9v4a1 1 0 001 1h8a1 1 0 001-1V9" />
            <path d="M8 2v8M4.5 5.5L8 2l3.5 3.5" />
          </svg>
        </button>
        <button className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:bg-surface-hover transition-colors opacity-40 cursor-not-allowed" title="思考模式（即将推出）" disabled>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1z" />
            <path d="M8 4.5V8l2.5 2.5" />
          </svg>
        </button>
        <div className="flex-1" />
        <select
          value={permissionMode}
          onChange={(e) => setPermissionMode(e.target.value)}
          className="text-[11px] px-2 py-1 rounded-md bg-surface border border-border text-text-primary outline-none focus:border-accent cursor-pointer"
        >
          <option value="auto">智能判断</option>
          <option value="plan">只读</option>
          <option value="acceptEdits">手动确认</option>
          <option value="bypassPermissions">完全自主</option>
        </select>
        <span className="text-[10px] text-text-secondary hidden sm:inline">权限</span>
        <select
          className="text-[11px] px-2 py-1 rounded-md bg-surface border border-border text-text-primary outline-none focus:border-accent cursor-pointer max-w-[200px]"
          value={chatModel || storeModel}
          onChange={(e) => handleModelChange(e.target.value)}
          title="切换模型"
        >
          {availableModels.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        {balanceText && (
          <span className="text-[10px] text-text-secondary cursor-pointer hover:text-accent transition-colors" onClick={refreshBalance} title="点击刷新余额">{balanceText}</span>
        )}
      </div>
      <div className="border-t border-border p-3 pt-2 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行..."
            rows={3}
            className="flex-1 resize-none bg-surface border border-border rounded-[10px] px-[14px] py-[10px] text-[13px] text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent"
          />
          {(loading || streaming) ? (
            <button
              onClick={() => { stoppedRef.current = true; const rid = currentRunRef.current; if (rid) window.electronAPI.agent.abort(rid); setLoading(false); setStreaming(false); }}
              className="w-9 h-9 rounded-md bg-danger-bg text-danger flex items-center justify-center hover:bg-danger-bg transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="w-9 h-9 rounded-md bg-accent text-text-inverse flex items-center justify-center hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4"><path d="M1 1l14 7-14 7 4-7-4-7z"/></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
