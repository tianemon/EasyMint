import { useEffect, useRef, useState } from "react";
import { useDelegationStore } from "../stores/delegation-store";
import { ShellProcessView } from "./ShellProcessView";

/**
 * Shell 胶囊:显示 Shell•N(后台运行中的命令数),点击展开命令列表,
 * 每个命令可点击查看输出(弹层)、单独停止;点击胶囊外部区域收起(与 AgentBar 同款交互)
 */
export function ShellBar({ sessionId }: { sessionId?: string }): JSX.Element | null {
  // 按发起会话过滤——后台命令是主会话发起的,其他会话 tab 不显示 shell 胶囊(跨会话污染)
  const shellTasks = useDelegationStore((s) => s.shellTasks.filter((t) => !t.sessionId || t.sessionId === sessionId));
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // 查看中的后台命令(弹层;命令结束后弹层保持,running 转 false)
  const [viewing, setViewing] = useState<{ id: string; command: string; logPath: string } | null>(null);

  // 全部结束时收起浮层
  useEffect(() => {
    if (shellTasks.length === 0) setExpanded(false);
  }, [shellTasks.length]);

  // 点击胶囊外部区域收起(点击穿透正常)
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [expanded]);

  if (shellTasks.length === 0) return null;

  const stopShell = (id: string): void => {
    window.electronAPI.agent.stopShell(id).catch(() => {});
  };
  const viewingRunning = viewing ? shellTasks.some((t) => t.id === viewing.id) : false;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="rounded-[8px] bg-info-soft px-2 py-0.5 text-[11px] font-bold text-info cursor-pointer hover:bg-info-high"
        title="运行中的后台命令"
      >
        Shell•{shellTasks.length}
      </button>

      {/* 命令列表浮层(向上展开,覆盖输入卡片上方) */}
      {expanded && (
        <div className="absolute bottom-full left-0 mb-1 w-80 max-h-64 overflow-y-auto rounded-[8px] border border-border bg-surface-elevated shadow-xl z-50 text-xs">
          <div className="px-3 py-1.5 border-b border-border bg-accent-bg text-text-secondary font-medium">
            运行中的后台命令({shellTasks.length})
          </div>
          <div className="divide-y divide-border/60">
            {shellTasks.map((task) => (
              <div key={task.id} className="flex items-center gap-2 px-3 py-2">
                <svg className="animate-spin text-accent shrink-0" width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                  <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <button
                  type="button"
                  onClick={() => { setViewing({ id: task.id, command: task.command, logPath: task.logPath }); setExpanded(false); }}
                  className="truncate flex-1 text-left font-mono text-text-primary hover:text-info transition-colors cursor-pointer"
                  title={`查看「${task.command}」输出`}
                >
                  {task.command}
                </button>
                {task.status === "stopping" ? (
                  // 已点停止:杀进程中,按钮禁用避免重复触发
                  <span className="shrink-0 px-2 py-0.5 rounded-[6px] text-text-secondary text-[11px]">停止中…</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => stopShell(task.id)}
                    className="shrink-0 px-2 py-0.5 rounded-[6px] border border-danger/40 text-danger hover:bg-danger-soft transition-colors"
                    title="停止该命令"
                  >
                    停止
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 后台命令输出查看弹层 */}
      {viewing && (
        <ShellProcessView
          id={viewing.id}
          command={viewing.command}
          logPath={viewing.logPath}
          running={viewingRunning}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
