import { useEffect, useRef, useState } from "react";
import { useDelegationStore, type RunningTaskInfo } from "../stores/delegation-store";
import { SubagentProcessView } from "./SubagentProcessView";

/**
 * Agent 胶囊:显示 Agent·N(输入卡片会话统计右侧),点击展开运行中的子 Agent 任务列表,
 * 每个任务可点击查看执行过程(弹层)、单独停止;点击胶囊外部区域收起菜单(document 级 mousedown 判断)
 */
export function AgentBar(): JSX.Element | null {
  const agentTasks = useDelegationStore((s) => s.agentTasks);
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // 查看中的子 Agent(弹层;任务从列表移除后弹层保持打开,running 转 false)
  const [viewing, setViewing] = useState<{ delegationId: string; index: number; title: string } | null>(null);

  // 任务全部结束时收起浮层,避免下次展开时残留
  useEffect(() => {
    if (agentTasks.length === 0) setExpanded(false);
  }, [agentTasks.length]);

  // 点击胶囊外部区域收起菜单(点击穿透正常,不拦截其它按钮)
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

  // 仅在存在运行中的子 Agent 时显示
  if (agentTasks.length === 0) return null;

  const stopTask = (task: RunningTaskInfo): void => {
    window.electronAPI.agent.stopDelegation(task.delegationId, task.index).catch(() => {});
  };
  const viewingRunning = viewing
    ? agentTasks.some((t) => t.delegationId === viewing.delegationId && t.index === viewing.index)
    : false;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="rounded-[8px] bg-success-soft px-2 py-0.5 text-[11px] font-bold text-success cursor-pointer hover:bg-success-high"
        title="运行中的子 Agent"
      >
        Agent·{agentTasks.length}
      </button>

      {/* 任务列表浮层(向上展开,覆盖输入卡片上方;最多显示 5 行,超出滚动) */}
      {expanded && (
        <div className="absolute bottom-full left-0 mb-1 w-72 max-h-[210px] overflow-y-auto rounded-[8px] border border-border bg-surface-elevated shadow-xl z-50 text-xs">
          <div className="px-3 py-1.5 border-b border-border bg-accent-bg text-text-secondary font-medium">
            运行中的子 Agent({agentTasks.length})
          </div>
          <div className="divide-y divide-border/60">
            {agentTasks.map((task) => (
              <div key={`${task.delegationId}-${task.index}`} className="flex items-center gap-2 px-3 py-2">
                <svg className="animate-spin text-accent shrink-0" width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                  <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <button
                  type="button"
                  onClick={() => { setViewing({ delegationId: task.delegationId, index: task.index, title: task.title }); setExpanded(false); }}
                  className="truncate flex-1 text-left text-text-primary hover:text-accent transition-colors cursor-pointer"
                  title={`查看「${task.title}」执行过程`}
                >
                  {task.title}
                </button>
                <button
                  type="button"
                  onClick={() => stopTask(task)}
                  className="shrink-0 px-2 py-0.5 rounded-[6px] border border-danger/40 text-danger hover:bg-danger-soft transition-colors"
                  title="停止该子 Agent"
                >
                  停止
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 子 Agent 过程查看弹层 */}
      {viewing && (
        <SubagentProcessView
          delegationId={viewing.delegationId}
          index={viewing.index}
          title={viewing.title}
          running={viewingRunning}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
