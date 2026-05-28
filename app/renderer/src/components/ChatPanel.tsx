import { useState, useEffect, useRef, useCallback } from "react";
import { normalizeEvent, StreamEntryView } from "./StreamPanel";
import { useSettingsStore } from "../stores/settings-store";

interface ChatMessage {
  id: number;
  role: "user" | "ai";
  text?: string;
  entry?: ReturnType<typeof normalizeEvent>;
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
  const evaluateMode = useSettingsStore((s) => s.evaluateMode);

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

  // 监听流式事件
  useEffect(() => {
    const unsubStream = window.electronAPI.agent.onStream(
      (event: StreamEvent) => {
        if (event.source !== "chat") return;
        const msgId = ++msgIdRef.current;
        const ts = event.timestamp || Date.now();

        if (event.type === "user_message" && typeof event.data.text === "string") {
          setMessages((prev) => [
            ...prev,
            { id: msgId, role: "user", text: event.data.text as string, timestamp: ts },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            { id: msgId, role: "ai", entry: normalizeEvent(event), timestamp: ts },
          ]);
        }
      }
    );

    const unsubStderr = window.electronAPI.agent.onStderr(
      (data: { runId: string; data: string; timestamp: number }) => {
        setMessages((prev) => [
          ...prev,
          {
            id: ++msgIdRef.current,
            role: "ai",
            entry: { kind: "error", data: data.data, timestamp: data.timestamp } as ReturnType<
              typeof normalizeEvent
            >,
            timestamp: data.timestamp,
          },
        ]);
      }
    );

    const unsubExit = window.electronAPI.agent.onExit(
      (data: { runId: string; code: number }) => {
        setMessages((prev) => [
          ...prev,
          {
            id: ++msgIdRef.current,
            role: "ai",
            entry: { kind: "exit", code: data.code, timestamp: Date.now() } as ReturnType<
              typeof normalizeEvent
            >,
            timestamp: Date.now(),
          },
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
              <div className="text-5xl mb-5">✨</div>
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
                    <div className="flex flex-col items-end max-w-[75%]">
                      <div className="bg-accent text-white rounded-2xl rounded-br-md px-4 py-2 text-sm">
                        {msg.text}
                      </div>
                      <span className="text-[10px] text-text-secondary mt-0.5 px-1">
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                  </div>
                ) : msg.entry ? (
                  <div className="flex flex-col">
                    <div className="bg-surface rounded-2xl rounded-bl-md px-4 py-2 text-sm text-text-primary max-w-[85%]">
                      <StreamEntryView entry={msg.entry} />
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
            className="flex-1 resize-none bg-surface-alt border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:ring-1 focus:ring-accent/50"
            disabled={!active && chatId !== null}
          />
          <div className="flex flex-col gap-1.5">
            <button
              onClick={handleSend}
              disabled={!input.trim() || !active}
              className="w-9 h-9 rounded-full bg-accent text-white text-sm flex items-center justify-center hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              ↑
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

      {/* Token 状态栏 */}
      <div className="h-7 border-t border-border bg-surface-alt flex items-center justify-between px-3 shrink-0">
        <span className="text-[10px] text-text-secondary">
          模式：<span className="text-text-primary font-medium">{evaluateMode ? "评估中" : "普通开发"}</span>
        </span>
        <span className="text-[10px] text-text-secondary">
          预估消耗：<span className="text-accent">{"⭐".repeat(evaluateMode ? 3 : 1)}</span>
        </span>
      </div>
    </div>
  );
}
