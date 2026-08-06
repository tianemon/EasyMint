import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useStatusStore } from "../stores/status-store";
import { useTabStore } from "../stores/tab-store";

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
 * 常驻活跃动画已移至输入卡片流光环绕(input-card-glow);
 * 符号动画与状态文本同现同消:有状态信号(busy && text)时符号+文本一起出现,信号结束一起消失。
 */
export function StatusBar({ sessionId }: { sessionId: string }): JSX.Element | null {
  // 按会话读状态信号(多 tab 各自显示自己的状态,不穿透)
  const session = useStatusStore((s) => s.bySession[sessionId]);
  const text = session?.signals ? [...session.signals].sort((a, b) => b.seq - a.seq)[0]?.text ?? "" : "";
  const summarizing = useStatusStore((s) => s.bySession[sessionId]?.summarizing ?? false);
  const busy = useTabStore((s) => s.runningSessions.has(sessionId));

  // 符号动画只在有状态文本时运行(与文本同现同消)——text 空则不显示不运行
  const showSymbols = busy && !!text;
  const [symIdx, setSymIdx] = useState(0);
  const idxRef = useRef(0);
  const dirRef = useRef(1);
  useEffect(() => {
    if (!showSymbols) { setSymIdx(0); return; }
    idxRef.current = 0;
    dirRef.current = 1;
    setSymIdx(0);
    let timer: ReturnType<typeof setTimeout>;
    const tick = (): void => {
      const i = idxRef.current;
      const d = dirRef.current;
      const next = i + d;
      if (next > SYMBOLS.length - 1) {
        dirRef.current = -1;
        timer = setTimeout(tick, PAUSE_MS);
        return;
      }
      if (next < 0) {
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
  }, [showSymbols]);
  const symbol = SYMBOLS[symIdx];

  if (!showSymbols && !summarizing) return null;

  return (
    <>
      {showSymbols && (
        <div className="statusbar">
          {/* 符号(固定宽度,防挤压文本横跳)+ 状态文本,一同出现一同消失 */}
          <span className="w-[1.25em] inline-flex items-center justify-center text-xs font-bold shrink-0 select-none" style={shimmerStyle}>{symbol}</span>
          <span className="text-xs font-medium" style={shimmerStyle}>{text}</span>
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
