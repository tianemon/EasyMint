import { useEffect, useRef } from 'react';
import { registerLiquidGlass } from '../glass-dom-mirror';
import type { CSSProperties, ReactNode } from 'react';


/** CSS.supports 不支持 backdrop-filter 时降级成半透明纯色，不残留失效材质。 */
export const supportsBackdrop = typeof CSS !== 'undefined'
  && typeof CSS.supports === 'function'
  && (CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'));

type GlassProps = {
  variant?: 'frosted' | 'liquid';
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
  variant = 'frosted', className = '', style, children, radius = 8, blur = true, intensity, elevated = false, rim = 'gradient',
}: GlassProps): React.ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const liquid = variant === 'liquid';
  useEffect(() => {
    if (!liquid || !rootRef.current) return;
    return registerLiquidGlass(rootRef.current);
  }, [liquid, blur]);

  const vars = { '--glass-radius': `${radius}px` } as CSSProperties;
  if (intensity !== undefined) (vars as Record<string, string>)['--glass-blur'] = `${Math.max(2, Math.round(intensity * 0.43))}px`;
  const tuned = blur && intensity !== undefined;

  return (
    <div
      ref={rootRef}
      data-liquid-glass={liquid ? "" : undefined}
      data-liquid-blur={liquid ? (blur ? 2.5 : 0.2) : undefined}
      className={`glass glass-${variant}${blur ? ' is-blur' : ''}${tuned ? ' is-blur-tuned' : ''}${elevated ? ' is-elevated' : ''}${rim === 'none' ? ' rim-none' : ''}${supportsBackdrop ? '' : ' glass-fallback'} ${className}`}
      style={{ ...vars, ...style }}
    >
      {liquid ? <div className="glass-content">{children}</div> : children}
    </div>
  );
}
