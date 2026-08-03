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
      className={`border-b border-border last:border-0 transition-colors ${displayStatus === "building" || displayStatus === "running" || displayStatus === "evaluating" ? "bg-accent-bg" : displayStatus === "failed" ? "bg-danger-soft" : "hover:bg-accent-subtle"}`}
      onMouseEnter={() => hasDesc && setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div className="flex items-center gap-2 px-3 py-1.5">
        {isRunning ? (
          <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0 animate-spin text-accent"><circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5" opacity="0.3"/><path d="M11 6a5 5 0 00-5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        ) : (
          STATUS_ICON[task.status]
        )}
        <span className={`text-[11px] truncate flex-1 ${displayStatus === "done" ? "text-text-secondary" : (displayStatus === "building" || displayStatus === "running" || displayStatus === "evaluating") ? "text-text-primary font-medium" : displayStatus === "failed" ? "text-danger" : "text-text-secondary"}`}>
          {task.title}
          {durText && <span className="ml-1.5 text-[10px] text-accent tabular-nums">{durText}</span>}
        </span>
      </div>
      {expanded && hasDesc && (
        <div className="px-3 pb-2 pl-8">
          <p className="text-[10px] text-text-secondary leading-relaxed">{task.description}</p>
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
    <div className="h-full flex flex-col bg-sidebar-active">
      {/* Header:标题 + 任务数量同行 */}
      <div className="flex items-center gap-2 h-9 px-3 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold tracking-[0.04em] uppercase text-text-secondary">任务</span>
        {taskCount > 0 && (
          <span className="ml-auto text-[10px] text-text-secondary tabular-nums">{doneCount}/{taskCount} 完成</span>
        )}
      </div>

      {/* Task list — mint container always visible, fixed area */}
      <div className="flex-1 min-h-0 flex flex-col px-3 py-1.5">
        <div ref={listRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto">
          {tasks.length > 0 ? (
            tasks.map((task) => (
              <TaskRow key={task.id} task={task} runningExec={taskExecutions[task.id]} />
            ))
          ) : (
            <div className="flex items-center justify-center flex-1 py-8 text-[10px] text-text-secondary">暂无任务</div>
          )}
        </div>
      </div>
    </div>
  );
}
