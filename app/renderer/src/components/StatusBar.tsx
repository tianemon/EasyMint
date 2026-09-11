import { useEffect, useMemo, type CSSProperties } from "react";
// useRef / useState 随旧符号动画一并停用，恢复旧动画时加回
import { useStatusStore } from "../stores/status-store";
import { useTabStore } from "../stores/tab-store";
import { useSettingsStore } from "../stores/settings-store";
import { useThemeStore } from "../stores/theme-store";
import { ModelGlyph } from "./ModelGlyph";

/** 旧的状态栏符号动画：字符序列顺序播放 → 端点停顿 → 倒序播放 → 停顿，循环。
 *  已由动态模型图标（ModelGlyph）替代，按要求保留代码备查——恢复旧动画时把下面注释解开。
 *  符号动画序列(顺序播放 → 端点停顿 → 倒序播放 → 端点停顿,循环) */
// const SYMBOLS = ["·", "✢", "✻", "✳", "❋"];
/** 符号切换间隔(ms) */
// const TICK_MS = 150;
/** 端点停顿(ms)——正程播完顿一下再反向 */
// const PAUSE_MS = 500;

/** 流光渐变样式:由 --shimmer-1..5 变量驱动(JS 按启用组色彩注入)。
 *  一圈 = 颜色数 × 4s;shimmerSweep 位移 600%(2 个渐变宽度)= 2 圈 → 总时长 = 颜色数 × 8s */
function buildShimmerStyle(durationSec: number): CSSProperties {
  return {
    background: `linear-gradient(90deg, var(--shimmer-1), var(--shimmer-2), var(--shimmer-3), var(--shimmer-4), var(--shimmer-5), var(--shimmer-2), var(--shimmer-1))`,
    backgroundSize: "300% 100%",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    animation: `shimmerSweep ${durationSec}s linear infinite`,
  };
}

/**
 * 独立的状态栏——从 status-store 读取，密集更新时只重渲染自己，不牵连 ChatPanel/消息列表。
 * busy 从 tab-store 读取（主会话的 runningSessions）。
 * 常驻活跃动画已移至输入卡片流光(OrbitGlow/SlideGlow/BreatheGlow canvas 组件);
 * 符号动画与状态文本同现同消:有状态信号(busy && text)时符号+文本一起出现,信号结束一起消失。
 */
