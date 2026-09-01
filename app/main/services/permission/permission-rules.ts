/**
 * 工具分类规则 — Agent 权限系统
 *
 * 定义安全工具白名单、安全 Bash 命令模式和危险命令列表。
 * 用于智能模式下的自动允许/询问判断。
 */

/** 始终安全的工具（免询问） */
export const SAFE_TOOLS: readonly string[] = [
  'Read',            // 文件读取
  'Glob',            // 文件名搜索
  'Grep',            // 内容搜索
  'WebSearch',       // 网络搜索
  'TodoRead',        // Todo 列表读取
  'TaskOutput',      // 后台任务输出

  // ── EasyMint 内置 MCP 工具（UI 控制 + 项目状态管理）──
  'show_confirm_dev',
  'show_new_project',
  'refresh_tasks',
  'show_prototype',
  'set_task_status',
  'list_issues',
  'rename_project',
  'describe_image',
  'web_fetch',

  // WebFetch 已移除：可被滥用为 SSRF
  // TodoWrite 已移除：修改 Agent 计划状态，非只读操作
  // 注意：AskUserQuestion 不在此列表 — 由 canUseTool 拦截并展示交互式 UI
]

/** 安全的 Bash 命令模式（只读操作） */
export const SAFE_BASH_PATTERNS: readonly RegExp[] = [
  /^git\s+(status|log|diff|show|branch|remote|tag)\b/,
  /^ls\b/,
  /^head\b/,
  /^tail\b/,
  /^grep\b/,
  /^rg\b/,
  /^which\b/,
  /^pwd$/,
  /^env$/,
  /^whoami$/,
  /^uname\b/,
  /^tree\b/,
  /^wc\b/,
  /^file\b/,
  /^stat\b/,
  /^du\b/,
  /^df\b/,
  /^node\s+--version$/,
  /^bun\s+--version$/,
  /^npm\s+(list|ls|view|info|outdated)\b/,
  /^bun\s+(pm\s+ls)\b/,
  // 注意：cat/echo/find 不在此列表中
  // - cat 可读取敏感文件（~/.ssh/id_rsa 等）
  // - echo 可通过重定向写入文件
  // - find 的 -exec/-delete 可执行任意命令/删除文件
]

/** 危险命令前缀（需特别标记⚠️） */
export const DANGEROUS_COMMANDS: readonly string[] = [
  'rm', 'rmdir',
  'sudo', 'su',
  'chmod', 'chown',
  'mv',
  'dd',
  'kill', 'killall', 'pkill',
  'git push', 'git reset', 'git rebase', 'git checkout',
  'git clean', 'git branch -D', 'git branch -d',
  'npm publish',
  'curl', 'wget',
  'ssh', 'scp',
]

/**
 * 检测 Bash 命令是否包含危险结构
 *
 * 检测管道、输出重定向、exec 子命令等危险模式。
 * MVP 阶段使用简单字符串检测，后续可升级为 shell AST 解析。
 */
