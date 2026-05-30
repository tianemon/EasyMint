import { useState, useRef, useEffect, useCallback } from "react";
import { useTaskStore } from "../stores/task-store";

interface TaskPanelProps {
  projectPath: string;
  onCollapse: () => void;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "待执行", color: "text-text-secondary" },
  running: { label: "运行中", color: "text-accent" },
  done: { label: "已完成", color: "text-green-500" },
  failed: { label: "失败", color: "text-red-400" },
};

export function TaskPanel({ projectPath, onCollapse }: TaskPanelProps): JSX.Element {
  const { tasks, updateTask, appendOutput } = useTaskStore();
  const [executing, setExecuting] = useState<string | null>(null);
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
    updateTask(taskId, { status: "running", output: [] });

    const unsubOut = window.electronAPI.shell.onStdout(({ line }) => {
      appendOutput(taskId, line);
    });
    const unsubErr = window.electronAPI.shell.onStderr(({ line }) => {
      appendOutput(taskId, `[stderr] ${line}`);
    });

    try {
      const result = await window.electronAPI.shell.exec(projectPath, task.command);
      updateTask(taskId, {
        status: result.code === 0 ? "done" : "failed",
      });
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
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <span className="text-xs font-medium text-text-primary">任务</span>
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

      {/* Task list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-text-secondary">暂无任务</p>
          </div>
        ) : (
          <div className="p-2 space-y-1.5">
            {tasks.map((task) => {
              const st = STATUS_LABELS[task.status] ?? STATUS_LABELS.pending!;
              const isActive = executing === task.id;
              return (
                <div key={task.id} className="rounded-lg border border-border bg-surface-alt overflow-hidden">
                  {/* Task header */}
                  <div className="flex items-center gap-2 px-3 py-2">
                    {/* Status dot */}
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        task.status === "running" ? "bg-accent animate-pulse" :
                        task.status === "done" ? "bg-green-500" :
                        task.status === "failed" ? "bg-red-400" :
                        "bg-border"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-text-primary truncate">{task.title}</div>
                      {task.description && (
                        <div className="text-[10px] text-text-secondary truncate mt-0.5">{task.description}</div>
                      )}
                    </div>
                    <span className={`text-[10px] shrink-0 ${st.color}`}>{st.label}</span>
                    {task.status !== "running" && (
                      <button
                        className={`ml-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                          isActive
                            ? "bg-accent/20 text-accent"
                            : "bg-accent/10 text-accent hover:bg-accent/20"
                        }`}
                        onClick={() => execute(task.id)}
                        disabled={isActive}
                      >
                        {task.status === "done" ? "重试" : task.status === "failed" ? "重试" : "执行"}
                      </button>
                    )}
                  </div>

                  {/* Output (only for active/completed task) */}
                  {(task.status === "running" || task.output.length > 0) && (
                    <div className="border-t border-border/50 bg-[#1a1a1e] rounded-b-lg">
                      <pre
                        ref={executing === task.id ? outputRef : undefined}
                        className="text-[10px] text-green-400 font-mono p-2 max-h-40 overflow-y-auto leading-relaxed whitespace-pre-wrap break-all"
                      >
                        {task.output.length === 0 && task.status === "running" ? (
                          <span className="text-text-secondary animate-pulse">执行中...</span>
                        ) : (
                          task.output.join("\n")
                        )}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Active task indicator for status bar */}
      {activeTask && (
        <div className="border-t border-border px-3 py-1.5 bg-surface-alt shrink-0">
          <div className="flex items-center gap-1.5 text-[10px] text-text-secondary">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />
            <span className="truncate">{activeTask.title}</span>
            <span className="text-accent">{STATUS_LABELS[activeTask.status]?.label}</span>
          </div>
        </div>
      )}
    </div>
  );
}
