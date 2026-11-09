import type { CSSProperties } from 'react';

/** 单色线性图标集：与手机 App components/icons.tsx 的图形语义一致，全部走 currentColor。 */
const PATHS: Record<string, string> = {
  back: 'M15 18l-6-6 6-6',
  chevron: 'M9 18l6-6-6-6',
  chevronDown: 'M6 9l6 6 6-6',
  settings: 'M12 15.1a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2zM19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.7a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.3 9v.01a1.7 1.7 0 0 0 1.56 1.02H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.02z',
  clip: 'M21.4 11.6l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.9 1.9 0 0 1-2.7-2.7l7.8-7.8',
  send: 'M5 12h13M13 6l6 6-6 6',
  stop: 'M7 7h10v10H7z',
  plus: 'M12 5v14M5 12h14',
  plusChat: 'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719M8 12h8M12 8v8',
  shield: 'M12 3l7 3v6c0 4.4-3 8-7 9-4-1-7-4.6-7-9V6l7-3z',
  think: 'M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.2.9 1.9V17h5.2v-1.2c0-.7.3-1.4.9-1.9A6 6 0 0 0 12 3zM9.5 20h5',
  model: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  archive: 'M4 7h16v3H4zM5 10v9h14v-9M10 14h4',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M20 6 9 17l-5-5',
  cross: 'M18 6 6 18M6 6l12 12',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  tool: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.1-2.1 2.6-2.4z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  file: 'M6 3h8l4 4v14H6zM14 3v5h4',
  bash: 'm7 11 2-2-2-2M11 13h4M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
  edit: 'M4 20h4L20 8l-4-4L4 16v4zM14 6l4 4',
  write: 'M12 5v14M5 12h14',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M9 9h.01',
  doc: 'M7 3h7l4 4v14H7zM14 3v5h4M10 13h6M10 17h6',
  bot: 'M12 8V4H8M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM2 14h2M20 14h2M15 13v2M9 13v2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0',
  link: 'M10 13a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7L11 6.3M14 11a4 4 0 0 0-5.7 0L6 13.3A4 4 0 0 0 11.7 19l1.3-1.3',
  sun: 'M12 16.2a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4zM12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4 7 7M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6',
  moon: 'M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.7 8.7 0 1 0 11.1 11.1z',
  system: 'M4 5h16v11H4zM9 20h6M12 16v4',
  refresh: 'M20 11a8 8 0 1 0-2 6M20 5v6h-6',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  pin: 'M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 14v7',
  folder: 'M3 7h6l2 2h10v10H3z',
  play: 'M8 5l11 7-11 7z',
  alert: 'M12 4l9 16H3L12 4zM12 10v4M12 17h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.2V12l3.4 2',
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
  const brain = name === 'think';
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={brain ? 2 : (name === 'check' || name === 'cross' ? 2.5 : (name === 'settings' || name === 'clock' ? 1.6 : (name === 'bot' || name === 'bash' ? 2 : (name === 'plusChat' ? 1.8 : 1.7))))}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {brain ? <>
        <path d="M12 18V5" /><path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" />
        <path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" /><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" />
        <path d="M18 18a4 4 0 0 0 2-7.464" /><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" />
        <path d="M6 18a4 4 0 0 1-2-7.464" /><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" />
      </> : <path d={d} />}
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

function toolIconPaths(name: string): React.ReactElement | null {
  let n = name.toLowerCase();
  if (n.startsWith("mcp__") || n === "search_mcp_tools" || n === "call_mcp_tool") n = "mcp"; // MCP 工具统一扳手
  switch (n) {
    // 光标那笔带 icon-cursor 类：供终端类胶囊做光标闪烁，样式按祖先作用域限定（如 .shell-pill-icon），
    // 其他地方用到同一图标不受影响
    case "bash": case "powershell": return (<><path d="m7 11 2-2-2-2"/><path className="icon-cursor" d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/></>);
    case "edit": return (<><path d="M12.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v9.34"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10.378 12.622a1 1 0 0 1 3 3.003L8.36 20.637a2 2 0 0 1-.854.506l-2.867.837a.5.5 0 0 1-.62-.62l.836-2.869a2 2 0 0 1 .506-.853z"/></>);
    case "read": return (<><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></>);
    case "generate_image": return (<><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><path d="m21 15-5-5L5 21"/></>);
    case "write": return (<><path d="M13 21h8"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></>);
    // 搜索文件(file-search-corner)
    case "grep": return (<><path d="M11.1 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.589 3.588A2.4 2.4 0 0 1 20 8v3.25"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="m21 22-2.88-2.88"/><circle cx="16" cy="17" r="3"/></>);
    // 目录类(find 展开态 / ls 收起态)——路径数据与 FileTreePanel 的 folder-open / folder 同源(Lucide)
    case "find": return (<path d="m6 14 1.5-2.9A2 2 0 019.24 10H20a2 2 0 011.94 2.5l-1.54 6a2 2 0 01-1.95 1.5H4a2 2 0 01-2-2V7c0-1.1.9-2 2-2h2"/>);
    case "ls": return (<path d="M20 20a2 2 0 002-2V8a2 2 0 00-2-2h-7.9a2 2 0 01-1.69-.9L9.6 3.9A2 2 0 007.93 3H4a2 2 0 00-2 2v13a2 2 0 002 2z"/>);
    // agent 类(bot)
    case "task": case "create_agent_template": case "list_agents": case "read_agent_log": case "stop_agent":
      return (<><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></>);
    // 知识/技能(wrench)
    case "use_skill": case "manage_skill": case "learn": case "search_experiences":
    case "import_skill": case "import_mcp_server":
      return (<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/>);
    // MCP 工具调用(plug 插头)
    case "mcp":
      return (<><path d="M12 22v-5"/><path d="M15 8V2"/><path d="M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z"/><path d="M9 8V2"/></>);
    // 项目类(folder-kanban)
    case "show_confirm_dev": case "refresh_tasks": case "set_task_status":
    case "show_prototype":
      return (<><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><path d="M8 10v4"/><path d="M12 10v2"/><path d="M16 10v6"/></>);
    // issue(bug)
    case "list_issues": case "set_issue_status":
      return (<><path d="M12 20v-9"/><path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z"/><path d="M14.12 3.88 16 2"/><path d="M21 21a4 4 0 0 0-3.81-4"/><path d="M21 5a4 4 0 0 1-3.55 3.97"/><path d="M22 13h-4"/><path d="M3 21a4 4 0 0 1 3.81-4"/><path d="M3 5a4 4 0 0 0 3.55 3.97"/><path d="M6 13H2"/><path d="m8 2 1.88 1.88"/><path d="M9 7.13V6a3 3 0 1 1 6 0v1.13"/></>);
    // 联网搜索(world-search:地球 + 放大镜)
    case "web_search":
      return (<><path d="M21 12a9 9 0 1 0 -9 9"/><path d="M3.6 9h16.8"/><path d="M3.6 15h7.9"/><path d="M11.5 3a17 17 0 0 0 0 18"/><path d="M12.5 3a16.984 16.984 0 0 1 2.574 8.62"/><path d="M15 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/><path d="M20.2 20.2l1.8 1.8"/></>);
    // 抓取网页(world-download:地球 + 下箭头)——与搜索同族但动作不同,图标必须能区分
    case "web_fetch":
      return (<><path d="M21 12a9 9 0 1 0 -9 9"/><path d="M3.6 9h16.8"/><path d="M3.6 15h8.4"/><path d="M11.578 3a17 17 0 0 0 0 18"/><path d="M12.5 3c1.719 2.755 2.5 5.876 2.5 9"/><path d="M18 14v7m-3 -3l3 3l3 -3"/></>);
    // 待办(list-clock)
    case "todo_write": case "todo_user":
      return (<><path d="M16 13v2.2l1.6 1"/><path d="M3 12h3.458"/><path d="M3 19h3.832"/><path d="M3 5h18"/><circle cx="16" cy="15" r="6"/></>);
    // ask(message-circle-question-mark)
    case "ask_user":
      return (<><path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></>);
    // 图片(photo-ai)
    case "describe_image":
      return (<><path d="M15 8h.01"/><path d="M10 21h-4a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v5"/><path d="M3 16l5-5c.928-.893 2.072-.893 3 0l1 1"/><path d="M14 21v-4a2 2 0 1 1 4 0v4"/><path d="M14 19h4"/><path d="M21 15v6"/></>);
    default: return null;
  }
}

/** 工具图标与桌面端共用名称映射和 SVG 轮廓。 */
export function ToolIcon({ name, size = iconSize.tool }: { name: string; size?: number }): React.ReactElement | null {
  const paths = toolIconPaths(name); if (!paths) return null;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="tool-icon" aria-hidden="true">{paths}</svg>;
}

/** 系统卡头部 kind 图标：委派=bot / 后台命令=终端 / 其余=圆圈感叹号。 */
export function SystemKindIcon({ kind, size = iconSize.card, color }: {
  kind: string; size?: number; color?: string;
}): React.ReactElement {
  if (kind === 'delegation' || kind === 'shell') return <Icon name={kind === 'delegation' ? 'bot' : 'bash'} size={size} className="system-kind-icon" style={color ? { color } : undefined} />;
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="system-kind-icon" style={color ? { color } : undefined} aria-hidden="true"><circle cx={8} cy={8} r={6.5} /><path d="M8 7.5V11M8 5h.01" /></svg>;
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

/** 桌面端附件菜单的 16×16 图标。 */
export function AttachmentKindIcon({kind}: {kind: 'image' | 'doc'}): React.ReactElement {
  return <svg width={15} height={15} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden="true">
    {kind === 'image' ? <><rect x={1.5} y={2.5} width={13} height={11} rx={2} /><circle cx={5} cy={6} r={1.2} /><path d="M1.5 11l3.5-3.5 2.5 2.5 3-4 4 5" /></> : <><path d="M3 2h7l4 4v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" /><path d="M10 2v4h4M6 9h4M6 12h4" /></>}
  </svg>;
}
