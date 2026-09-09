import { useGlowCanvas } from "./useGlowCanvas";

/** orbit 环绕流光：绘制实现见 glow-draw.ts（Worker 路径与主线程回退路径共用同一份） */
interface OrbitGlowProps {
  /** 当前主题的颜色组合(1-5 色) */
  colors: string[];
}

export function OrbitGlow({ colors }: OrbitGlowProps): JSX.Element {
  const { canvasRef, outset } = useGlowCanvas("orbit", colors);
  return (
    <canvas
      ref={canvasRef}
      className="glow-canvas"
      style={{ "--glow-outset": `${outset}px` } as React.CSSProperties}
      aria-hidden="true"
    />
  );
}
