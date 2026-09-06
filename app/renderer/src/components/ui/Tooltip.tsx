import { memo, useRef, useState, type ReactNode } from "react";

/**
 * 低延迟悬浮提示（替代原生 title——OS 延迟约 1s 不可调，本组件 hover 即显）。
 * drop-in：<Tooltip tip="说明"><按钮/></Tooltip>（原 title 移除，避免双浮层）。
 * 默认 120ms 显示 / 150ms 消失；长文本自动换行（max-w 钳制）。
 * 注意：wrapper 为 inline-flex——外包时原 flex 布局类（shrink-0 等）需移到 wrapper 或确认无影响。
 */
interface TooltipProps {
  tip: string;
  children: ReactNode;
  /** 浮层方向（相对被包元素） */
  side?: "top" | "bottom";
  /** 显示延迟 ms（默认 120——原生 title 的 ~1s 感知对比） */
  delay?: number;
  /** wrapper 附加类（外包后原元素的 flex 布局类如 shrink-0 需移到这里） */
  className?: string;
}

export const Tooltip = memo(function Tooltip({ tip, children, side = "top", delay = 120, className }: TooltipProps): JSX.Element {
  const [visible, setVisible] = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enter = () => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    if (showTimer.current) return; // 已排队显示中
    showTimer.current = setTimeout(() => {
      setVisible(true);
      showTimer.current = null;
    }, delay);
  };
  const leave = () => {
    if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = null; }
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), 150);
  };

  return (
    <span
      className={`relative inline-flex ${className ?? ""}`}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute left-1/2 -translate-x-1/2 z-[130] max-w-[280px] whitespace-normal break-words px-2 py-1 rounded-md text-xs leading-snug shadow-lg ${side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}
          style={{ background: "var(--color-tooltip-bg)", color: "var(--color-tooltip-text)" }}
        >
          {tip}
        </span>
      )}
    </span>
  );
});
