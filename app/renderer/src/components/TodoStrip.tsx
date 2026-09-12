/**
 * 步骤条（会话步骤）— 输入区上沿，Mint 执行追踪的实时展示（用户只读）。
 * 数据源：todo_write 工具广播（agent:todos，按 sessionId 过滤）；收起态 = 进度 + 当前项（耗时/等待态），点击展开。
 * 与用户待办（TodoButton → .easymint/todos.json）是两套清单。
 */
import { memo, useEffect, useRef, useState } from "react";

interface SessionTodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  /** 首次进入 in_progress 的时刻（可能缺失：老数据/其它注入路径，按「无耗时」处理） */
  startedAt?: number;
  /** 正在等用户输入（仅 in_progress 项） */
  waiting?: boolean;
}

const STATUS_ORDER = { in_progress: 0, pending: 1, completed: 2 } as const;

/** 当前项耗时超过此值即用 warning 色（提示可能卡住） */
const STUCK_MS = 10 * 60 * 1000;

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

export const TodoStrip = memo(function TodoStrip({ sessionId }: { sessionId: string }): JSX.Element | null {
  const [todos, setTodos] = useState<SessionTodoItem[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  // 用户关闭横幅后隐藏；新的 todo 广播（Mint 开新任务/更新）到达时自动恢复显示
  const [dismissed, setDismissed] = useState(false);
  // 秒级时钟：只在有带 startedAt 的 in_progress 项时走（见下方 effect）
  const [now, setNow] = useState(() => Date.now());
  // completed 项的耗时基准要冻结——若也跟时钟走，一个 3 分钟做完的步骤过一小时会显示「1h00m」
  const completedAtRef = useRef(new Map<string, number>());
  const receivedAtRef = useRef(Date.now());
  const prevTodosRef = useRef<SessionTodoItem[]>([]);

  useEffect(() => {
    // 换会话时就地重置上一轮记录（stamp 只对本会话清单有意义，sessionId 由外部 ref 传入、可能原地变）
    prevTodosRef.current = [];
    completedAtRef.current.clear();
    const unsub = window.electronAPI.agent.onTodos((data) => {
      if (data.sessionId !== sessionId) return;
      const at = Date.now();
      const prevStatus = new Map(prevTodosRef.current.map((t) => [t.content, t.status]));
      for (const t of data.todos) {
        if (t.status === "completed" && prevStatus.get(t.content) !== "completed") completedAtRef.current.set(t.content, at);
      }
      prevTodosRef.current = data.todos;
      receivedAtRef.current = at;
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

  const list = todos ?? [];
  const sorted = [...list].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  const done = list.filter((t) => t.status === "completed").length;
  const current = list.find((t) => t.status === "in_progress") ?? null;
  const currentStartedAt = typeof current?.startedAt === "number" ? current.startedAt : null;

  useEffect(() => {
    if (currentStartedAt === null) return; // 没有当前项（或老数据缺 startedAt）就不走表
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [currentStartedAt]);

  if (todos === null || todos.length === 0 || dismissed) return null;

  /** 项耗时毫秒；无 startedAt 返回 null（按缺省：不显示耗时） */
  const elapsedMs = (t: SessionTodoItem): number | null => {
    if (typeof t.startedAt !== "number") return null;
    const base = t.status === "in_progress" ? now : (completedAtRef.current.get(t.content) ?? receivedAtRef.current);
    return base - t.startedAt;
  };
  const elapsedText = (t: SessionTodoItem): string | null => {
    const ms = elapsedMs(t);
    return ms === null ? null : formatElapsed(ms);
  };

  const currentWaiting = current?.waiting === true;
  const currentElapsed = current ? elapsedText(current) : null;
  // 等待用户时不判「卡住」：那时长是等人的时间，不是 Mint 卡了（否则「等待你」与 warning 色同时出现，观感相反）
  const currentStuck = current && !currentWaiting ? (elapsedMs(current) ?? 0) > STUCK_MS : false;
  const summary = current ? current.content : (done === list.length ? "全部完成 ✓" : "待开始");

  return (
    <div className="shrink-0 px-[var(--s16)] pt-2">
      <div className="flex items-center gap-1 rounded-[var(--radius-lg)] bg-surface-alt/60 border border-border/60 hover:bg-surface-hover transition-colors">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 text-left"
        >
          <span className="text-[length:var(--text-2xs)] px-1.5 py-px rounded-full bg-accent-soft text-accent leading-tight shrink-0">步骤 {done}/{todos.length}</span>
          <span className={`flex-1 min-w-0 truncate text-xs ${current ? "text-text-primary" : "text-text-secondary"}`}>
            {current ? (
              currentWaiting ? (
                <><span className="text-[length:var(--text-2xs)] px-1.5 py-px rounded-full bg-warning-soft text-warning leading-tight mr-1">等待你</span>{summary}</>
              ) : (
                <><span className="text-accent mr-1">●</span>{summary}</>
              )
            ) : summary}
          </span>
          {currentElapsed && (
            <span className={`shrink-0 text-[length:var(--text-2xs)] tabular-nums ${currentStuck ? "text-warning" : "text-text-muted"}`}>{currentElapsed}</span>
          )}
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
        <div className="mt-1 px-2.5 py-1.5 rounded-[var(--radius-lg)] bg-surface-alt/40 border border-border/40">
          {sorted.map((t, i) => {
            const elapsed = elapsedText(t);
            // warning 色只给还在跑的项（completed 项耗时长是正常结果，不是可能卡住）
            const stuck = t.status === "in_progress" && (elapsedMs(t) ?? 0) > STUCK_MS;
            const waiting = t.status === "in_progress" && t.waiting === true;
            return (
              <div key={i} className={`flex items-start gap-2 py-0.5 text-xs ${t.status === "completed" ? "text-text-muted" : "text-text-secondary"}`}>
                <span className="mt-0.5 shrink-0">
                  {t.status === "completed"
                    ? <span className="text-success">✓</span>
                    : t.status === "in_progress"
                      ? (waiting
                        ? <span className="inline-block w-1.5 h-1.5 rounded-full bg-warning mt-1" />
                        : <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse mt-1" />)
                      : <span className="inline-block w-1.5 h-1.5 rounded-full border border-text-muted mt-1" />}
                </span>
                <span className={`break-words leading-relaxed ${t.status === "completed" ? "line-through" : ""}`}>{t.content}</span>
                {waiting && <span className="shrink-0 text-[length:var(--text-2xs)] px-1.5 py-px rounded-full bg-warning-soft text-warning leading-tight">等待你</span>}
                {elapsed && <span className={`shrink-0 ml-auto text-[length:var(--text-2xs)] tabular-nums ${stuck ? "text-warning" : "text-text-muted"}`}>{elapsed}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
