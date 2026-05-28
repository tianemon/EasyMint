import { useState, useEffect, useRef, useCallback } from "react";
import { normalizeEvent, StreamEntryView, UserChatBubble } from "./StreamPanel";

interface ChatMessage {
  id: number;
  role: "user" | "ai";
  text?: string;
  entry?: ReturnType<typeof normalizeEvent>;
}

export function ChatPanel({ projectPath }: { projectPath: string }): JSX.Element {
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

  // 监听流式事件
  useEffect(() => {
    const unsubStream = window.electronAPI.agent.onStream(
      (event: StreamEvent) => {
        if (event.source !== "chat") return;
        const msgId = ++msgIdRef.current;

        if (event.type === "user_message" && typeof event.data.text === "string") {
          setMessages((prev) => [
            ...prev,
            { id: msgId, role: "user", text: event.data.text as string },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            { id: msgId, role: "ai", entry: normalizeEvent(event) },
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
            entry: {
              kind: "error",
              data: data.data,
              timestamp: data.timestamp,
            } as ReturnType<typeof normalizeEvent>,
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
            entry: {
              kind: "exit",
              code: data.code,
              timestamp: Date.now(),
            } as ReturnType<typeof normalizeEvent>,
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

    window.electronAPI.agent.sendMessage(chatId, trimmed);
    setInput("");
  }, [input, chatId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleStop = useCallback(() => {
    if (chatId) {
      window.electronAPI.agent.stopChat(chatId);
      setActive(false);
    }
  }, [chatId]);

  return (
    <div className="flex flex-col h-full">
      {/* 消息区域 */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-3"
      >
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-text-secondary">
            <div className="text-center">
              <div className="text-4xl mb-4">💭</div>
              <p>Chat 对话</p>
              <p className="text-sm mt-1">与 Claude 自由对话，讨论需求和方案</p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id}>
            {msg.role === "user" && msg.text ? (
              <UserChatBubble text={msg.text} />
            ) : msg.entry ? (
              <StreamEntryView entry={msg.entry} />
            ) : null}
          </div>
        ))}
      </div>

      {/* 输入区域 */}
      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息，Enter 发送..."
            rows={2}
            className="flex-1 resize-none bg-surface-alt border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:ring-1 focus:ring-accent/50"
            disabled={!active && chatId !== null}
          />
          <div className="flex flex-col gap-1">
            <button
              onClick={handleSend}
              disabled={!input.trim() || !active}
              className="px-4 py-1.5 bg-accent text-white text-sm rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              发送
            </button>
            {active && (
              <button
                onClick={handleStop}
                className="px-4 py-1.5 bg-red-500/20 text-red-400 text-sm rounded-lg hover:bg-red-500/30 transition-colors"
              >
                停止
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
