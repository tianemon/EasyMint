import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { applyLens, ensureLensDefs, supportsLens } from '../glass-lens';

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
  /** 是否做背景模糊。默认关：容器背景是平滑环境色，模糊没有收益 */
  blur?: boolean;
  /** 模糊强度（App 的 expo-blur intensity 口径）；给了就按比例换算成 CSS blur px */
  intensity?: number;
  /** 是否抬升（阴影）。默认关 */
  elevated?: boolean;
  /** 边框做法。none = 不画光学边框 / 高光（整条标题栏磨砂用） */
  rim?: 'gradient' | 'none';
};

export function Glass({
  variant = 'frosted', className = '', style, children, radius = 8, blur = false, intensity, elevated = false, rim = 'gradient',
}: GlassProps): React.ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const liquid = variant === 'liquid';
  // 液态折射只在能力齐备时挂载；降级路径仍是原来的整块磨砂玻璃。
  const lensActive = liquid && supportsBackdrop && supportsLens();

  useEffect(() => {
    if (!lensActive) return;
    ensureLensDefs();
    // 传根节点：applyLens 会给其中四条 [data-lens-band] 边缘带各设一次 CSSOM backdrop-filter。
    applyLens(rootRef.current);
  }, [lensActive]);

  const vars = { '--glass-radius': `${radius}px` } as CSSProperties;
  if (intensity !== undefined) (vars as Record<string, string>)['--glass-blur'] = `${Math.max(2, Math.round(intensity * 0.43))}px`;
  const tuned = blur && intensity !== undefined;

  return (
    <div
      ref={rootRef}
      className={`glass glass-${variant}${blur ? ' is-blur' : ''}${tuned ? ' is-blur-tuned' : ''}${elevated ? ' is-elevated' : ''}${rim === 'none' ? ' rim-none' : ''}${supportsBackdrop ? '' : ' glass-fallback'}${lensActive ? ' has-lens' : ''} ${className}`}
      style={{ ...vars, ...style }}
    >
      {lensActive && (
        <>
          {/* 中心磨砂层：承接原有 blur(18px)，中心稳定、不承担折射 */}
          <div className="glass-frost" aria-hidden="true" />
          {/* 四条 16px 边缘带：各自 CSSOM 设置 backdrop-filter，采样原始背景做折射。
              父层 .glass 的 overflow:hidden + 圆角负责裁剪。 */}
          <div className="glass-lens glass-lens-t" data-lens-band="" aria-hidden="true" />
          <div className="glass-lens glass-lens-b" data-lens-band="" aria-hidden="true" />
          <div className="glass-lens glass-lens-l" data-lens-band="" aria-hidden="true" />
          <div className="glass-lens glass-lens-r" data-lens-band="" aria-hidden="true" />
        </>
      )}
      {liquid ? <div className="glass-content">{children}</div> : children}
    </div>
  );
}
