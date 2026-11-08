import type { DisplayToolBlock } from './messages';
import type { ProcessItem } from './turns';

/** 流式期间的进度文案（工具名 → 中文动作词） */
export function toolStatus(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized === 'read' || normalized === 'glob') return '正在读取文件';
  if (normalized === 'write') return '正在写入文件';
  if (normalized === 'edit') return '正在编辑文件';
  if (normalized === 'grep') return '正在搜索内容';
  if (normalized === 'bash') return '正在执行命令';
  if (normalized === 'task') return '正在派遣 Agent';
  if (normalized === 'webfetch') return '正在获取网页';
  if (normalized === 'websearch') return '正在联网搜索';
  if (normalized === 'use_skill' || normalized.startsWith('skill__')) return '正在加载技能';
  if (normalized.startsWith('mcp__')) return '正在调用外部工具';
  if (normalized === 'search_mcp_tools') return '正在查找外部工具';
  if (normalized === 'call_mcp_tool') return '正在调用外部工具';
  if (normalized === 'generate_image') return '正在生成图像';
  if (normalized === 'codemode') return '正在运行脚本';
  if (normalized === 'tool_search') return '正在查找工具';
  if (normalized === 'list_mcp_resources' || normalized === 'list_mcp_resource_templates') return '正在列出外部资源';
  if (normalized === 'read_mcp_resource') return '正在读取外部资源';
  return '正在处理';
}

/**
 * 工具名 → 动作词。**整表镜像桌面端 ChatBlocks.tsx 的 TOOL_LABELS**（同顺序、同用词），
 * 手机端只补 PC 表里还没有、但实际会话会出现的那几个——两边用词不一致时以 PC 为准。
 */
const TOOL_LABELS: Record<string, string> = {
  bash: '命令', edit: '编辑', read: '查看', write: '编写', grep: '搜索文件',
  find: '查找文件', ls: '列出目录', powershell: 'PowerShell',
  task: '派遣 Agent', create_agent_template: '创建模板', list_agents: '查看 Agent',
  read_agent_log: '读取日志', stop_agent: '停止 Agent',
  use_skill: '加载技能', manage_skill: '管理技能', learn: '沉淀经验',
  search_experiences: '搜索经验', retire_experiences: '退役经验', import_skill: '导入', import_mcp_server: '导入',
  show_confirm_dev: '确认开发', refresh_tasks: '刷新任务',
  set_task_status: '更新任务', show_prototype: '预览原型',
  list_issues: '查看 Issue', set_issue_status: '更新 Issue',
  web_fetch: '抓取网页', web_search: '搜索网页',
  todo_write: '更新步骤', todo_user: '用户待办',
  ask_user: '提问', describe_image: '查看图片',
  search_mcp_tools: '查找 MCP', call_mcp_tool: 'MCP',
  // 2026-11 对齐桌面端 ChatBlocks.TOOL_LABELS（用词取自 zh-CN.json），缺了会退回「工具」
  generate_image: '生成图像', codemode: '运行脚本', tool_search: '查找工具',
  list_mcp_resources: '列出资源', list_mcp_resource_templates: '列出资源模板', read_mcp_resource: '读取资源',
  // 以下为手机端补充（PC 表尚未收录，删掉会退回「工具」）
  stop_shell: '停止命令', install_dependency: '安装依赖',
};

/** 工具卡标题行文案：动作词 + 关键参数（命令 / 文件 / 查询词） */
export function toolDisplay(tool: DisplayToolBlock): string {
  const label = toolLabel(tool.name);
  const input = tool.input ?? {};
  if (tool.name === 'call_mcp_tool') {
    // 与桌面端 app/renderer/src/components/ChatBlocks.tsx:912 同款：filter(Boolean) 去掉空段，
    // 否则 name 里连续 __ 会拼出「srv /  / tool」
    const name = typeof input.name === 'string' ? input.name.replace(/^mcp__/, '').split('__').filter(Boolean).join(' / ') : '';
    const intent = typeof input.intent === 'string' ? input.intent.trim() : '';
    return [label, name, intent].filter(Boolean).join(' · ');
  }
  if (tool.name === 'search_mcp_tools') {
    return typeof input.server === 'string' ? `${label} · ${input.server}` : label;
  }
  // 以下四支对齐桌面端 ChatBlocks.tsx:915-930 的 toolDetailLabel（文案取自 zh-CN.json）。
  const name = tool.name.toLowerCase();
  if (name === 'use_skill' || name === 'import_skill') {
    const skill = typeof input.name === 'string' ? input.name : '';
    return skill ? `${label} · 技能：${skill}` : `${label} · 技能`;
  }
  if (name === 'manage_skill') {
    const action = typeof input.action === 'string' ? input.action : '';
    const skill = typeof input.name === 'string' ? input.name : '';
    return skill ? `${label} · 技能：${skill}${action ? `（${action}）` : ''}`
      : `${label} · 技能管理${action ? `（${action}）` : ''}`;
  }
  if (name === 'learn') {
    const skill = input.skill && typeof input.skill === 'object' ? input.skill as Record<string, unknown> : null;
    const skillName = skill && typeof skill.name === 'string' ? skill.name : '';
    return skillName ? `${label} · 沉淀技能：${skillName}` : label;
  }
  const detail = input.command ?? input.file_path ?? input.path ?? input.query ?? input.url ?? input.description;
  return typeof detail === 'string' && detail.trim() ? `${label} · ${detail.trim()}` : label;
}

