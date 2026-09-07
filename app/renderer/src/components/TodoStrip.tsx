/**
 * 待办条（会话待办）— 输入区上沿，Mint 执行追踪的实时展示（用户只读）。
 * 数据源：todo_write 工具广播（agent:todos，按 sessionId 过滤）；收起态 = 进度 + 当前项，点击展开。
 * 与用户待办（TodoButton → .easymint/todos.json）是两套清单。
 */
import { memo, useEffect, useState } from "react";

interface SessionTodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

const STATUS_ORDER = { in_progress: 0, pending: 1, completed: 2 } as const;

export const TodoStrip = memo(function TodoStrip({ sessionId }: { sessionId: string }): JSX.Element | null {
  const [todos, setTodos] = useState<SessionTodoItem[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  // 用户关闭横幅后隐藏；新的 todo 广播（Mint 开新任务/更新）到达时自动恢复显示
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const unsub = window.electronAPI.agent.onTodos((data) => {
      if (data.sessionId !== sessionId) return;
      setTodos(data.todos);
      if (data.todos.length > 0) setDismissed(false);
    });
    return () => { unsub(); };
  }, [sessionId]);

  // 全部完成 5s 后自动消失（用户不再需要手动关闭）
  const allCompleted = todos !== null && todos.length > 0 && todos.every((t) => t.status === "completed");
  useEffect(() => {
    if (!allCompleted || dismissed) return;
    const t = setTimeout(() => setDismissed(true), 5000);
    return () => clearTimeout(t);
  }, [allCompleted, dismissed]);

  if (todos === null || todos.length === 0 || dismissed) return null;

  const sorted = [...todos].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  const done = todos.filter((t) => t.status === "completed").length;
  const current = sorted.find((t) => t.status === "in_progress") ?? null;
  const summary = current ? current.content : (done === todos.length ? "全部完成 ✓" : "待开始");

  return (
    <div className="shrink-0 px-[var(--s16)] pt-2">
      <div className="flex items-center gap-1 rounded-md bg-surface-alt/60 border border-border/60 hover:bg-surface-hover transition-colors">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 text-left"
          
        >
          <span className="text-[length:var(--text-2xs)] px-1.5 py-px rounded-full bg-accent-soft text-accent leading-tight shrink-0">待办 {done}/{todos.length}</span>
          <span className={`flex-1 min-w-0 truncate text-xs ${current ? "text-text-primary" : "text-text-secondary"}`}>
            {current ? (
              <><span className="text-accent mr-1">●</span>{summary}</>
            ) : summary}
          </span>
        </button>
        <button
          type="button"
          className="shrink-0 px-1.5 py-1.5 text-text-muted hover:text-text-primary transition-colors"
         
          onClick={() => setDismissed(true)}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
        <button
          type="button"
          className="shrink-0 pr-2 py-1.5 text-text-muted hover:text-text-primary transition-colors"
          
          onClick={() => setExpanded((v) => !v)}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${expanded ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6"/></svg>
        </button>
      </div>
      {expanded && (
        <div className="mt-1 px-2.5 py-1.5 rounded-md bg-surface-alt/40 border border-border/40">
          {sorted.map((t, i) => (
            <div key={i} className={`flex items-start gap-2 py-0.5 text-xs ${t.status === "completed" ? "text-text-muted" : "text-text-secondary"}`}>
              <span className={`mt-0.5 shrink-0 ${t.status === "in_progress" ? "text-accent" : t.status === "completed" ? "" : ""}`}>
                {t.status === "completed" ? <span className="text-success">✓</span> : t.status === "in_progress" ? <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse mt-1" /> : <span className="inline-block w-1.5 h-1.5 rounded-full border border-text-muted mt-1" />}
              </span>
              <span className={`break-words leading-relaxed ${t.status === "completed" ? "line-through" : ""}`}>{t.content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
