import { useDelegationStore } from "../stores/delegation-store";

/**
 * shell 胶囊:主会话工具执行中显示 shell·N(蓝色),无活动时不占位
 * (与 AgentBar 同款胶囊样式,由父容器按出现顺序排列)
 */
export function ShellBar(): JSX.Element | null {
  const shellCount = useDelegationStore((s) => s.shellCount);

  if (shellCount === 0) return null;

  return (
    <span
      className="rounded-[8px] bg-info-soft px-2 py-0.5 text-[11px] font-semibold text-info"
      title="主会话工具执行中"
    >
      shell·{shellCount}
    </span>
  );
}