/** 工具名 → 动作词（未收录按 MCP / 工具 两类退化，不直接显示英文名——与 PC 同口径） */
export function toolLabel(name: string): string {
  const normalized = name.toLowerCase();
  return TOOL_LABELS[normalized] ?? (normalized.startsWith('mcp__') ? 'MCP' : '工具');
}

/** 命令类工具（bash / powershell 等）：这些工具在 PC 上走「命令块 + 输出」的展开区，不把命令塞进标题 */
export function isCommandTool(name: string): boolean {
  return /^(bash|powershell|sh|zsh|shell)$/i.test(name);
}

/** bash 命令文本（PC 的 getBashCommand：input 可能是纯字符串或 { command }；这里只取对象形态） */
export function toolCommand(input: Record<string, unknown> | undefined): string {
  const value = input?.command;
  return typeof value === 'string' ? value.trim() : '';
}

/** bash 动作标题（Mint 调用时填的 description）——缺失返回空串，标题行就不显示（PC 同款） */
export function toolDescription(input: Record<string, unknown> | undefined): string {
  const value = input?.description;
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 系统消息 kind → 标签（与桌面端 customType 语义对应）。
 *
 * 这张表同时承担**历史数据**的显示：老会话里存在的 kind 即使今天不再产出，也要能显示成人话。
 * `handoff`（会话交接）就是这种——它来自已取消的「上下文轮转」（桌面端 2026-08-15 提交 46a111b1
 * 删除 rotation.ts，随后连标签映射一起清掉，只保留旧消息显示兼容）。手机端别跟着删：
 * 桌面端那边删的是**产出与映射**，手机端这里删掉，历史消息就会退化成「系统消息」。
 */
export const SYSTEM_LABELS: Record<string, string> = {
  delegation: 'SubAgent', shell: '后台命令', 'human-action': '命令交互', 'project-created': '项目初始化',
  'direct-create': '直接创建', flow: '流程指令', handoff: '会话交接',
  summary: '上下文摘要', learn: '经验沉淀', system: '系统消息', error: '运行错误',
};

/**
 * 工具活动文案 —— 镜像桌面端 `app/renderer/src/components/tool-activity.ts`（动作分类、目标提取）
 * 与 zh-CN 的 `ui.ToolActivity.*`（用词）。回合折叠行、工具卡标题、状态栏共用同一套口径，
 * 避免「状态栏说正在读取文件、折叠行说查看」这种同屏两套话。
 */
export type ToolAction =
  | 'read' | 'edit' | 'write' | 'search' | 'list' | 'find' | 'command'
  | 'fetch' | 'webSearch' | 'skill' | 'delegate' | 'ask' | 'image' | 'script' | 'external';

export type ActivityState = 'running' | 'done' | 'failed' | 'cancelled' | 'unfinished';

const ACTION_ALIASES: Record<string, ToolAction> = {
  read: 'read', edit: 'edit', write: 'write', grep: 'search', ls: 'list', find: 'find', glob: 'find',
  bash: 'command', powershell: 'command', sh: 'command', zsh: 'command', shell: 'command',
  web_fetch: 'fetch', webfetch: 'fetch', web_search: 'webSearch', websearch: 'webSearch',
  use_skill: 'skill', task: 'delegate', ask_user: 'ask',
  generate_image: 'image', describe_image: 'image', codemode: 'script',
};

/** 与桌面端 zh-CN.json 的 `ui.ToolActivity.<action>.label / running / done` 同词 */
const ACTION_WORDS: Record<ToolAction, { label: string; running: string; done: string }> = {
  read: { label: '读取文件', running: '正在读取', done: '已读取' },
  edit: { label: '编辑文件', running: '正在编辑', done: '已编辑' },
  write: { label: '写入文件', running: '正在写入', done: '已写入' },
  search: { label: '搜索内容', running: '正在搜索', done: '已搜索' },
  list: { label: '列出文件', running: '正在列出文件', done: '已列出文件' },
  find: { label: '查找文件', running: '正在查找文件', done: '已查找文件' },
  command: { label: '运行命令', running: '正在运行命令', done: '已运行命令' },
  fetch: { label: '获取网页', running: '正在获取网页', done: '已获取网页' },
  webSearch: { label: '搜索网页', running: '正在搜索网页', done: '已搜索网页' },
  skill: { label: '加载技能', running: '正在加载技能', done: '已加载技能' },
  delegate: { label: '委派任务', running: '正在委派任务', done: '已委派任务' },
  ask: { label: '提问', running: '正在提问', done: '已提问' },
  image: { label: '处理图片', running: '正在处理图片', done: '已处理图片' },
  script: { label: '运行脚本', running: '正在运行脚本', done: '已运行脚本' },
  external: { label: '调用工具', running: '正在调用工具', done: '已调用工具' },
};

/** 折叠行/工具卡用的图标名（复用 TopicIcon 的动作图标，与桌面端 `icons` 表同源） */
const ACTION_ICONS: Record<ToolAction, string> = {
  read: 'read', edit: 'edit', write: 'write', search: 'grep', list: 'ls', find: 'find',
  command: 'bash', fetch: 'web_fetch', webSearch: 'web_search', skill: 'use_skill',
  delegate: 'task', ask: 'ask_user', image: 'generate_image', script: 'bash', external: 'call_mcp_tool',
};

const text = (value: unknown): string => typeof value === 'string' ? value : '';
const oneLine = (value: unknown): string => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const basename = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) || path;

