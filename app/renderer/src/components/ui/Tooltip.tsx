import { memo, useRef, useState, type ReactNode } from "react";

/**
 * 低延迟悬浮提示（替代原生 title——OS 延迟约 1s 不可调，本组件 hover 即显）。
 * drop-in：<Tooltip tip="说明"><按钮/></Tooltip>（原 title 移除，避免双浮层）。
 * 默认 200ms 显示 / 200ms 消失。样式全内联（背景/字号/行高不依赖类名与继承，
 * 避免被容器类覆盖或变量失效）；宽度 max-content 脱离包含块钳制 + 水平居中。
 * 注意：wrapper 为 inline-flex——外包时原元素的 flex 布局类（shrink-0 等）需移到 className。
 */
interface TooltipProps {
  tip: string;
  children: ReactNode;
  /** 浮层方向（相对被包元素） */
  side?: "top" | "bottom";
  /** 显示延迟 ms（默认 200——原生 title 的 ~1s 感知对比） */
  delay?: number;
  /** 消失延迟 ms（默认 200） */
  hideDelay?: number;
  /** wrapper 附加类（外包后原元素的 flex 布局类如 shrink-0 需移到这里） */
  className?: string;
}

export const Tooltip = memo(function Tooltip({ tip, children, side = "top", delay = 200, hideDelay = 200, className }: TooltipProps): JSX.Element {
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
    hideTimer.current = setTimeout(() => setVisible(false), hideDelay);
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
          style={{
            position: "absolute",
            ...(side === "top" ? { bottom: "100%", marginBottom: 6 } : { top: "100%", marginTop: 6 }),
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 130,
            // width:max-content 让浮层脱离包含块（被包元素自身）的宽度钳制——
            // 否则 absolute 宽 = min(内容, 包含块宽)，窄按钮的 tooltip 永远只有按钮宽
            width: "max-content",
            maxWidth: 300,
            padding: "4px 8px",
            borderRadius: 6,
            fontSize: 11,
            lineHeight: 1.5,
            whiteSpace: "normal",
            overflowWrap: "break-word",
            boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
            background: "var(--color-tooltip-bg)",
            color: "var(--color-tooltip-text)",
            pointerEvents: "none",
          }}
        >
          {tip}
        </span>
      )}
    </span>
  );
});
