import { useState, useRef, useEffect, useCallback } from "react";
import { useTaskStore } from "../stores/task-store";

interface TaskPanelProps {
  projectPath: string;
  onCollapse: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "待执行",
  running: "运行中",
  done: "已完成",
  failed: "失败",
};

/** Scale: 0 = densest, 4 = loosest */
const DENSITY_GAPS = ["gap-1", "gap-2", "gap-3", "gap-4", "gap-5"];

export function TaskPanel({ projectPath, onCollapse }: TaskPanelProps): JSX.Element {
  const { tasks, updateTask, appendOutput } = useTaskStore();
  const [executing, setExecuting] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [density, setDensity] = useState(2);
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [tasks]);

  const execute = useCallback(async (taskId: string) => {
    const task = useTaskStore.getState().tasks.find((t) => t.id === taskId);
    if (!task || executing) return;

    setExecuting(taskId);
    setExpandedId(taskId);
    updateTask(taskId, { status: "running", output: [] });

    const unsubOut = window.electronAPI.shell.onStdout(({ line }) => {
      appendOutput(taskId, line);
    });
    const unsubErr = window.electronAPI.shell.onStderr(({ line }) => {
      appendOutput(taskId, `[stderr] ${line}`);
    });

    try {
      const result = await window.electronAPI.shell.exec(projectPath, task.command);
      updateTask(taskId, { status: result.code === 0 ? "done" : "failed" });
    } catch {
      updateTask(taskId, { status: "failed" });
    } finally {
      unsubOut();
      unsubErr();
      setExecuting(null);
    }
  }, [projectPath, executing, updateTask, appendOutput]);

  const activeTask = tasks.find((t) => t.id === executing) || tasks.find((t) => t.status === "running");

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold tracking-[0.04em] uppercase text-text-secondary">任务时间轴</span>
        <span className="text-2xs text-text-secondary">{tasks.length} 个</span>
        <div className="flex-1" />
        {/* Density control */}
        <div className="flex items-center gap-1">
          <button
            className={`w-5 h-5 rounded flex items-center justify-center text-[10px] transition-colors ${
              density === 0 ? "text-text-secondary cursor-not-allowed" : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
            }`}
            onClick={() => setDensity(Math.max(0, density - 1))}
            disabled={density === 0}
            title="更密集"
          >
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
              <path d="M3 9v2M6 6.5v4.5M9 4v7" strokeLinecap="round" />
            </svg>
          </button>
          <button
            className={`w-5 h-5 rounded flex items-center justify-center text-[10px] transition-colors ${
              density === 4 ? "text-text-secondary cursor-not-allowed" : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
            }`}
            onClick={() => setDensity(Math.min(4, density + 1))}
            disabled={density === 4}
            title="更松散"
          >
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
              <path d="M3 2v9M6 2v9M9 2v9" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <button
          className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:bg-surface-hover transition-colors"
          onClick={onCollapse}
          title="收起面板"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
            <path d="M11 4l-6 4 6 4" />
          </svg>
        </button>
      </div>

      {/* Timeline */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-text-secondary">暂无任务</p>
          </div>
        ) : (
          <div className={`relative px-3 py-2 flex flex-col ${DENSITY_GAPS[density]}`}>
            {/* Center timeline line */}
            <div className="absolute left-1/2 top-4 bottom-4 w-px bg-border" style={{ transform: "translateX(-0.5px)" }} />

            {tasks.map((task, idx) => {
              const isRight = idx % 2 === 0;
              const isExpanded = expandedId === task.id;
              const isRunning = task.status === "running";

              return (
                <div key={task.id} className="relative flex items-start" style={{ minHeight: 40 }}>
                  {/* Spacer for the other side */}
                  <div className="w-[calc(50%-10px)]" />

                  {/* Timeline dot — sits on the center line */}
                  <div className="absolute left-1/2 top-3 z-10" style={{ transform: "translate(-50%, -50%)" }}>
                    {/* Connector line from dot to card */}
                    <div
                      className={`absolute top-1/2 h-px w-[10px] ${isRight ? "left-full" : "right-full"}`}
                      style={{ background: "var(--color-border)" }}
                    />
                    {/* Dot */}
                    <span
                      className={`block w-2.5 h-2.5 rounded-full ring-2 ring-surface ${
                        task.status === "running" ? "bg-accent animate-pulse" :
                        task.status === "done" ? "bg-green-500" :
                        task.status === "failed" ? "bg-red-400" :
                        "bg-border"
                      }`}
                    />
                  </div>

                  {/* Task card */}
                  <div
                    className={`w-[calc(50%-10px)] ${isRight ? "" : "order-first"}`}
                  >
                    <button
                      className={`w-full text-left rounded-lg border transition-colors overflow-hidden ${
                        isRunning ? "border-accent/40 bg-accent/5" :
                        task.status === "failed" ? "border-red-400/30 bg-red-50" :
                        "border-border bg-surface-alt hover:bg-surface-hover"
                      }`}
                      onClick={() => setExpandedId(isExpanded ? null : task.id)}
                    >
                      <div className="px-2.5 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-medium text-text-primary truncate flex-1">{task.title}</span>
                          <span className={`text-[9px] shrink-0 ${
                            isRunning ? "text-accent" :
                            task.status === "failed" ? "text-red-400" :
                            task.status === "done" ? "text-green-500" :
                            "text-text-secondary"
                          }`}>
                            {STATUS_LABELS[task.status]}
                          </span>
                        </div>
                        {task.description && (
                          <div className="text-[10px] text-text-secondary truncate mt-0.5">{task.description}</div>
                        )}
                      </div>

                      {/* Expanded: output + actions */}
                      {isExpanded && (
                        <div className="border-t border-border/50">
                          {(task.status === "running" || task.output.length > 0) && (
                            <pre
                              ref={isRunning ? outputRef : undefined}
                              className="text-[10px] text-green-400 font-mono p-2 max-h-32 overflow-y-auto leading-relaxed whitespace-pre-wrap break-all bg-[#1a1a1e]"
                            >
                              {task.output.length === 0 && isRunning ? (
                                <span className="text-text-secondary animate-pulse">执行中...</span>
                              ) : (
                                task.output.join("\n")
                              )}
                            </pre>
                          )}
                          {task.status !== "running" && (
                            <div className="flex gap-1.5 px-2 py-1.5">
                              <button
                                className="flex-1 py-1 rounded text-[10px] font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                                onClick={(e) => { e.stopPropagation(); execute(task.id); }}
                              >
                                {task.status === "done" || task.status === "failed" ? "重新执行" : "执行"}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Active indicator */}
      {activeTask && (
        <div className="border-t border-border px-3 py-1.5 bg-surface-alt shrink-0">
          <div className="flex items-center gap-1.5 text-[10px] text-text-secondary">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />
            <span className="truncate">{activeTask.title}</span>
            <span className="text-accent">{STATUS_LABELS[activeTask.status]}</span>
          </div>
        </div>
      )}
    </div>
  );
}
