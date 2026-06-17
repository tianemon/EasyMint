import { useStatusStore } from "../stores/status-store";
import { useTabStore } from "../stores/tab-store";

/**
 * 独立的状态栏——从 status-store 读取，密集更新时只重渲染自己，不牵连 ChatPanel/消息列表。
 * busy 从 tab-store 读取（主会话的 runningSessions）。
 */
export function StatusBar({ sessionId }: { sessionId: string }): JSX.Element | null {
  const text = useStatusStore((s) => s.text);
  const summarizing = useStatusStore((s) => s.summarizing);
  const busy = useTabStore((s) => s.runningSessions.has(sessionId));

  if (!busy && !summarizing) return null;

  return (
    <>
      {busy && text && (
        <div className="flex items-center px-4 py-1.5 bg-surface-alt/50 shrink-0">
          <span className="text-xs font-medium" style={{
            background: `linear-gradient(90deg, var(--shimmer-1), var(--shimmer-2), var(--shimmer-3), var(--shimmer-4), var(--shimmer-5), var(--shimmer-2), var(--shimmer-1))`,
            backgroundSize: "300% 100%",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            animation: "shimmerSweep 6s linear infinite",
          }}>{text}</span>
        </div>
      )}
      {summarizing && (
        <div className="flex items-center gap-2 px-4 py-2 text-text-primary text-sm bg-accent-bg border-b border-accent-border-light shrink-0">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-accent animate-spin"><circle cx="8" cy="8" r="6" strokeOpacity="0.3"/><path d="M8 2a6 6 0 015.5 3.5" strokeLinecap="round"/></svg>
          <span>正在进行会话摘要，将在新会话继续。</span>
        </div>
      )}
    </>
  );
}
