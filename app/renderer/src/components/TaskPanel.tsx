import { useState, useRef, useEffect, useCallback } from "react";
import { useTaskStore } from "../stores/task-store";
import { useProjectStatusStore } from "../stores/project-status-store";
import { useDelegationStore } from "../stores/delegation-store";

interface TaskPanelProps {
  onCollapse: () => void;
}

const STATUS_ICON: Record<string, JSX.Element> = {
  done: <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0"><circle cx="6" cy="6" r="5" className="fill-success stroke-success" strokeWidth="1"/><path d="M3.5 6l2 2 3-4" className="stroke-inverse" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  building: <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0"><circle cx="6" cy="6" r="5" className="fill-warning stroke-warning" strokeWidth="1"/><circle cx="6" cy="6" r="2.5" className="fill-inverse animate-pulse"/></svg>,
  evaluating: <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0"><circle cx="6" cy="6" r="5" className="fill-accent stroke-accent" strokeWidth="1"/><circle cx="6" cy="6" r="2.5" className="fill-inverse animate-pulse"/></svg>,
  failed: <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0"><circle cx="6" cy="6" r="5" className="fill-danger stroke-danger" strokeWidth="1"/><path d="M4 4l4 4M8 4l-4 4" className="stroke-inverse" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  pending: <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0"><circle cx="6" cy="6" r="5" className="fill-none stroke-muted" strokeWidth="1"/></svg>,
};

// ── Task Row (hover to expand) ──────────────────────

function TaskRow({ task, runningExec }: { task: { id: string; title: string; description?: string; status: string; completedAt?: number }; runningExec?: { status: string; durationMs: number } }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const hasDesc = !!task.description;
  // 委派实时执行覆盖静态 building/evaluating 心跳:显示「运行中 · Ns」
  const isRunning = runningExec?.status === "running";
  const displayStatus = isRunning ? "running" : task.status;
  const durText = isRunning ? `运行中 · ${Math.max(1, Math.round(runningExec.durationMs / 1000))}s` : undefined;

  return (
    <div
      className={`group rounded-lg transition-colors ${displayStatus === "building" || displayStatus === "running" || displayStatus === "evaluating" ? "bg-accent-bg" : displayStatus === "failed" ? "bg-danger-soft" : "hover:bg-accent-subtle"} ${displayStatus === "done" ? "opacity-60" : ""}`}
    >
      <div
        className={`flex items-center gap-2.5 px-2.5 py-2 ${hasDesc ? "cursor-pointer" : "cursor-default"}`}
        onClick={() => hasDesc && setExpanded(!expanded)}
        title={hasDesc ? (expanded ? "收起描述" : "查看描述") : undefined}
      >
        {isRunning ? (
          <svg viewBox="0 0 12 12" fill="none" className="w-3.5 h-3.5 shrink-0 animate-spin text-accent"><circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5" opacity="0.3"/><path d="M11 6a5 5 0 00-5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        ) : (
          <span className="shrink-0">{STATUS_ICON[task.status]}</span>
        )}
        <span className={`text-[length:var(--text-11)] truncate flex-1 leading-snug ${displayStatus === "done" ? "text-text-secondary" : (displayStatus === "building" || displayStatus === "running" || displayStatus === "evaluating") ? "text-text-primary font-medium" : displayStatus === "failed" ? "text-danger" : "text-text-secondary"}`}>
          {task.title}
          {durText && <span className="ml-1.5 text-[length:var(--text-2xs)] text-accent tabular-nums">{durText}</span>}
        </span>
        {hasDesc && (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            className={`w-3 h-3 shrink-0 text-text-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}>
            <path d="M4 6l4 4 4-4" />
          </svg>
        )}
      </div>
      {expanded && hasDesc && (
        <div className="px-2.5 pb-2 pl-8">
          <p className="text-[length:var(--text-2xs)] text-text-secondary leading-relaxed">{task.description}</p>
        </div>
      )}
    </div>
  );
}

// ── Main Panel ──────────────────────────────────────

export function TaskPanel(_props: TaskPanelProps): JSX.Element {
  const { tasks } = useTaskStore();
  const { doneCount, taskCount } = useProjectStatusStore();
  const taskExecutions = useDelegationStore((s) => s.taskExecutions);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [userScrolled, setUserScrolled] = useState(false);

  // 按 task.json 原始顺序（任务 1 在顶，后面的在下），active 任务居中高亮

  const runningIdx = tasks.findIndex((t) => t.status === "building" || t.status === "evaluating");

  const centerRunning = useCallback(() => {
    if (runningIdx < 0 || !listRef.current) return;
    const el = listRef.current;
    if (runningIdx >= el.children.length) return;
    const row = el.children[runningIdx] as HTMLElement;
    el.scrollTo({ top: row.offsetTop - el.clientHeight / 2 + row.clientHeight / 2, behavior: "smooth" });
  }, [runningIdx]);

  useEffect(() => {
    if (!userScrolled) centerRunning();
  }, [runningIdx, userScrolled, centerRunning]);

  const handleScroll = useCallback(() => {
    setUserScrolled(true);
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => {
      setUserScrolled(false);
      centerRunning();
    }, 5000);
  }, [centerRunning]);

  return (
    <div className="h-full flex flex-col bg-[var(--color-drawer-panel)]">
      {/* Header:标题 + 进度条 */}
      <div className="flex items-center gap-2 h-9 px-3 border-b border-border shrink-0">
        <span className="text-[length:var(--text-11)] font-semibold tracking-[0.04em] uppercase text-text-secondary">任务</span>
        {taskCount > 0 && (
          <span className="ml-auto text-[length:var(--text-2xs)] text-text-secondary tabular-nums">{doneCount}/{taskCount} 完成</span>
        )}
      </div>

      {/* 进度条 */}
      {taskCount > 0 && (
        <div className="px-3 pt-2 shrink-0">
          <div className="h-1 rounded-full bg-surface-hover overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${taskCount > 0 ? (doneCount / taskCount) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {/* Task list — mint container always visible, fixed area */}
      <div className="flex-1 min-h-0 flex flex-col px-2 py-2">
        <div ref={listRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto space-y-0.5">
          {tasks.length > 0 ? (
            tasks.map((task) => (
              <TaskRow key={task.id} task={task} runningExec={taskExecutions[task.id]} />
            ))
          ) : (
            <div className="flex items-center justify-center flex-1 py-8 text-[length:var(--text-2xs)] text-text-secondary">暂无任务</div>
          )}
        </div>
      </div>
    </div>
  );
}
