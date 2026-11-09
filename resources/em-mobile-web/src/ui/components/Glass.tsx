import { useLayoutEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { renderContour } from '../../../../../app/shared/visual-design/liquid-dom-optics.mjs';


type GlassProps = {
  variant?: 'frosted';
  contour?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  /** 圆角由调用方显式给（App Glass 语义）：8/13/16/20/24/27/29 */
  radius?: number;
  /** 是否做背景模糊。默认开启，确保磨砂控件实际采样背后内容 */
  blur?: boolean;
  /** 模糊强度（App 的 expo-blur intensity 口径）；给了就按比例换算成 CSS blur px */
  intensity?: number;
  /** 是否抬升（阴影）。默认关 */
  elevated?: boolean;
  /** 边框做法。none = 不画光学边框 / 高光（整条标题栏磨砂用） */
  rim?: 'gradient' | 'none';
};

export function Glass({
  variant = 'frosted', contour = false, className = '', style, children, radius = 8, blur = true, intensity, elevated = false, rim = 'gradient',
}: GlassProps): React.ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const contourRef = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const root = rootRef.current, canvas = contourRef.current;
    if (!contour || !root || !canvas) return;
    const draw = (): void => {
      const box = root.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) renderContour(canvas, box.width, box.height, Math.min(radius, box.width / 2, box.height / 2));
    };
    draw();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(draw);
    observer?.observe(root);
    window.addEventListener('resize', draw);
    return () => { observer?.disconnect(); window.removeEventListener('resize', draw); };
  }, [contour, radius]);
  const vars = { '--glass-radius': `${radius}px` } as CSSProperties;
  if (intensity !== undefined) (vars as Record<string, string>)['--glass-blur'] = `${Math.max(2, Math.round(intensity * 0.43))}px`;
  const tuned = blur && intensity !== undefined;

  return (
    <div
      ref={rootRef}
      className={`glass glass-${variant}${blur ? ' is-blur' : ''}${tuned ? ' is-blur-tuned' : ''}${elevated ? ' is-elevated' : ''}${rim === 'none' ? ' rim-none' : ''}${contour ? ' has-fine-contour' : ''} ${className}`}
      style={{ ...vars, ...style }}
    >
      {contour && <canvas ref={contourRef} className="glass-fine-contour" aria-hidden="true" />}
      {children}
    </div>
  );
}