export function hasDangerousStructure(command: string): boolean {
  // 管道操作
  if (/[|]/.test(command)) return true
  // 输出重定向
  if (/>{1,2}/.test(command)) return true
  // find -exec / -delete（可执行任意命令/删除文件）
  if (/\b-exec\b/.test(command) || /\b-delete\b/.test(command)) return true
  // 命令链接操作符（&&、;）
  if (/[;&]/.test(command)) return true
  // 子 shell / 命令替换（$(...) 和反引号）
  if (/\$\(/.test(command) || /`/.test(command)) return true
  return false
}

/**
 * 判断 Bash 命令是否匹配安全模式
 */
export function isSafeBashCommand(command: string): boolean {
  const trimmed = command.trim()
  if (hasDangerousStructure(trimmed)) return false
  return SAFE_BASH_PATTERNS.some((pattern) => pattern.test(trimmed))
}

/**
 * 判断命令是否为危险命令
 */
export function isDangerousCommand(command: string): boolean {
  const trimmed = command.trim().toLowerCase()
  return DANGEROUS_COMMANDS.some((dc) => trimmed.startsWith(dc.toLowerCase()))
}

// ── 绝对禁区（两模式共同，编程工具原则：不需要访问的绝不访问） ──────────

/**
 * 系统核心目录（读写都绝对禁止——影响系统运行的目录，编程工具无理由访问）。
 * 应用目录（macOS /Applications、Win C:\Program Files）不设禁区：软件可重装（用户决策）。
 */
export const SYSTEM_FORBIDDEN: readonly string[] = [
  // macOS / Linux 系统根
  '/System', '/Library', '/usr', '/bin', '/sbin', '/etc', '/var',
  '/cores', '/dev', '/proc', '/sys', '/private',
  '/Volumes',            // 外部卷挂载点（写入需谨慎）
  '/tmp',                // 系统临时区（避免跨用户残留）
  // Windows 系统目录（Program Files 属应用目录可重装，不设禁区）
  'C:\\Windows', 'C:\\ProgramData', 'C:\\Recovery',
  'C:\\System Volume Information', 'C:\\$Recycle.Bin', 'C:\\PerfLogs',
];

/** 凭据/敏感目录（读写都绝对禁止——编程工具无理由访问密钥） */
export const SECRET_FORBIDDEN: readonly string[] = [
  '~/.ssh', '~/.aws', '~/.gnupg', '~/.gnupg2', '~/.netrc', '~/.kube',
  '~/.docker',                 // config.json 含 docker 登录凭据
  '~/.config/gcloud',          // GCP 服务账号
  '~/.config/gh',              // GitHub CLI token
  '~/.npmrc',                  // 可能含 registry token
  '~/.pypirc',                 // PyPI token
  '~/.wgetrc', '~/.curlrc',    // 可能含基础认证
  '~/Library/Keychains',       // macOS 钥匙串
  // Windows 凭据（DPAPI）
  '%APPDATA%\\Microsoft\\Credentials',
  '%LOCALAPPDATA%\\Microsoft\\Credentials',
];

/**
 * 用户目录（禁写不禁读——用户私人数据不可再生，软件/文档存放处）。
 * 标准模式与完全访问都不写用户目录；但 cwd 本身在用户目录内时豁免（项目开发是明确意图）。
 */
export const USER_FORBIDDEN_WRITE: readonly string[] = [
  '~/Desktop', '~/Documents', '~/Downloads', '~/Movies', '~/Music', '~/Pictures',
  '~/Library',              // macOS 用户库（Application Support/Preferences 等应用数据，私人不可改）
  // Windows 用户目录（对应桌面/文档/下载等 Known Folder）
  '%USERPROFILE%\\Desktop', '%USERPROFILE%\\Documents', '%USERPROFILE%\\Downloads',
  '%USERPROFILE%\\Pictures', '%USERPROFILE%\\Music', '%USERPROFILE%\\Videos',
  '%USERPROFILE%\\OneDrive',
];

/** 路径归一化：展开 ~ 与 %APPDATA%/%LOCALAPPDATA%，统一分隔符，去尾部斜杠 */
export function normalizePath(p: string): string {
  let out = p.trim();
  if (!out) return out;
  const home = require("node:os").homedir().replace(/\\/g, "/");
  if (out.startsWith("~/")) out = home + out.slice(1);
  else if (out === "~") out = home;
  if (out.startsWith("%APPDATA%\\")) out = (process.env.APPDATA || "").replace(/\\/g, "/") + "/" + out.slice("%APPDATA%\\".length);
  if (out.startsWith("%LOCALAPPDATA%\\")) out = (process.env.LOCALAPPDATA || "").replace(/\\/g, "/") + "/" + out.slice("%LOCALAPPDATA%\\".length);
  if (out.startsWith("%USERPROFILE%\\")) out = (process.env.USERPROFILE || "").replace(/\\/g, "/") + "/" + out.slice("%USERPROFILE%\\".length);
  out = out.replace(/\\/g, "/");
  // 根目录特判：/ 不能被去尾斜杠清成空串（否则根目录禁区失效）
  if (out !== "/") out = out.replace(/\/+$/, "");
  return out;
}

/** 命中任一前缀列表（归一化后前缀匹配，目录边界敏感：/etc 不匹配 /etcetera） */
function hitsAnyPrefix(p: string, prefixes: readonly string[]): string | null {
  const norm = normalizePath(p);
  for (const prefix of prefixes) {
    const np = normalizePath(prefix);
    if (!np) continue;
    if (norm === np) return np;
    if (norm.startsWith(np + "/")) return np;
    // Windows 盘符根：C:/ 是 "C:" 归一化后无尾斜杠，单独判断
    if (/^[A-Za-z]:$/.test(np) && norm.startsWith(np + "/")) return np;
  }
  return null;
}

/** 根目录检查（禁止对文件系统根做写/删除操作） */
function isFsRoot(p: string): boolean {
  const norm = normalizePath(p);
  return norm === "/" || /^[A-Za-z]:$/.test(norm);
}

/** 系统核心（含根目录）判定——读写都禁，不可豁免 */
export function isSystemForbidden(p: string): boolean {
  if (isFsRoot(p)) return true;
  return hitsAnyPrefix(p, SYSTEM_FORBIDDEN) !== null;
}

/** 凭据目录判定——读写都禁，不可豁免 */
export function isSecretForbidden(p: string): boolean {
  return hitsAnyPrefix(p, SECRET_FORBIDDEN) !== null;
}

/** 用户目录判定——仅禁写；cwd 内豁免由调用方处理 */
export function isUserDirForbidden(p: string): boolean {
  return hitsAnyPrefix(p, USER_FORBIDDEN_WRITE) !== null;
}

/**
 * 写操作禁区判定：系统核心、凭据目录、用户目录、文件系统根 → 拒绝
 * （用户目录豁免由权限服务按 cwd 处理——项目建在用户目录内时开发不受阻）
 */
export function isForbiddenWritePath(p: string): boolean {
  return isSystemForbidden(p) || isSecretForbidden(p) || isUserDirForbidden(p);
}

/** 系统目录中允许读取的配置文件（环境变量/主机名/DNS 等——开发排查与运行时环境查看的常见需求，
    属于两模式共同区域；白名单之外的系统文件仍禁读） */
const SYSTEM_READ_ALLOWLIST: readonly string[] = [
  '/etc/profile', '/etc/environment', '/etc/shells', '/etc/hosts',
  '/etc/hostname', '/etc/host.conf', '/etc/nsswitch.conf', '/etc/resolv.conf',
  '/etc/localtime', '/etc/mime.types', '/etc/paths', '/etc/launchd.conf',
  // Windows 环境变量/系统信息（可安全读取）
  'C:\\Windows\\System32\\drivers\\etc\\hosts',
  'C:\\Windows\\System32\\drivers\\etc\\networks',
];

/** 是否命中系统读取白名单（精确文件匹配——白名单是"文件"不是目录） */
export function isSystemReadAllowlisted(p: string): boolean {
  const norm = normalizePath(p);
  return SYSTEM_READ_ALLOWLIST.some((f) => normalizePath(f) === norm);
}

/**
 * 读操作禁区判定：系统核心目录（白名单环境配置除外）+ 凭据目录禁读；
 * 用户目录不禁读——如读取下载的参考资料是正常需求
 */
export function isForbiddenReadPath(p: string): boolean {
  if (isSystemForbidden(p) && !isSystemReadAllowlisted(p)) return true;
  return isSecretForbidden(p);
}

/**
 * 从 bash 命令中提取文件路径（写类操作判定用）。
 * 覆盖：引号字符串、~ 开头、绝对路径、`-f/-o/--file=` 等选项值、重定向目标。
 * 解析不了/含变量替换的命令返回 null（调用方按保守处理）。
 */
export function extractPathsFromCommand(command: string): string[] | null {
  // 含命令替换/变量展开 → 无法静态解析，返回 null（保守拒绝写类命令）
  if (/\$\(/.test(command) || /`/.test(command) || /\$\{?[A-Za-z_]/.test(command)) return null;
  const paths: string[] = [];
  // 引号字符串
  const quoted = command.match(/(["'])(.*?)\1/g) || [];
  for (const q of quoted) {
    const inner = q.slice(1, -1).trim();
    if (inner && /[\\/]/.test(inner)) paths.push(inner);
  }
  // 重定向目标 > file / >> file
  const redirs = command.match(/>+[\s]*([^\s"'|;&]+)/g) || [];
  for (const r of redirs) {
    const target = r.replace(/^>+[\s]*/, "");
    if (target) paths.push(target);
  }
  // 绝对路径 token（/ 开头或盘符开头），排除命令名本身
  const tokens = command.split(/[\s"'=]+/).filter((t) => /^\/|^[A-Za-z]:[\\/]|^~[\\/]/.test(t));
  for (const t of tokens) {
    // 跳过纯选项（-f 等带路径的形式已在 split 后单独成 token）
    paths.push(t);
  }
  // ~ 开头（cd ~/foo 等）
  const tilde = command.match(/~[^\s"'|;&>]+/g) || [];
  for (const t of tilde) paths.push(t);
  return [...new Set(paths)];
}
