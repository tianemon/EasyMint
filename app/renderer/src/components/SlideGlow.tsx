import { useGlowCanvas } from "./useGlowCanvas";

/** slide 顶部滑动：绘制实现见 glow-draw.ts（Worker 路径与主线程回退路径共用同一份） */
interface SlideGlowProps {
  /** 当前主题的颜色组合(1-5 色) */
  colors: string[];
}

export function SlideGlow({ colors }: SlideGlowProps): JSX.Element {
  const { canvasRef, outset } = useGlowCanvas("slide", colors);
  return (
    <canvas
      ref={canvasRef}
      className="glow-canvas"
      style={{ "--glow-outset": `${outset}px` } as React.CSSProperties}
      aria-hidden="true"
    />
  );
}
