import { useState, useEffect, useRef, useCallback } from "react";
import { normalizeEvent } from "./StreamPanel";
import { buildBlocks, ChatBlockView } from "./ChatBlocks";


interface ChatMessage {
  id: number;
  role: "user" | "ai";
  text?: string;
  entries?: ReturnType<typeof normalizeEvent>[];
  timestamp: number;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
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
  const [permissionMode, setPermissionMode] = useState("auto");
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
      // Use rAF to ensure DOM has painted the new message
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

  // Load history for existing session
  useEffect(() => {
    if (!existingSid) return;
    let cancelled = false;
    const load = () => {
      window.electronAPI.conv.messages(existingSid, projectPath).then((msgs) => {
        if (cancelled) return;
        const mapped: ChatMessage[] = [];
        for (const m of msgs) {
          if (m.type === "user") {
            const content = (m.message as { content?: string | unknown[] })?.content;
            const text = typeof content === "string" ? content : Array.isArray(content)
              ? content.map((b: unknown) => (b as { text?: string })?.text ?? "").join("")
              : "";
            if (text) mapped.push({ id: ++msgIdRef.current, role: "user", text, timestamp: Date.now() });
          } else if (m.type === "assistant") {
            const content = (m.message as { content?: unknown[] })?.content;
            if (Array.isArray(content)) {
              const textBlocks = content.filter((b: unknown) => (b as { type?: string })?.type === "text");
              const text = textBlocks.map((b: unknown) => (b as { text?: string })?.text ?? "").join("\n");
              if (text) {
                mapped.push({ id: ++msgIdRef.current, role: "ai", entries: [{ kind: "text", text, timestamp: Date.now() }], timestamp: Date.now() });
              }
            }
          }
        }
        if (mapped.length > 0) {
          setMessages(mapped);
        } else {
          // SDK may not have persisted yet — retry once after 800ms
          setTimeout(() => {
            if (cancelled) return;
            window.electronAPI.conv.messages(existingSid, projectPath).then((retryMsgs) => {
              if (cancelled) return;
              const retryMapped: ChatMessage[] = [];
              for (const m of retryMsgs) {
                if (m.type === "user") {
                  const content = (m.message as { content?: string | unknown[] })?.content;
                  const text = typeof content === "string" ? content : Array.isArray(content)
                    ? content.map((b: unknown) => (b as { text?: string })?.text ?? "").join("")
                    : "";
                  if (text) retryMapped.push({ id: ++msgIdRef.current, role: "user", text, timestamp: Date.now() });
                }
              }
              if (retryMapped.length > 0) setMessages(retryMapped);
            }).catch(() => {});
          }, 800);
        }
      }).catch(() => {});
    };
    load();
    return () => { cancelled = true; };
  }, [existingSid, projectPath]);


  // Check if session is active on mount — show stop button if assistant is working
  useEffect(() => {
    if (!existingSid) return;
    window.electronAPI.agent.isSessionActive(existingSid).then((active) => {
      if (active) { setLoading(true); setStreaming(true); }
    });
  }, [existingSid]);

  // Stream listener
  useEffect(() => {
    let currentAiId = 0;
    const unsub = window.electronAPI.agent.onStream((event: StreamEvent) => {
      if (event.source !== "chat") return;
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
      scrollToBottom(true);
    });
    const unsubExit = window.electronAPI.agent.onExit(({ runId }) => { if (currentRunRef.current && runId !== currentRunRef.current) return; currentAiId = 0; setLoading(false); setStreaming(false); onActivity?.(); });
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
    autoScrollRef.current = true;
    scrollToBottom(true);

    try {
      setStreaming(true);
      const result = await window.electronAPI.agent.sendMessage(projectPath, trimmed, {
        sessionId: sidRef.current,
        permissionMode,
      });
      setCurrentRunId(result.chatId);
      currentRunRef.current = result.chatId;
    } catch {
      setLoading(false);
    }
  }, [projectPath, loading, permissionMode]);

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
            <div className="text-center px-6">
              <svg className="w-12 h-12 mb-5 text-accent opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2l1.5 5h5l-4 3 1.5 5-4-3-4 3 1.5-5-4-3h5L12 2z"/></svg>
              <h2 className="text-lg font-semibold text-text-primary mb-2">欢迎使用 EasyMint</h2>
              <p className="text-sm text-text-secondary mb-6">与 Claude 自由对话，讨论需求和方案</p>
              <div className="flex gap-2 justify-center flex-wrap">
                <button onClick={() => { setInput("帮我新建一个 Web 项目"); }} className="px-4 py-2 text-xs rounded-lg border border-accent/30 bg-accent/5 text-accent hover:bg-accent/10 transition-colors">新建项目</button>
                <button onClick={() => { setInput("帮我创建一个个人博客项目"); }} className="px-4 py-2 text-xs rounded-lg border border-border bg-surface-alt text-text-primary hover:bg-surface-hover transition-colors">创建博客</button>
                <button onClick={() => { setInput("帮我分析当前项目的代码结构"); }} className="px-4 py-2 text-xs rounded-lg border border-border bg-surface-alt text-text-primary hover:bg-surface-hover transition-colors">分析项目</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {messages.map((msg, idx) => {
              const isLast = idx === messages.length - 1;
              const aiText = msg.role === "ai" && msg.entries
                ? msg.entries.filter((e) => e.kind === "text").map((e: { text?: string }) => e.text ?? "").join("")
                : "";
              const hasInitPrompt = isLast && aiText.includes("帮我初始化开发环境");
              return (
                <div key={msg.id} className="msg-in">
                  {msg.role === "user" && msg.text ? (
                    <div className="flex justify-end">
                      <div className="flex flex-col items-end max-w-[82%]">
                        <div className="bg-accent text-white rounded-[10px] rounded-br-[4px] px-[14px] py-[10px] text-[13px] leading-[1.55]">
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
          {loading ? (
            <button
              onClick={() => { if (currentRunId) window.electronAPI.agent.abort(currentRunId); setLoading(false); setStreaming(false); }}
              className="w-9 h-9 rounded-md bg-red-500/20 text-red-400 flex items-center justify-center hover:bg-red-500/30 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="w-9 h-9 rounded-md bg-accent text-white flex items-center justify-center hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4"><path d="M1 1l14 7-14 7 4-7-4-7z"/></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
