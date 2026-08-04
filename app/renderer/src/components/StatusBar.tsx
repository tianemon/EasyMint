import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useStatusStore } from "../stores/status-store";
import { useTabStore } from "../stores/tab-store";
import { useDelegationStore } from "../stores/delegation-store";

/** 过渡符号动画序列(顺序播放 → 端点停顿 → 倒序播放 → 端点停顿,循环) */
const SYMBOLS = ["·", "✢", "✻", "✳", "❋"];
/** 符号切换间隔(ms) */
const TICK_MS = 150;
/** 端点停顿(ms)——正程播完顿一下再反向 */
const PAUSE_MS = 500;

/** 流光渐变样式(符号与状态文本共用:渐变 + 文字裁切 + 扫描动画) */
const shimmerStyle: CSSProperties = {
  background: `linear-gradient(90deg, var(--shimmer-1), var(--shimmer-2), var(--shimmer-3), var(--shimmer-4), var(--shimmer-5), var(--shimmer-2), var(--shimmer-1))`,
  backgroundSize: "300% 100%",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  animation: "shimmerSweep 6s linear infinite",
};

/**
 * 独立的状态栏——从 status-store 读取，密集更新时只重渲染自己，不牵连 ChatPanel/消息列表。
 * busy 从 tab-store 读取（主会话的 runningSessions）。
 * 常驻过渡符号动画:回合进行 / 子 Agent 运行 / 后台 shell 运行任一活跃即显示;
 * 有状态文本时与文本并存(动画常驻,不绑定回合)。
 */
export function StatusBar({ sessionId }: { sessionId: string }): JSX.Element | null {
  const text = useStatusStore((s) => s.text);
  const summarizing = useStatusStore((s) => s.summarizing);
  const busy = useTabStore((s) => s.runningSessions.has(sessionId));
  const agentActive = useDelegationStore((s) => s.agentTasks.length > 0);
  const shellActive = useDelegationStore((s) => s.shellTasks.length > 0);

  // 动画活跃:回合进行 ∪ 子 Agent 运行 ∪ 后台 shell 运行(摘要走独立横幅)
  const showBar = busy || agentActive || shellActive;

  // 符号动画状态机:正程(·→✻)→ 端点停顿 → 回程(✻→·)→ 端点停顿 → 循环。
  // 用 ref 持有时序状态 + setTimeout 递归,避免闭包过期;停顿期间符号停留端点。
  const [symIdx, setSymIdx] = useState(0);
  const idxRef = useRef(0);
  const dirRef = useRef(1);
  useEffect(() => {
    if (!showBar) { setSymIdx(0); return; }
    idxRef.current = 0;
    dirRef.current = 1;
    setSymIdx(0);
    let timer: ReturnType<typeof setTimeout>;
    const tick = (): void => {
      const i = idxRef.current;
      const d = dirRef.current;
      const next = i + d;
      if (next > SYMBOLS.length - 1) {
        // 正程到头:方向反转,端点停顿
        dirRef.current = -1;
        timer = setTimeout(tick, PAUSE_MS);
        return;
      }
      if (next < 0) {
        // 回程到头:方向反转,端点停顿
        dirRef.current = 1;
        timer = setTimeout(tick, PAUSE_MS);
        return;
      }
      idxRef.current = next;
      setSymIdx(next);
      timer = setTimeout(tick, TICK_MS);
    };
    timer = setTimeout(tick, TICK_MS);
    return () => clearTimeout(timer);
  }, [showBar]);
  const symbol = SYMBOLS[symIdx];

  if (!showBar && !summarizing) return null;

  return (
    <>
      {showBar && (
        <div className="statusbar">
          {/* 常驻过渡动画(符号往返切换,流光覆盖)。固定宽度 + 居中:
              符号宽窄不一(☘ vs ✢),不固定会挤压右侧状态文本来回横跳 */}
          <span className="w-[1.25em] inline-flex items-center justify-center text-xs font-bold shrink-0 select-none" style={shimmerStyle}>{symbol}</span>
          {/* 有状态文本时并存显示(回合内信号:正在思考/执行工具等) */}
          {busy && text && (
            <span className="text-xs font-medium" style={shimmerStyle}>{text}</span>
          )}
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
