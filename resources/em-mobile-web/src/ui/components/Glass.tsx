import type { CSSProperties, ReactNode } from 'react';

/** CSS.supports 不支持 backdrop-filter 时降级成半透明纯色，不残留失效材质。 */
export const supportsBackdrop = typeof CSS !== 'undefined'
  && typeof CSS.supports === 'function'
  && (CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'));

export function Glass({ variant = 'frosted', className = '', style, children }: {
  variant?: 'frosted' | 'liquid';
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}): React.ReactElement {
  // liquid 只用在输入卡一处（全站唯一 backdrop-filter 使用点）。
  return (
    <div
      className={`glass glass-${variant}${supportsBackdrop ? '' : ' glass-fallback'} ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}
