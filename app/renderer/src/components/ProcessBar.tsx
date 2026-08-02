import { useEffect, useState } from "react";
import { useDelegationStore, type RunningTaskInfo } from "../stores/delegation-store";

/**
 * 后台进程条:显示 agent·N(绿色) / shell·N(蓝色),点击 agent 展开任务列表,
 * 每个任务可单独停止(中止该子 Agent,通知同步主会话)
 */
export function ProcessBar(): JSX.Element | null {
  const agentTasks = useDelegationStore((s) => s.agentTasks);
  const shellCount = useDelegationStore((s) => s.shellCount);
  const [expanded, setExpanded] = useState(false);

  // 任务全部结束时收起浮层,避免下次展开时残留(hooks 须在条件 return 前)
  useEffect(() => {
    if (agentTasks.length === 0) setExpanded(false);
  }, [agentTasks.length]);

  // 无任何后台活动时不占位——否则空行会把状态栏顶离输入卡片
  if (agentTasks.length === 0 && shellCount === 0) return null;

  const stopTask = (task: RunningTaskInfo): void => {
    window.electronAPI.agent.stopDelegation(task.delegationId, task.index).catch(() => {});
  };

  return (
    <div className="relative" style={{ margin: "0 var(--s16)" }}>
      <div className="flex items-center gap-1 py-0.5 text-[11px]">
        {/* agent 计数:圆角胶囊,点击展开/收起任务列表 */}
        {agentTasks.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded-[8px] bg-success-soft px-2 py-0.5 font-semibold text-success cursor-pointer hover:bg-success-high"
            title="运行中的子 Agent"
          >
            Agent·{agentTasks.length}
          </button>
        )}
        {/* shell 计数(主会话工具执行中) */}
        {shellCount > 0 && (
          <span className="flex items-center gap-1 text-info" title="主会话工具执行中">
            <svg className="shrink-0" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="12" height="10" rx="1.5" />
              <path d="M4 7l3 2-3 2M9 11h3" />
            </svg>
            <span>shell·{shellCount}</span>
          </span>
        )}
      </div>

      {/* agent 任务列表浮层 */}
      {expanded && agentTasks.length > 0 && (
        <div className="absolute bottom-full left-0 mb-1 w-72 max-h-64 overflow-y-auto rounded-[8px] border border-border bg-surface-elevated shadow-xl z-50 text-xs">
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
                <span className="truncate flex-1 text-text-primary">{task.title}</span>
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
    </div>
  );
}
