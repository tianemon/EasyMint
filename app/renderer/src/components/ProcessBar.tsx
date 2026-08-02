import { useDelegationStore } from "../stores/delegation-store";

/**
 * 后台进程条(仅 shell):主会话工具执行中显示 shell·N(蓝色),
 * 无活动时不占位;Agent 列表已移至输入卡片(见 AgentBar)
 */
export function ProcessBar(): JSX.Element | null {
  const shellCount = useDelegationStore((s) => s.shellCount);

  if (shellCount === 0) return null;

  return (
    <div className="flex items-center gap-1 py-0.5 text-[11px]" style={{ margin: "0 var(--s16)" }}>
      <span className="flex items-center gap-1 text-info" title="主会话工具执行中">
        <svg className="shrink-0" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <path d="M4 7l3 2-3 2M9 11h3" />
        </svg>
        <span>shell·{shellCount}</span>
      </span>
    </div>
  );
}
