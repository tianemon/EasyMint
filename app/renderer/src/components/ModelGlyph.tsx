/**
 * 模型图标（三点互联 + 连线）——输入卡片的模型标签与状态栏的状态图标共用。
 * stroke 用 currentColor，颜色跟随外层文字色（状态栏的 solid 配色直接生效）。
 * animated=true 才加动效类（三点聚拢再散开，见 index.css 的 .model-glyph-*）——只有状态栏需要；
 * 输入卡片的模型标签保持静态，避免与状态栏同时动。
 * 传 label 时作为有语义的图标（role=img）；不传则视为装饰（aria-hidden），由旁边的文字承载语义。
 */
export function ModelGlyph({
  size = 14,
  className,
  style,
  label,
  animated = false,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  label?: string;
  animated?: boolean;
}): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {label && <title>{label}</title>}
      <circle className={animated ? "model-glyph-node-a" : undefined} cx="5" cy="12" r="2.6" fill="currentColor" />
      <circle className={animated ? "model-glyph-node-b" : undefined} cx="19" cy="5.5" r="2.6" />
      <circle className={animated ? "model-glyph-node-c" : undefined} cx="19" cy="18.5" r="2.6" />
      <path className={animated ? "model-glyph-edge" : undefined} d="M7.4 10.9 16.6 6.6" />
      <path className={animated ? "model-glyph-edge" : undefined} d="M7.4 13.1 16.6 17.4" />
      <path className={animated ? "model-glyph-edge" : undefined} d="M19 8.1v7.8" />
    </svg>
  );
}
