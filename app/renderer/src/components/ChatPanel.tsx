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
  /** Existing conversation to resume, or undefined for new */
  convId?: string;
  onConvCreated?: (convId: string, title: string) => void;
}

export function ChatPanel({ projectPath, convId, onConvCreated }: ChatPanelProps): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const msgIdRef = useRef(0);
  const convIdRef = useRef<string | undefined>(convId);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Sync convId ref
  useEffect(() => { convIdRef.current = convId; }, [convId]);

  const scrollToBottom = useCallback(() => {
    if (autoScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, []);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  // Load existing messages
  useEffect(() => {
    if (!convId) return;
    window.electronAPI.conv.messages(convId).then((msgs) => {
      const mapped: ChatMessage[] = msgs.map((m) => ({
        id: ++msgIdRef.current,
        role: m.role === "user" ? "user" : "ai",
        text: m.role === "user" ? m.content : undefined,
        entries: m.role === "assistant" ? [{ kind: "text", text: m.content, timestamp: m.createdAt }] : undefined,
        timestamp: m.createdAt,
      }));
      setMessages(mapped);
    });
  }, [convId]);

  // Stream listener — batch AI events into turns, save text to JSONL
  useEffect(() => {
    let currentAiId = 0;
    const unsub = window.electronAPI.agent.onStream((event: StreamEvent) => {
      if (event.source !== "chat") return;
      const entry = normalizeEvent(event);
      if (!entry) return;
      if (!currentAiId) {
        currentAiId = ++msgIdRef.current;
        setMessages((prev) => [...prev, { id: currentAiId, role: "ai", entries: [entry], timestamp: entry.timestamp }]);
      } else {
        setMessages((prev) => prev.map((m) => m.id === currentAiId ? { ...m, entries: [...(m.entries || []), entry], timestamp: entry.timestamp } : m));
      }
      // Save assistant text to JSONL
      if (entry.kind === "text" && convIdRef.current) {
        window.electronAPI.conv.appendMessage(convIdRef.current, { id: `a-${entry.timestamp}`, role: "assistant", content: entry.text, createdAt: entry.timestamp }).catch(() => {});
      }
    });
    const unsubExit = window.electronAPI.agent.onExit(() => { currentAiId = 0; setLoading(false); });
    return () => { unsub(); unsubExit(); };
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // Optimistic send: create conv if needed, append user message, call sendMessage
  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    const ts = Date.now();

    // Create conversation if first message with no existing conv
    let cid = convIdRef.current;
    if (!cid) {
      const meta = await window.electronAPI.conv.create("新会话");
      cid = meta.id;
      convIdRef.current = cid;
      onConvCreated?.(cid, meta.title);
    }

    // Optimistic user message + save to JSONL
    setMessages((prev) => [...prev, { id: ++msgIdRef.current, role: "user", text: trimmed, timestamp: ts }]);
    window.electronAPI.conv.appendMessage(cid, { id: `u-${ts}`, role: "user", content: trimmed, createdAt: ts }).catch(() => {});
    setInput("");
    setLoading(true);

    try {
      const result = await window.electronAPI.agent.sendMessage(projectPath, trimmed, sessionId);
      if (!sessionId) setSessionId(result.sessionId);
      // Auto-title from first user message
      window.electronAPI.conv.update(cid, { title: trimmed.slice(0, 30) + (trimmed.length > 30 ? "…" : "") }).catch(() => {});
    } catch {
      setLoading(false);
    }
  }, [input, projectPath, sessionId, onConvCreated]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-col h-full">
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
            {messages.map((msg) => (
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
                      {buildBlocks(msg.entries).map((block, i) => <ChatBlockView key={i} block={block} />)}
                    </div>
                    <span className="text-[10px] text-text-secondary mt-0.5 px-1">{formatTime(msg.timestamp)}</span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-border p-3 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行..."
            rows={3}
            className="flex-1 resize-none bg-surface border border-border rounded-[10px] px-[14px] py-[10px] text-[13px] text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent"
            disabled={loading}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="w-9 h-9 rounded-md bg-accent text-white flex items-center justify-center hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4"><path d="M1 1l14 7-14 7 4-7-4-7z"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
