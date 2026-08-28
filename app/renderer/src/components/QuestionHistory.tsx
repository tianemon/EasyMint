import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChatMessage } from "./chat-utils";

interface QuestionHistoryProps {
  sessionId?: string;
  messages: ChatMessage[];
  /** 点击提问记录：滚动到对应消息（顶部对齐）并高亮 */
  onJump: (msgId: number) => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

/** 历史提问记录：消息区右上角按钮 + 右侧滑出抽屉（半透明玻璃感，遮罩点击/Escape 关闭）。
 *  列表 = 当前会话 role=user 且有文本的非系统消息，最新在上；点击跳转到对应消息（顶部对齐） */
export function QuestionHistory({ sessionId, messages, onJump }: QuestionHistoryProps): JSX.Element {
  const [open, setOpen] = useState(false);

  // 会话切换自动关闭（抽屉属于具体会话的提问列表）
  useEffect(() => { setOpen(false); }, [sessionId]);

  // Escape 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // 搜索关键词（历史输入过滤）
  const [query, setQuery] = useState("");

  // 用户提问：role=user 且有正文、非系统消息（customType 是系统卡片，不算提问）
  const questions = useMemo(
    () => messages.filter((m) => m.role === "user" && m.text && !m.customType),
    [messages],
  );
  // 最新在上（回顾历史提问从最近开始）；有搜索词时按正文过滤（大小写不敏感）
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = [...questions].reverse();
    if (!q) return base;
    return base.filter((m) => (m.text || "").toLowerCase().includes(q));
  }, [questions, query]);

  // 无蒙版抽屉：点击抽屉外区域关闭（按钮本身除外，避免 toggle 被 mousedown 抢先关闭）
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (drawerRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // 打开抽屉时聚焦搜索框：autoFocus 在条件渲染 + portal 场景重开时可能不聚焦，
  // 显式 focus 保证每次打开光标都在搜索框
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  return (
    <>
      {/* 按钮：消息区右上角悬浮（ChatPanel 根为相对容器，不随消息滚动）。
          定位在根内 top-1:原 top-[-12px] 伸入上方 TabBar 区域,空会话/打开会话两态下
          与 TabBar 内容的位置关系变化导致 1-2px 视觉漂移——根内定位彻底解耦 */}
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="提问记录"
        className="no-drag absolute top-1 right-[18px] z-40 w-8 h-8 rounded-lg flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
      </button>

      {open && createPortal(
        // 抽屉面板：右侧滑出，半透明玻璃质感（透过可见模糊背景；无蒙版、无关闭按钮，
        // 点击列表项/外部区域关闭）。portal 到 body 视口定位:顶部到窗口顶、底部到窗口底;
        // 列表底部 mask 渐隐(接近边缘的文字淡出),见下方列表容器
        <div
          ref={drawerRef}
          className="no-drag fixed right-0 top-0 bottom-0 w-[300px] z-[60] flex flex-col rounded-l-xl shadow-2xl animate-[drawer-in_200ms_ease-out]"
          style={{
            background: "color-mix(in oklab, var(--color-surface-elevated) 65%, transparent)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
          }}
        >
            {/* 搜索框（标准胶囊样式）：input 绝对定位铺满容器——外观即输入框本体，
                无嵌套矩形；图标/清空按钮 absolute 定位 + pointer-events-none 不挡点击 */}
            <div className="shrink-0 px-3 pt-[20px] pb-2">
              {/* 容器 onMouseDown 强制聚焦:输入框命中区域异常(用户环境实测点击占位符位置无反应)时,
                  容器内任意位置点击都能聚焦——不依赖 input 盒子位置 */}
              <div className="relative h-10 rounded-xl border border-border/60 bg-surface/70 overflow-hidden" onMouseDown={() => inputRef.current?.focus()}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索历史输入"
                  onMouseDown={() => inputRef.current?.focus()}
                  // 上下各留 2px:输入框实际高度略小于胶囊外形,避免顶满边框
                  className="absolute left-0 right-0 top-0.5 bottom-0.5 w-full h-full pl-9 pr-8 bg-transparent border-none outline-none appearance-none text-xs text-text-primary placeholder:text-text-muted"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
                    title="清空搜索"
                  >
                    <svg viewBox="0 0 14 14" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 3l8 8M11 3L3 11"/></svg>
                  </button>
                )}
              </div>
            </div>
            {/* 提问列表:底部 mask 渐隐(24px 内文字渐隐淡出,贴近边缘的条目变淡) */}
            <div
              className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1"
              style={{
                maskImage: "linear-gradient(to top, transparent 0, black 24px)",
                WebkitMaskImage: "linear-gradient(to top, transparent 0, black 24px)",
              }}
            >
              {list.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-text-muted">{query.trim() ? "无匹配结果" : "暂无提问记录"}</div>
              ) : (
                list.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => { setOpen(false); onJump(q.id); }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors"
                  >
                    <div className="text-[length:var(--text-2xs)] text-text-secondary mb-0.5 tabular-nums">{formatTime(q.timestamp)}</div>
                    <div className="text-xs text-text-primary leading-snug line-clamp-2 break-words">{q.text}</div>
                  </button>
                ))
              )}
            </div>
          </div>,
        document.body,
      )}
    </>
  );
}
