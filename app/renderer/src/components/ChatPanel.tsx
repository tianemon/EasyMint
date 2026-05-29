import { useState, useEffect, useRef, useCallback } from "react";
import { normalizeEvent } from "./StreamPanel";
import { buildBlocks, ChatBlockView } from "./ChatBlocks";

interface ChatMessage {
  id: number;
  role: "user" | "ai";
  text?: string;
  /** AI messages batch events into one turn: text entries shown, others collapsed */
  entries?: ReturnType<typeof normalizeEvent>[];
  timestamp: number;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export function ChatPanel({
  projectPath,
  onSendFirstMessage,
}: {
  projectPath: string;
  onSendFirstMessage?: () => void;
}): JSX.Element {
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [active, setActive] = useState(false);
  const msgIdRef = useRef(0);
  const chatIdRef = useRef<string | null>(null);
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

  // 启动 Chat
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.agent.startChat(projectPath).then((result: { chatId: string }) => {
      if (!cancelled) {
        chatIdRef.current = result.chatId;
        setChatId(result.chatId);
        setActive(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  // unmount 时关闭 chat
  useEffect(() => {
    return () => {
      if (chatIdRef.current) {
        window.electronAPI.agent.stopChat(chatIdRef.current);
      }
    };
  }, []);

  // 监听流式事件 — batch AI events into one turn, user_message starts new turn
  useEffect(() => {
    let currentAiId = 0;

    const unsubStream = window.electronAPI.agent.onStream(
      (event: StreamEvent) => {
        if (event.source !== "chat") return;
        const ts = event.timestamp || Date.now();

        if (event.type === "user_message" && typeof event.data.text === "string") {
          setMessages((prev) => [
            ...prev,
            { id: ++msgIdRef.current, role: "user", text: event.data.text as string, timestamp: ts },
          ]);
          return;
        }

        // Batch AI events into current turn
        const entry = normalizeEvent(event);
        if (!currentAiId) {
          currentAiId = ++msgIdRef.current;
          setMessages((prev) => [...prev, { id: currentAiId, role: "ai", entries: [entry], timestamp: ts }]);
        } else {
          setMessages((prev) =>
            prev.map((m) => (m.id === currentAiId ? { ...m, entries: [...(m.entries || []), entry], timestamp: ts } : m))
          );
        }
      }
    );

    const unsubStderr = window.electronAPI.agent.onStderr(
      (data: { runId: string; data: string; timestamp: number }) => {
        setMessages((prev) => [
          ...prev,
          { id: ++msgIdRef.current, role: "ai" as const, entries: [{ kind: "error", data: data.data, timestamp: data.timestamp } as ReturnType<typeof normalizeEvent>], timestamp: data.timestamp },
        ]);
      }
    );

    const unsubExit = window.electronAPI.agent.onExit(
      (data: { runId: string; code: number }) => {
        currentAiId = 0; // end current turn
        setMessages((prev) => [
          ...prev,
          { id: ++msgIdRef.current, role: "ai" as const, entries: [{ kind: "exit", code: data.code, timestamp: Date.now() } as ReturnType<typeof normalizeEvent>], timestamp: Date.now() },
        ]);
        setActive(false);
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
  }, [messages, scrollToBottom]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || !chatId) return;

    if (messages.length === 0 && onSendFirstMessage) {
      onSendFirstMessage();
    }
    window.electronAPI.agent.sendMessage(chatId, trimmed);
    setInput("");
  }, [input, chatId, messages.length, onSendFirstMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleStop = useCallback(() => {
    if (chatId) {
      window.electronAPI.agent.stopChat(chatId);
      setActive(false);
    }
  }, [chatId]);

  const handleQuickAction = useCallback(
    (prompt: string) => {
      if (!chatId) return;
      if (messages.length === 0 && onSendFirstMessage) {
        onSendFirstMessage();
      }
      window.electronAPI.agent.sendMessage(chatId, prompt);
    },
    [chatId, messages.length, onSendFirstMessage]
  );

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* 消息区域 / 欢迎页 */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {!hasMessages ? (
          /* 欢迎页 */
          <div className="flex items-center justify-center h-full">
            <div className="text-center px-6">
              <svg className="w-12 h-12 mb-5 text-accent opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2l1.5 5h5l-4 3 1.5 5-4-3-4 3 1.5-5-4-3h5L12 2z"/></svg>
              <h2 className="text-lg font-semibold text-text-primary mb-2">
                欢迎使用 EasyMint
              </h2>
              <p className="text-sm text-text-secondary mb-6">
                与 Claude 自由对话，讨论需求和方案
              </p>
              <div className="flex gap-2 justify-center flex-wrap">
                <button
                  onClick={() => handleQuickAction("帮我新建一个 Web 项目")}
                  className="px-4 py-2 text-xs rounded-lg border border-accent/30 bg-accent/5 text-accent hover:bg-accent/10 transition-colors"
                >
                  新建项目
                </button>
                <button
                  onClick={() => handleQuickAction("帮我创建一个个人博客项目")}
                  className="px-4 py-2 text-xs rounded-lg border border-border bg-surface-alt text-text-primary hover:bg-surface-hover transition-colors"
                >
                  创建博客
                </button>
                <button
                  onClick={() => handleQuickAction("帮我分析当前项目的代码结构")}
                  className="px-4 py-2 text-xs rounded-lg border border-border bg-surface-alt text-text-primary hover:bg-surface-hover transition-colors"
                >
                  分析项目
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* 消息列表 */
          <div className="p-4 space-y-3">
            {messages.map((msg) => (
              <div key={msg.id} className="msg-in">
                {msg.role === "user" && msg.text ? (
                  <div className="flex justify-end">
                    <div className="flex flex-col items-end max-w-[82%]">
                      <div className="bg-accent text-white rounded-[10px] rounded-br-[4px] px-[14px] py-[10px] text-[13px] leading-[1.55]">
                        {msg.text}
                      </div>
                      <span className="text-[10px] text-text-secondary mt-0.5 px-1">
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                  </div>
                ) : msg.entries ? (
                  <div className="flex flex-col max-w-[85%]">
                    <div className="bg-surface border border-border rounded-[10px] rounded-bl-[4px] px-[14px] py-2">
                      {buildBlocks(msg.entries).map((block, i) => (
                        <ChatBlockView key={i} block={block} />
                      ))}
                    </div>
                    <span className="text-[10px] text-text-secondary mt-0.5 px-1">
                      {formatTime(msg.timestamp)}
                    </span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 输入区域 */}
      <div className="border-t border-border p-3 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行..."
            rows={3}
            className="flex-1 resize-none bg-surface border border-border rounded-[10px] px-[14px] py-[10px] text-[13px] text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent"
          />
          <div className="flex flex-col gap-1.5">
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="w-9 h-9 rounded-md bg-accent text-white flex items-center justify-center hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4"><path d="M1 1l14 7-14 7 4-7-4-7z"/></svg>
            </button>
            {active && (
              <button
                onClick={handleStop}
                className="w-9 h-9 rounded-full bg-red-500/20 text-red-400 text-xs flex items-center justify-center hover:bg-red-500/30 transition-colors"
              >
                ■
              </button>
            )}
          </div>
        </div>
        {!active && chatId !== null && (
          <p className="text-xs text-text-secondary mt-1">Chat 已结束。关闭面板可重新开始。</p>
        )}
      </div>

    </div>
  );
}
