import { memo, useRef, useState, type ReactNode } from "react";

/**
 * 低延迟悬浮提示（替代原生 title——OS 延迟约 1s 不可调，本组件 hover 即显）。
 * drop-in：<Tooltip tip="说明"><按钮/></Tooltip>（原 title 移除，避免双浮层）。
 * 默认 200ms 显示 / 200ms 消失；浮层淡入淡出（opacity 过渡 180ms，非硬出现）。
 * 样式全内联（背景/字号/行高不依赖类名与继承，避免被容器类覆盖或变量失效）；
 * 宽度 max-content 脱离包含块钳制 + 水平居中。
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
  // 双状态实现淡入淡出：rendered 控制挂载（卸载前的淡出窗口），shown 驱动 opacity
  const [rendered, setRendered] = useState(false);
  const [shown, setShown] = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enter = () => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    if (showTimer.current) return; // 已排队显示中
    showTimer.current = setTimeout(() => {
      setRendered(true);
      // 挂载后下一帧再置可见——让 opacity 从 0 过渡（同帧设置两态会直接到终值）
      requestAnimationFrame(() => setShown(true));
      showTimer.current = null;
    }, delay);
  };
  const leave = () => {
    if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = null; }
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setShown(false);
      // 淡出动画结束后卸载（过渡 180ms + 余量）
      setTimeout(() => setRendered(false), 220);
    }, hideDelay);
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
      {rendered && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            ...(side === "top" ? { bottom: "100%", marginBottom: 6 } : { top: "100%", marginTop: 6 }),
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: "var(--z-index-dropdown)",
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
            opacity: shown ? 1 : 0,
            transition: "opacity 180ms ease",
          }}
        >
          {tip}
        </span>
      )}
    </span>
  );
});
