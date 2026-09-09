import { useGlowCanvas } from "./useGlowCanvas";

/** breathe 呼吸灯：绘制实现见 glow-draw.ts（Worker 路径与主线程回退路径共用同一份） */
interface BreatheGlowProps {
  /** 当前主题的颜色组合(多色取首色) */
  colors: string[];
}

export function BreatheGlow({ colors }: BreatheGlowProps): JSX.Element {
  const { canvasRef, outset } = useGlowCanvas("breathe", colors);
  return (
    <canvas
      ref={canvasRef}
      className="glow-canvas"
      style={{ "--glow-outset": `${outset}px` } as React.CSSProperties}
      aria-hidden="true"
    />
  );
}