export function StatusBar({ sessionId }: { sessionId: string }): JSX.Element | null {
  // 按会话读状态信号(多 tab 各自显示自己的状态,不穿透)
  const session = useStatusStore((s) => s.bySession[sessionId]);
  const text = session?.signals ? [...session.signals].sort((a, b) => b.seq - a.seq)[0]?.text ?? "" : "";
  const summarizing = useStatusStore((s) => s.bySession[sessionId]?.summarizing ?? false);
  const busy = useTabStore((s) => s.runningSessions.has(sessionId));
  // 状态文本样式配置:单色(solid,独立颜色)/流光(shimmer,启用组色彩注入 --shimmer-1..5)
  const statusTextStyle = useSettingsStore((s) => s.statusTextStyle);
  const statusTextGroupsLight = useSettingsStore((s) => s.statusTextGroupsLight);
  const statusTextGroupsDark = useSettingsStore((s) => s.statusTextGroupsDark);
  const activeStatusGroupLight = useSettingsStore((s) => s.activeStatusGroupLight);
  const activeStatusGroupDark = useSettingsStore((s) => s.activeStatusGroupDark);
  const statusColorLight = useSettingsStore((s) => s.statusColorLight);
  const statusColorDark = useSettingsStore((s) => s.statusColorDark);
  const isDark = useThemeStore((s) => s.effective) === "dark";
  const statusColor = isDark ? statusColorDark : statusColorLight;
  // 按主题取启用组的流光色彩(不足 5 个循环填充)
  const shimmerColors = useMemo(() => {
    if (statusTextStyle !== "shimmer") return [];
    const groups = isDark ? statusTextGroupsDark : statusTextGroupsLight;
    const activeId = isDark ? activeStatusGroupDark : activeStatusGroupLight;
    const active = groups.find((g) => g.id === activeId) ?? groups[0];
    return active?.colors && active.colors.length > 0 ? active.colors : [];
  }, [statusTextStyle, isDark, statusTextGroupsLight, statusTextGroupsDark, activeStatusGroupLight, activeStatusGroupDark]);
  // 流光色彩注入:启用组循环填充 5 个 shimmer 变量(不足 5 个重复首色)
  useEffect(() => {
    if (statusTextStyle !== "shimmer") return;
    const colors = shimmerColors.length > 0 ? shimmerColors : [statusColor];
    const root = document.documentElement;
    for (let i = 0; i < 5; i++) {
      root.style.setProperty(`--shimmer-${i + 1}`, colors[i % colors.length]!);
    }
  }, [statusTextStyle, shimmerColors, statusColor]);

  // 状态图标与状态文本同现同消:有状态信号(busy && text)时一起出现,信号结束一起消失
  // （变量名沿用 showSymbols:该位置原本放字符符号动画，现由 ModelGlyph 占这个位置）
  const showSymbols = busy && !!text;
  /* 旧字符符号动画的帧推进（已停用，保留备查——恢复时同时把上方常量与 react import 解开）
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
  */

  if (!showSymbols && !summarizing) return null;

  // 流光时长:一圈 = 颜色数 × 4s(shimmerSweep 位移 600% = 2 圈,总时长 = 颜色数 × 8s)
  // 速度档位:每周期 4s 由用户确认(原 3s 偏快);想再慢把系数 8 改大(每周期 = 系数/2 s)
  const shimmerDuration = statusTextStyle === "shimmer"
    ? Math.max(1, (shimmerColors.length > 0 ? shimmerColors.length : 1)) * 8
    : 8;
  const shimmerStyle = buildShimmerStyle(shimmerDuration);

  // 文本样式:solid 单色(statusColor,独立配置)/shimmer 流光(shimmerStyle 变量驱动)
  const textStyle: CSSProperties = statusTextStyle === "solid"
    ? { color: statusColor }
    : shimmerStyle;

  // 图标颜色循环时长：用户反馈比文字流光慢，缩 1/3（= 原值 × 2/3）。
  // 参考：文字流光一轮（shimmerSweep 一轮）实际是 shimmerDuration 的一半，要完全同步就改成分母 2。
  const glyphShimmerDuration = (shimmerDuration * 2) / 3;

  return (
    <>
      {showSymbols && (
        <div className="statusbar">
          {/* 状态图标（动态模型图标,固定宽度防挤压文本横跳）+ 状态文本,一同出现一同消失。
              图标只在流光模式下变色：颜色循环靠类 .status-glyph-shimmer，内联 style 只传时长变量。
              不要在这里铺 textStyle——流光模式的 shimmerStyle 自带 animation（文字扫光），
              内联 animation 会盖掉类的 color 循环，图标就永远不变色（且该 span 里没有文字，渐变本来也用不上）。
              原字符符号动画保留为注释（见文件顶部常量与下方 effect） */}
          <span
            className={`w-[1.25em] inline-flex items-center justify-center shrink-0${statusTextStyle === "shimmer" ? " status-glyph-shimmer" : ""}`}
            style={statusTextStyle === "shimmer" ? ({ "--glyph-shimmer-dur": `${glyphShimmerDuration}s` } as CSSProperties) : { color: statusColor }}
          >
            <ModelGlyph animated />
          </span>
          <span className="text-xs font-medium" style={textStyle}>{text}</span>
        </div>
      )}
      {summarizing && (
        <div className="flex items-center gap-2 px-4 py-2 text-text-primary text-sm bg-accent-bg shrink-0">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-accent animate-spin"><circle cx="8" cy="8" r="6" strokeOpacity="0.3"/><path d="M8 2a6 6 0 015.5 3.5" strokeLinecap="round"/></svg>
          <span>正在进行会话摘要，将在新会话继续。</span>
        </div>
      )}
    </>
  );
}
