import type { CSSProperties } from 'react';

/** 单色线性图标集：与手机 App components/icons.tsx 的图形语义一致，全部走 currentColor。 */
const PATHS: Record<string, string> = {
  back: 'M15 18l-6-6 6-6',
  chevron: 'M9 18l6-6-6-6',
  chevronDown: 'M6 9l6 6 6-6',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.35a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.54 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.54a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.1 4.65a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.46 9v.09A1.7 1.7 0 0 0 21 10.12h.09a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1.03z',
  clip: 'M21.4 11.6l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.9 1.9 0 0 1-2.7-2.7l7.8-7.8',
  send: 'M5 12h13M13 6l6 6-6 6',
  stop: 'M7 7h10v10H7z',
  plus: 'M12 5v14M5 12h14',
  plusChat: 'M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 20l1.8-4.6A7.5 7.5 0 1 1 20 11.5zM12 9v5M9.5 11.5h5',
  shield: 'M12 3l7 3v6c0 4.4-3 8-7 9-4-1-7-4.6-7-9V6l7-3z',
  think: 'M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.2.9 1.9V17h5.2v-1.2c0-.7.3-1.4.9-1.9A6 6 0 0 0 12 3zM9.5 20h5',
  model: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  archive: 'M4 7h16v3H4zM5 10v9h14v-9M10 14h4',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 13l4 4L19 7',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  tool: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.1-2.1 2.6-2.4z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  file: 'M6 3h8l4 4v14H6zM14 3v5h4',
  bash: 'M5 5h14v14H5zM8 10l2 2-2 2M12 15h4',
  edit: 'M4 20h4L20 8l-4-4L4 16v4zM14 6l4 4',
  write: 'M12 5v14M5 12h14',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M9 9h.01',
  doc: 'M7 3h7l4 4v14H7zM14 3v5h4M10 13h6M10 17h6',
  bot: 'M8 8h8v9H8zM12 4v4M9 20h6M5 12h3M16 12h3M10 12h.01M14 12h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0',
  link: 'M10 13a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7L11 6.3M14 11a4 4 0 0 0-5.7 0L6 13.3A4 4 0 0 0 11.7 19l1.3-1.3',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  system: 'M4 5h16v11H4zM9 20h6M12 16v4',
  refresh: 'M20 11a8 8 0 1 0-2 6M20 5v6h-6',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  pin: 'M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 14v7',
  folder: 'M3 7h6l2 2h10v10H3z',
  play: 'M8 5l11 7-11 7z',
  alert: 'M12 4l9 16H3L12 4zM12 10v4M12 17h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
};

/** 图标尺寸五档，取值与 App components/icons.tsx 的 iconSize 一致。 */
export const iconSize = {
  /** 10：工具卡成功 / 失败状态符 */
  status: 10,
  /** 11：后台浮层行的转圈 */
  pill: 11,
  /** 12：系统卡 kind 图标、工具执行中转圈 */
  card: 12,
  /** 13：工具图标、思考块标识 */
  tool: 13,
  /** 14：列表行与导航箭头 */
  nav: 14,
} as const;

export function Icon({ name, size = 20, className, style }: {
  name: string; size?: number; className?: string; style?: CSSProperties;
}): React.ReactElement {
  const d = PATHS[name] ?? PATHS.tool;
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/**
 * 外观三档：浅色 sun / 深色 moon / 自动（半圆填充）。
 * 形状与手机 App components/icons.tsx 的 AppearanceIcon 同源。
 */
export function AppearanceIcon({ mode, size = 17 }: {
  mode: 'light' | 'dark' | 'system'; size?: number;
}): React.ReactElement {
  if (mode === 'light' || mode === 'dark') return <Icon name={mode === 'light' ? 'sun' : 'moon'} size={size} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 3.4a8.6 8.6 0 0 0 0 17.2z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function toolIconName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('bash') || lower.includes('command') || lower.includes('shell')) return 'bash';
  if (lower.includes('edit')) return 'edit';
  if (lower.includes('write') || lower.includes('create')) return 'write';
  if (lower.includes('search') || lower.includes('find') || lower.includes('grep')) return 'search';
  if (lower.includes('read')) return 'file';
  if (lower.includes('web') || lower.includes('fetch') || lower.includes('url')) return 'globe';
  if (lower.includes('image')) return 'image';
  if (lower.includes('ask') || lower.includes('question')) return 'think';
  if (lower === 'task' || lower.includes('agent')) return 'bot';
  return 'tool';
}

/** 工具标题图标（默认色 / 尺寸与 App ToolIcon 一致，颜色由 CSS 的 currentColor 继承）。 */
export function ToolIcon({ name, size = iconSize.tool }: { name: string; size?: number }): React.ReactElement | null {
  const shape = toolIconName(name);
  if (!shape) return null;
  return <Icon name={shape} size={size} className="tool-icon" />;
}