export function toolAction(name: string): ToolAction {
  return ACTION_ALIASES[name.toLowerCase()] ?? 'external';
}

/**
 * 工具调用 → 一行中文活动描述。
 * `target` 是给用户看的短目标（文件名 / 查询词），`fullTarget` 保留完整路径给 title 提示。
 */
export function toolActivity(name: string, input: Record<string, unknown> | undefined, state: ActivityState = 'running'): {
  text: string; fullText: string; action: ToolAction; label: string; icon: string;
} {
  const args = input ?? {};
  const action = toolAction(name);
  const path = text(args.path ?? args.file_path ?? args.directory);
  const query = text(args.pattern ?? args.query ?? args.search_pattern);
  let target = '';
  let fullTarget = '';
  if (action === 'read' || action === 'edit' || action === 'write' || action === 'list' || action === 'find') {
    fullTarget = path || text(args.pattern ?? args.glob);
    target = basename(fullTarget);
  } else if (action === 'search') {
    // 桌面端 ui.ToolActivity.searchTarget = "{{path}} 中的“{{query}}”"：把搜索词留在摘要里
    target = query ? `${basename(path) || '.'} 中的“${query}”` : basename(path);
    fullTarget = query ? `${path || '.'} 中的“${query}”` : path;
  } else if (action === 'command') target = fullTarget = text(args.command ?? args.cmd ?? args.script);
  else if (action === 'fetch') target = fullTarget = text(args.url);
  else if (action === 'webSearch') target = fullTarget = query;
  else if (action === 'skill') target = fullTarget = text(args.name ?? args.skill);
  else if (action === 'delegate') target = fullTarget = text(args.description ?? args.title ?? args.agent);
  else if (action === 'external') target = fullTarget = text(args.toolName ?? args.tool_name ?? args.name) || name;

  const words = ACTION_WORDS[action];
  // 词序对齐桌面端：失败 = 「读取文件失败」，取消/未完成则把状态词放前面（`已取消{{action}}`）
  const verb = state === 'failed' ? `${words.label}失败`
    : state === 'cancelled' ? `已取消${words.label}`
      : state === 'unfinished' ? `未完成${words.label}`
        : state === 'running' ? words.running : words.done;
  const format = (value: string): string => [verb, oneLine(value)].filter(Boolean).join(' ');
  return { text: format(target), fullText: format(fullTarget), action, label: words.label, icon: ACTION_ICONS[action] };
}

/**
 * 工具 → 状态行图标（只由工具名决定，与 `toolActivity` 同一张 ACTION_ICONS）。
 * 桌面端 StatusBar 在工具进行中把 Mint 图标换成工具图标（StatusBar.tsx:163-166），手机端同款。
 */
export function toolActivityIcon(name: string): string {
  return ACTION_ICONS[toolAction(name)];
}

/** 工具状态 → 带目标的进度文案（「正在读取 app.ts」）；没有可用参数时回落到 toolStatus 的原文案 */
export function toolStatusTargeted(name: string, input: Record<string, unknown> | undefined): string {
  const activity = toolActivity(name, input, 'running');
  return activity.text === ACTION_WORDS[activity.action].running ? toolStatus(name) : activity.text;
}

/**
 * 回合渲染用的「过程条目描述」：折叠行摘要与状态栏共用一套词。
 * 放在这里而不是 turns.ts，是为了让 turns.ts 保持纯结构（不依赖工具文案表）。
 */
export function describeProcessItem(item: ProcessItem): { text: string; label: string } {
  if (item.kind === 'thinking') return { text: '思考过程', label: '思考过程' };
  if (item.kind === 'commentary') return { text: '中间结论', label: '中间结论' };
  // 三种「未完成」要分开：还在跑、跑完但失败、回合结束了仍没有结果（中断）
  const state: ActivityState = item.running
    ? 'running'
    : item.tool.state === 'error' ? 'failed'
      : item.tool.state === 'running' ? 'unfinished' : 'done';
  const activity = toolActivity(item.tool.name, item.tool.input, state);
  return { text: activity.text, label: activity.label };
}