/** 系统卡头部 kind 图标：委派=bot / 后台命令=终端 / 其余=圆圈感叹号。 */
export function SystemKindIcon({ kind, size = iconSize.card, color }: {
  kind: string; size?: number; color?: string;
}): React.ReactElement {
  return <Icon name={kind === 'delegation' ? 'bot' : kind === 'shell' ? 'bash' : 'alert'} size={size}
    className="system-kind-icon" style={color ? { color } : undefined} />;
}

/** 转圈：App SpinIcon 的浏览器等价物（CSS 旋转，见 .spin-icon）。 */
export function SpinIcon({ size = iconSize.card, className = '' }: {
  size?: number; className?: string;
}): React.ReactElement {
  return (
    <svg className={`spin-icon ${className}`.trim()} width={size} height={size} viewBox="0 0 16 16"
      fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6" opacity={0.25} />
      <path d="M14 8a6 6 0 00-6-6" />
    </svg>
  );
}

/** 折叠箭头（10 视图盒）：收起指向右，展开/返回用 CSS 旋转。 */
export function ChevronIcon({ size = iconSize.status, direction = 'right', className = '' }: {
  size?: number; direction?: 'right' | 'down' | 'left'; className?: string;
}): React.ReactElement {
  return (
    <svg className={`chevron-icon is-${direction} ${className}`.trim()} width={size} height={size} viewBox="0 0 10 10"
      fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 2l3 3-3 3" />
    </svg>
  );
}

/** 发送键图标：普通态是实心纸飞机（14），停止态是红方块（16）。 */
export function SendIcon({ stop }: { stop: boolean }): React.ReactElement {
  return (
    <svg width={stop ? 16 : 14} height={stop ? 16 : 14} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {stop
        ? <rect x="3" y="3" width="10" height="10" rx="1" fill="currentColor" />
        : <path d="M1 1l14 7-14 7 4-7-4-7z" fill="currentColor" />}
    </svg>
  );
}

/**
 * 模型图标（三点互联 + 连线）：点 a 实心、b/c 描边，与 App/PC 的 ModelGlyph 同一套几何。
 * 运行时三条点向三角形中心收拢、连线层绕中心同步缩放（SMIL，用户坐标与 SVG 一致，不随图标尺寸失真）。
 */
export function ModelGlyph({ size = 15, animated = false }: { size?: number; animated?: boolean }): React.ReactElement {
  const nodes = [
    { cx: 5, cy: 12, filled: true, dx: 5.13, dy: 0 },
    { cx: 19, cy: 5.5, filled: false, dx: -2.57, dy: 3.58 },
    { cx: 19, cy: 18.5, filled: false, dx: -2.57, dy: -3.58 },
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="model-glyph" aria-hidden="true">
      {nodes.map((node) => (
        <circle key={`${node.cx}-${node.cy}`} cx={node.cx} cy={node.cy} r={2.6}
          fill={node.filled ? 'currentColor' : 'none'}>
          {animated && (
            <animateTransform attributeName="transform" type="translate" additive="sum"
              values={`0 0; ${node.dx} ${node.dy}; 0 0`} keyTimes="0;0.5;1" dur="2.4s"
              calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" repeatCount="indefinite" />
          )}
        </circle>
      ))}
      <g transform="translate(14.33 12)">
        <g transform="translate(-14.33 -12)">
          <g>
            <path d="M7.4 10.9 16.6 6.6" />
            <path d="M7.4 13.1 16.6 17.4" />
            <path d="M19 8.1v7.8" />
            {animated && (
              <animateTransform attributeName="transform" type="scale"
                values="1;0.45;1" keyTimes="0;0.5;1" dur="2.4s"
                calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" repeatCount="indefinite" />
            )}
          </g>
        </g>
      </g>
    </svg>
  );
}

/** 输入卡工具栏图标：模型 / 权限 / 思考等级（颜色由 .composer-tool / .is-danger 控制）。 */
export function ComposerIcon({ kind, permission }: {
  kind: 'model' | 'permission' | 'thinking'; permission?: 'readonly' | 'standard' | 'full';
}): React.ReactElement {
  if (kind === 'model') return <ModelGlyph size={15} />;
  if (kind === 'thinking') return <Icon name="think" size={15} />;
  return (
    <svg className="composer-permission-icon" width={15} height={15} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      {permission === 'full' && <><path d="M12 8v4" /><path d="M12 16h.01" /></>}
      {permission === 'readonly' && <><rect x="9" y="11" width="6" height="5" rx="1" /><path d="M10.5 11V9.5a1.5 1.5 0 0 1 3 0V11" /></>}
      {(permission === 'standard' || !permission) && <path d="m9 12 2 2 4-4" />}
    </svg>
  );
}
