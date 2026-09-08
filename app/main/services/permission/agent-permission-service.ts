/**
 * Agent 权限服务
 *
 * 核心职责：
 * - 实现 canUseTool 回调（供 SDK query 使用）
 * - 管理 pending 权限请求（Promise + Map 模式）
 * - 维护会话级白名单
 * - 工具/命令分类判断
 *
 * 参考 Craft Agents OSS 的 Promise + Map 异步等待模式。
 */

import {
  SAFE_TOOLS,
  isSafeBashCommand,
  isReadOnlyPipeline,
  isDangerousCommand,
  hasDangerousStructure,
  isChainWithinCwd,
  isForbiddenWritePath,
  isForbiddenReadPath,
  isSystemForbidden,
  isSecretForbidden,
  isUserDirForbidden,
  isDevNull,
  extractPathsFromCommand,
  hitForbiddenLiteral,
  normalizePath,
  CURL_WRITE_PARAM_RE,
} from './permission-rules'
import { classifyForSandbox } from '../sandbox/classify'
import { ensureSandbox } from '../sandbox/manager'
import { readCache } from '../session-cache'

// ── 本地类型（替代 @proma/shared） ─────────────────

/** SDK PermissionBehavior */
type PermissionBehavior = 'allow' | 'deny'

/** SDK PermissionUpdateDestination */
type PermissionUpdateDestination = 'userSettings' | 'projectSettings' | 'localSettings' | 'session' | 'cliArg'

/** SDK 权限规则值 */
interface PermissionRuleValue {
  toolName: string
  ruleContent?: string
}

/** SDK PermissionUpdate（匹配 SDK 0.2.63） */
export type PermissionUpdate = {
  type: 'addRules' | 'replaceRules' | 'removeRules'
  rules: PermissionRuleValue[]
  behavior: PermissionBehavior
  destination: PermissionUpdateDestination
} | {
  type: 'setMode'
  mode: string
  destination: PermissionUpdateDestination
} | {
  type: 'addDirectories' | 'removeDirectories'
  directories: string[]
  destination: PermissionUpdateDestination
}

/** SDK PermissionDecisionClassification（匹配 SDK 0.2.120） */
type PermissionDecisionClassification = 'user_temporary' | 'user_permanent' | 'user_reject'

/** SDK PermissionResult（匹配 SDK 0.2.120） */
export type PermissionResult = {
  behavior: 'allow'
  updatedInput?: Record<string, unknown>
  updatedPermissions?: PermissionUpdate[]
  toolUseID?: string
  decisionClassification?: PermissionDecisionClassification
} | {
  behavior: 'deny'
  message: string
  interrupt?: boolean
  toolUseID?: string
  decisionClassification?: PermissionDecisionClassification
}

/** canUseTool 回调的 options 参数（匹配 SDK CanUseTool） */
export interface CanUseToolOptions {
  signal: AbortSignal
  suggestions?: PermissionUpdate[]
  blockedPath?: string
  decisionReason?: string
  decisionReasonType?: string
  classifierApprovable?: boolean
  toolUseID: string
  agentID?: string
  title?: string
  displayName?: string
  description?: string
}

/**
 * Agent 权限服务
 *
 * 单例模式，管理所有会话的权限状态。
 */
export class AgentPermissionService {
  /**
   * 创建 canUseTool 回调（两模式 + 禁区，最小化原则）。
   *
   * 模式（会话级，从 session-cache 实时读取——切换即时生效）：
   * - standard（标准/半沙盒，默认）：读写当前项目内；可读项目外普通位置；写项目外拒绝（不弹窗）。
   * - full（完全访问）：可读写项目之外的文件。
   * 两模式共同的禁区：系统核心目录（mac /etc /usr /System 等、Win C:\Windows 等）禁读写；
   * 凭据/敏感目录（~/.ssh ~/.aws 等）禁读写；用户目录（~/Desktop ~/Downloads 等）禁写不禁读
   * （cwd 在用户目录内时豁免——项目建在用户目录内开发不受阻）。
   * 旧四档值映射：auto/plan/acceptEdits → standard；bypassPermissions → full。
   */
  createCanUseTool(
    sessionId: string,
    cwd: string,
    resolveSessionId?: (sid: string) => string,
  ): (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions) => Promise<PermissionResult> {
    return async (toolName, input, _options) => {
      // 会话 id 实时解析：新会话 canUseTool 绑定的是主进程 randomUUID 临时 id，而前端切换权限后
      // 写 session-cache 用的是真实 SDK sid（__new_xxx 创建后由 onChatSession 回绑）——两个 key 错位
      // 会导致「会话内切换完全访问不生效」。按临时→真实映射解析后再读缓存，key 与前端写入一致。
      const sid = resolveSessionId ? resolveSessionId(sessionId) : sessionId
      const rawMode = readCache(sid)?.permissionMode || 'auto'
      const mode = normalizeMode(rawMode)

      const allow = (): PermissionResult => ({ behavior: 'allow' as const, updatedInput: input })
      const deny = (message: string): PermissionResult => ({ behavior: 'deny' as const, message })

      const t = toolName.toLowerCase()
      const paths = (): string[] => {
        const p = String((input as any).file_path ?? (input as any).notebook_path ?? (input as any).path ?? '')
        return p ? [p] : []
      }

      // ── 1. 绝对禁区（所有模式） ──
      // 读工具：系统核心目录 + 凭据目录禁读（用户目录不禁读——读下载的参考资料是正常需求）
      if (isReadTool(t)) {
        for (const p of paths()) {
          if (isForbiddenReadPath(p)) return deny(`路径在系统敏感位置或凭据目录，禁止访问：${p}`)
        }
      }
      // 写工具：系统核心 + 凭据禁写（不可豁免）；用户目录禁写（cwd 内豁免——项目建在用户目录内时开发不受阻）
      if (isWriteTool(t)) {
        for (const p of paths()) {
          if (isSystemForbidden(p) || isSecretForbidden(p)) return deny(`路径在绝对禁区内（系统核心/凭据目录），禁止写入：${p}`)
          if (isUserDirForbidden(p) && !isWithinCwd(p, cwd)) return deny(`用户目录禁止写入（私人数据不可修改）：${p}`)
        }
      }

      // MCP 工具：参数 schema 任意（外部服务器定义），不适用 cwd 沙盒（用户显式配置=信任），
      // 但绝对禁区仍是底线——系统目录/凭据目录/用户目录写 任何模式都拦
      if (t.startsWith('mcp__')) {
        for (const p of extractPathArgs(input)) {
          if (isForbiddenWritePath(p)) return deny(`路径在绝对禁区内（系统核心/凭据/用户目录），MCP 工具禁止写入：${p}`)
          if (isForbiddenReadPath(p)) return deny(`路径为系统敏感位置/凭据目录，MCP 工具禁止访问：${p}`)
        }
        return allow()
      }

      // ── 2. bash：禁区检查对所有模式生效（完全访问只放宽文件写范围，不放开系统核心/凭据/用户目录）──
      if (t === 'bash') {
        const cmd = String(input.command || '')
        if (!cmd.trim()) return allow()
        // 系统级变更命令：任何模式拒绝——系统权限「该申请申请」，EM 不绕过
        if (isSystemMutationCommand(cmd)) {
          return deny(`系统级变更命令被拦截（需用户手动在终端执行，权限系统不代做系统级操作）：${cmd.slice(0, 100)}`)
        }
        // 不可逆数据库操作（drop/truncate）：任何模式拒绝——数据销毁不可逆，先备份再人工执行
        if (isIrreversibleDbCommand(cmd)) {
          return deny(`不可逆数据库操作（DROP/TRUNCATE 等销毁数据，任何模式拒绝）——先备份数据，确认后请在终端手动执行或请用户确认：${cmd.slice(0, 100)}`)
        }
        // 执行本地脚本 → 扫描脚本内容（防「Write 脚本到项目内再执行」绕过路径检查）
        const scriptPath = detectScriptExec(cmd)
        if (scriptPath) {
          const abs = /^\/|^[A-Za-z]:[\\/]/.test(scriptPath)
            ? scriptPath
            : require('node:path').resolve(cwd, scriptPath)
          try {
            const content = require('node:fs').readFileSync(abs, 'utf-8')
            const hit = scanScriptContent(content)
            if (hit) return deny(`脚本 ${scriptPath} 内容含系统敏感操作（${hit}），拒绝执行——如需执行请用户手动确认`)
          } catch { /* 脚本不存在/不可读 → 交给 bash 本身报错 */ }
        }
        // 内联代码（node -e / python -c / bash -c / sh -c 等）→ 独立扫描（命令可能同时含脚本与内联代码）
        // 不加锚定：可能出现在命令任意位置（如 cd x && bash -c "..."）
        const inline = /(?:\b(?:node|nodejs|python|python3|ruby|perl|php|bash|sh|zsh|dash|ksh)\s+-(?:e|c)\s+)(["'])([\s\S]*?)\1/.exec(cmd)
        if (inline) {
          const hit = checkInlineCode(inline[2] ?? '', cwd, 0)
          if (hit) return deny(`内联代码含系统敏感操作（${hit}），拒绝执行`)
        }
        // 路径提取：含变量/命令替换 → 路径无法静态确认（判不了域）
        //   写类命令（rm $FILE / cp $SRC $DST）→ 沙盒兜底（沙盒内变量展开写工作区外同样被拦）；
        //   只读/执行类（echo $HOME、npm run build --port $P）→ 变量不影响安全半径，放行
        const cmdPathsRaw = extractPathsFromCommand(cmd)
        if (cmdPathsRaw === null) {
          // 含变量/命令替换 → 完整路径静态解析不了，但字面片段仍可能指向禁区
          // （$HOME/.ssh、$(echo /etc)/x）——不兜底则绝对禁区可被变量写法绕过
          const literal = hitForbiddenLiteral(cmd)
          if (literal) {
            return deny(`命令含变量/命令替换，且字面片段指向禁区（${literal}）：${cmd.slice(0, 100)}`)
          }
          if (mode !== 'full' && isWriteLikeCommand(cmd)) {
            const sb = await ensureSandbox(cwd)
            if (!sb.ok) return deny(`沙盒不可用（${sb.reason}），且写类命令含变量/命令替换无法确认范围：${cmd.slice(0, 100)}——请切换「完全访问」`)
            return { behavior: 'allow' as const, updatedInput: { ...input, sandbox: true } }
          }
          return allow()
        }
        // 路径禁区检查前排除 /dev/null（黑洞设备:丢弃数据非落盘,写它无害不属禁区）
        const cmdPaths = cmdPathsRaw.filter((p) => !isDevNull(p))
        if (isWriteLikeCommand(cmd)) {
          // 写类命令：系统核心/凭据禁写；用户目录禁写（cwd 内豁免）
          const sys = cmdPaths.find((p) => isSystemForbidden(p) || isSecretForbidden(p))
          if (sys) return deny(`命令涉及系统敏感位置（禁止写入）：${sys}`)
          const userDir = cmdPaths.find((p) => isUserDirForbidden(p) && !isWithinCwd(p, cwd))
          if (userDir) return deny(`用户目录禁止写入：${userDir}`)
        } else {
          // 读类命令：系统核心（白名单除外）/凭据禁读；用户目录读放行
          const secret = cmdPaths.find((p) => isForbiddenReadPath(p))
          if (secret) return deny(`命令涉及系统敏感位置/凭据目录（禁止读取）：${secret}`)
        }
        // 禁区检查通过后：完全访问直接放行（可写项目外非禁止区；判不了域亦直跑——D3 语义）
        if (mode === 'full') return allow()
        // ── standard：判不了域 → 沙盒（运行时约束兜底：写半径=工作区、禁私网/本机）──
        const sandboxKind = classifyForSandbox(cmd)
        if (sandboxKind === 'network' || sandboxKind === 'inline') {
          const sb = await ensureSandbox(cwd)
          if (!sb.ok) return deny(`沙盒不可用（${sb.reason}）——下载即执行/内联命令需沙盒执行，请切换「完全访问」或检查沙盒依赖`)
          return { behavior: 'allow' as const, updatedInput: { ...input, sandbox: true } }
        }
        // ── 危险命令：rm 目标全部在项目内 → 豁免危险拒绝(与 mkdir/touch 同为项目内写操作,
        //    路径检查兜底出区删除);其余危险命令维持拒绝。
        //    （旧代码此处另有「回环 curl 豁免」——curl 已不在危险名单，保留会给链中其他危险命令误开豁免）──
        // 本地文件操作(rm/mv/chmod/chown)豁免:目标全在项目内 → 危险拒绝豁免
        // (与 mkdir/touch 同为项目内文件操作,路径检查兜底出区)。
        // 相对路径(rm temp/x)默认在 cwd 内操作——bash 语义;仅绝对路径/~/../ 目标需逐个查是否出区。
        // 删除/移动/系统级(rm/mv/sudo/dd 等)不豁免——项目内也拒
        const rmTargets = (cmdPathsRaw ?? []).filter((p) => !isDevNull(p))
        const fileOpInCwd = (() => {
          const c = cmd.trim().toLowerCase()
          if (!/^(?:rm|rmdir|mv|chmod|chown)\b/.test(c)) return false
          // ../ 相对路径可逃出 cwd,静态判不了落点 → 不豁免(保守拒,引导切完全访问)
          if (/(?:^|\s)\.\.\/|(?:^|\s)\.\.$/.test(c)) return false
          // 不含可判绝对路径 → 视为项目内(相对路径操作)
          if (rmTargets.length === 0) return true
          // 含绝对/~/../ 目标:全部须在 cwd 内
          return rmTargets.every((p) => isWithinCwd(p, cwd))
        })()
        if (isDangerousCommand(cmd) && !fileOpInCwd) {
          return deny(`危险命令被拦截（删除/移动类操作可能造成不可逆的数据丢失）：${cmd.slice(0, 120)}——如确需执行，请把输入框的权限切到「完全访问」`)
        }
        // 只读管道/链式查询（grep x | head / ls 2>/dev/null | grep 等——全段只读）→ 放行,
        // 不做「危险结构」一刀切拒绝。放在危险命令检查之后:危险命令即使纯管道也不放行
        if (isReadOnlyPipeline(cmd)) return allow()
        // 链式命令（管道/&&/;/||——非全只读,如 cd x && npm run lint / mkdir a && touch a/b）:
        // 设计初衷是防越界(写 cwd 外/禁区),不防链式语法本身——逐段判定:写类段路径须在 cwd 内,
        // 只读/执行类段通过。不再“有结构即拒”(旧逻辑误拦大量项目内合法链式命令)
        if (hasDangerousStructure(cmd)) {
          const segCheck = isChainWithinCwd(cmd, cwd)
          if (!segCheck.ok) return deny(`工作区外写入被拦截：${segCheck.deny}（当前工作区：${cwd}）——需要改工作区外的文件，请把输入框的权限切到「完全访问」`)
          return allow()
        }
        // 单段写类命令 cwd 沙盒（禁区已在上面检查;无结构链接的单命令）
        if (isWriteLikeCommand(cmd)) {
          const outside = cmdPaths.find((p) => !isWithinCwd(p, cwd))
          if (outside) return deny(`工作区外写入被拦截：${outside}（当前工作区：${cwd}）——需要改工作区外的文件，请把输入框的权限切到「完全访问」`)
        }
        return allow()
      }

      // ── 3. 完全访问：非 bash 工具除禁区外自由读写 ──
      if (mode === 'full') return allow()

      // ── 4. 标准（半沙盒） ──
      // 只读操作放行（含只读 bash 命令）
      if (this.isReadOnlyTool(toolName, input)) return allow()

      // 其他写工具（Write/Edit/NotebookEdit）：路径必须在 cwd 内（禁区已在第 1 步检查）
      for (const p of paths()) {
        if (!isWithinCwd(p, cwd)) return deny(`工作区外写入被拦截：${p}（当前工作区：${cwd}）——需要改工作区外的文件，请把输入框的权限切到「完全访问」`)
      }
      // 其余工具（task/ask_user/use_skill 等 EM 工具）：标准模式放行
      return allow()
    }
  }

  // ===== 工具分类判断 =====

  /**
   * 判断工具是否为只读操作（智能模式下自动允许）
   */
  private isReadOnlyTool(toolName: string, input: Record<string, unknown>): boolean {
    // 安全工具白名单（大小写不敏感：SDK 工具名 Read/read 混用）
    if (SAFE_TOOLS.some((s) => s.toLowerCase() === toolName.toLowerCase())) return true

    // Bash 工具：检查命令是否匹配安全模式（含只读管道/丢弃 stderr 的组合——见 isReadOnlyPipeline）
    if (toolName.toLowerCase() === 'bash') {
      const command = typeof input.command === 'string' ? input.command : ''
      return isSafeBashCommand(command) || isReadOnlyPipeline(command)
    }

    return false
  }
}

/** 全局权限服务实例 */
export const permissionService = new AgentPermissionService()

// ── 模块级辅助（两模式权限判定） ─────────────────────

/** 旧四档 → 两模式映射：auto/plan/acceptEdits → standard；bypassPermissions → full */
function normalizeMode(raw: string): 'standard' | 'full' {
  if (raw === 'full' || raw === 'bypassPermissions') return 'full'
  return 'standard'
}

/** 读工具名（Read 及其变体） */
function isReadTool(t: string): boolean {
  return t === 'read' || t === 'mcp__filesystem__read'
}

/** 写工具名（Write/Edit/NotebookEdit 及其变体） */
function isWriteTool(t: string): boolean {
  return t === 'write' || t === 'edit' || t === 'notebookedit'
}

/** 写类 bash 命令前缀（读命令之外、可能落盘的操作） */
const WRITE_COMMANDS: readonly string[] = [
  'mv', 'cp', 'rm', 'rmdir', 'mkdir', 'touch', 'chmod', 'chown', 'ln',
  'tee', 'install', 'dd', 'truncate', 'mkfs', 'umount', 'mount',
  'sed -i', 'awk -i', 'perl -i', 'ruby -i',
  'git add', 'git commit', 'git push', 'git reset', 'git checkout', 'git stash',
  'npm install', 'npm ci', 'pnpm install', 'yarn', 'bun install',
  'pip install', 'pip3 install', 'uv add', 'uv sync', 'poetry install',
  'cargo build', 'cargo install', 'go build', 'go install', 'go mod tidy',
  'brew install', 'brew uninstall', 'apt-get', 'apt', 'yum', 'dnf', 'pacman',
  'crontab', 'launchctl', 'systemctl', 'defaults write', 'plutil -replace',
];

/** 命令是否写类（含重定向、写命令前缀、编辑器直写、curl/wget 文件写参——后者的目标路径是工具参数非 shell 重定向）。
 *  重定向仅指向 /dev/null 或 fd(2>&1 等)时不算写文件——黑洞/fd 重定向不落盘(如 cat f > /dev/null 是纯读+丢弃) */
function isWriteLikeCommand(cmd: string): boolean {
  const c = cmd.trim().toLowerCase()
  if (/>+/.test(c)) {
    // 剥离丢弃类重定向(/dev/null、fd 数字重定向)后若仍有写文件重定向 → 写类
    const remaining = c.replace(/\d*>?\s*\/dev\/null\b/g, " ").replace(/\d*>?&\d+/g, " ")
    if (/>+\s*[^\s"'|;&]/.test(remaining)) return true
  }
  if (CURL_WRITE_PARAM_RE.test(c)) return true
  return WRITE_COMMANDS.some((w) => c.startsWith(w))
}

/**
 * 系统级变更命令（任何模式拒绝——系统权限「该申请申请」，EM 不代做系统级操作，提示用户手动执行）。
 * 与「危险命令」不同：危险命令在标准模式拒、完全访问可（放宽文件范围）；系统级变更命令完全访问也不放。
 */
export function isSystemMutationCommand(cmd: string): boolean {
  const c = cmd.trim().toLowerCase()
  return SYSTEM_MUTATION_COMMANDS.some((m) => c === m || c.startsWith(m + ' '))
}

/** 系统级变更命令前缀：修改系统配置/挂载/进程/服务/固件——任何模式都拒绝 */
const SYSTEM_MUTATION_COMMANDS: readonly string[] = [
  // 权限提升与系统管理
  'sudo', 'su', 'dd', 'mkfs', 'mount', 'umount', 'diskutil', 'fdisk', 'parted',
  'launchctl', 'systemctl', 'service', 'shutdown', 'reboot', 'halt', 'poweroff',
  'osascript',            // AppleScript 可控制系统级操作
  'csrutil', 'nvram', 'pmset', 'sysctl -w',
  // Windows 系统级
  'reg add', 'reg delete', 'reg import', 'diskpart', 'format', 'bcdedit', 'subst',
  'netsh', 'sc create', 'sc delete', 'sc config', 'wmic process call create',
]

/** DB 客户端命令前缀（sqlite3/psql/mysql/mongosh…——只有 DB 语境才查不可逆语句，避免误伤读文档等场景） */
const DB_CLIENT_RE = /\b(?:sqlite3|sqlite|psql|mysql|mariadb|mongosh|mongo|sqlcmd)\b/i

/** 不可逆语句：DROP TABLE/DATABASE/COLLECTION、TRUNCATE、mongosh 的 .drop() */
const IRREVERSIBLE_SQL_RE = /\b(?:drop\s+(?:table|database|collection)\b|truncate\b)|\.drop\s*\(\s*\)/i

/**
 * 不可逆数据库操作检测（任何模式拒绝——数据销毁不可逆，与系统级变更同档）。
 * 语句可能包在引号里（sqlite3 x.db "DROP TABLE t" / psql -c 'TRUNCATE x'），提取全部引号内容再匹配。
 */
function isIrreversibleDbCommand(cmd: string): boolean {
  if (!DB_CLIENT_RE.test(cmd)) return false
  const quoted = (cmd.match(/(["'`])(?:(?!\1)[\s\S])*?\1/g) ?? []).join(' ')
  return IRREVERSIBLE_SQL_RE.test(quoted)
}

/**
 * 递归检查内联代码（bash -c "bash -c ..." / 内联里执行脚本等嵌套形态）。
 * ① 代码本身是脚本执行 → 读文件扫描内容；② 代码含系统敏感模式 → 命中；③ 代码内再嵌 -c → 递归（限深 3）。
 */
function checkInlineCode(code: string, cwd: string, depth: number): string | null {
  if (depth > 3) return '嵌套过深，无法确认'
  const nestedScript = detectScriptExec(code)
  if (nestedScript) {
    const abs = /^\/|^[A-Za-z]:[\\/]/.test(nestedScript)
      ? nestedScript
      : require('node:path').resolve(cwd, nestedScript)
    try {
      return scanScriptContent(require('node:fs').readFileSync(abs, 'utf-8'))
    } catch { /* 脚本不可读 → 继续扫代码文本 */ }
  }
  const hit = scanScriptContent(code)
  if (hit) return hit
  // 代码内再嵌 -c/-e（bash -c "bash -c \"...\""）→ 递归
  const inner = /(?:\b(?:node|nodejs|python|python3|ruby|perl|php|bash|sh|zsh|dash|ksh)\s+-(?:e|c)\s+)(["'])([\s\S]*?)\1/.exec(code)
  if (inner) return checkInlineCode(inner[2] ?? '', cwd, depth + 1)
  return null
}

/**
 * 检测命令是否为「执行本地脚本」（解释器 + 脚本文件 / ./script）。
 * 返回脚本路径（相对 cwd 解析由调用方处理）；内联代码（-c/-e）与选项返回 null。
 * 防绕过：按 ; && | || 分段逐段检测（cd x && bash evil.sh）、剥离 env 前缀（x=1 bash evil.sh）。
 * 包管理器命令（npm run 等）不在此列——它们执行项目自有脚本，属信任通道。
 */
function detectScriptExec(cmd: string): string | null {
  const segments = cmd.split(/[;&|]{1,2}/)
  for (const seg of segments) {
    const s = seg.trim()
    if (!s) continue
    // 剥离 env 前缀（VAR=val ...）
    const stripped = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S+)\s+/, '')
    const m = stripped.match(/^(?:bash|sh|zsh|dash|ksh|node|nodejs|python|python3|ruby|perl|php|pwsh|powershell)\s+([^\s|;&><]+)/)
    if (m) {
      const arg = m[1]!
      if (arg.startsWith('-')) continue // 选项（-c/-e 等）→ 内联分支处理
      if (/\.(sh|bash|py|js|rb|pl|php)$/i.test(arg) || arg.startsWith('./') || arg.includes('/')) return arg
    } else {
      const direct = /^\.\/[^\s|;&><]+/.exec(stripped)
      if (direct) return direct[0]
    }
  }
  return null
}

/**
 * 静态扫描脚本/内联代码内容中的系统敏感模式（启发式监控层——防「写脚本再执行」绕过）。
 * 命中返回原因；未命中返回 null。只做模式匹配，不追求穷尽（复杂动态脚本无法静态判定，
 * 残余风险由「用户手动确认」兜底）。
 */
function scanScriptContent(content: string): string | null {
  const c = content.slice(0, 200 * 1024) // 扫描前 200KB，防超大脚本
  // 1. 系统级变更命令
  if (/\bsudo\b|\bsu\s+-/.test(c)) return 'sudo/su 提权'
  if (/\bdd\s+if=\/dev\//.test(c)) return 'dd 直接写设备'
  if (/\b(?:launchctl|systemctl|diskutil|mount|umount|mkfs|fdisk|parted|csrutil|nvram)\b/.test(c)) return '系统级管理命令'
  if (/\b(?:reg\s+add|reg\s+delete|diskpart|bcdedit|format)\b/.test(c)) return 'Windows 系统级命令'
  // 2. 写操作指向禁区路径（rm/mv/cp/tee/ln 后跟 /etc /usr 等系统核心，或 ~/.ssh 等凭据）
  //    注意：m 标志必须——$ 需匹配行尾（脚本多行时 rm -rf /etc\n 的换行会阻断无 m 的匹配）
  //    根级限定：系统目录段必须是路径开头（/etc、/Users/.../dev 里中间的 dev 段不算）——
  //    否则 rm /Users/amon/dev/... 这类「用户路径含 dev 段」会被误判为写系统 /dev
  if (/(?:^|[;&|\n])\s*(?:rm|mv|cp|tee|install|ln)\s+[^|;&\n]*?\/(?:etc|usr|System|bin|sbin|var|private|Windows)(?:\/|$)/m.test(c)) return '写系统核心目录'
  if (/(?:^|[;&|\n])\s*(?:rm|mv|cp|tee|install|ln)\s+(?:-\w+\s+)*\/dev(?:\/|\s|$)/m.test(c)) return '写系统核心目录(/dev)'
  if (/~\/\.(?:ssh|aws|gnupg|kube|docker)/.test(c)) return '操作凭据目录'
  if (/(?:^|[;&|\n])\s*(?:echo|printf|cat)\s+[^|;&\n]*>\s*\/etc\//m.test(c)) return '重定向写 /etc'
  // 3. 下载执行 / 混淆绕过
  if (/\b(?:curl|wget)\b[^|;&\n]*\|\s*(?:bash|sh|zsh)\b/.test(c)) return '下载脚本直接执行'
  if (/\beval\s*\(\s*["']?\$\(/.test(c)) return 'eval 命令替换'
  if (/base64\s+-d\s*[|>]/.test(c)) return 'base64 解码执行'
  return null
}

/** 路径是否在当前工作空间（cwd）内——相对路径按 cwd resolve 后判定 */
function isWithinCwd(p: string, cwd: string): boolean {
  const np = normalizePath(p)
  const nc = normalizePath(cwd)
  if (!np) return true // 空路径不拦截（交由上层）
  // 相对路径（./a.txt、a.txt、sub/b.txt）→ 以 cwd 为基准解析成绝对路径
  const abs = /^\/|^[A-Za-z]:/.test(np)
    ? np
    : normalizePath(require("node:path").resolve(nc, np))
  return abs === nc || abs.startsWith(nc + '/')
}

/** 从任意工具参数中提取「可能是路径」的字段值（MCP 工具禁区检查用）。
    覆盖常见路径键 + 以 path/uri/file 结尾的键 + 数组中的路径串 */
function extractPathArgs(input: Record<string, unknown>): string[] {
  const out: string[] = []
  const KEYS = new Set([
    'file_path', 'path', 'uri', 'url', 'destination', 'dest', 'target', 'source', 'src',
    'file', 'files', 'directory', 'dir', 'folder', 'workspace', 'root',
  ])
  for (const [k, v] of Object.entries(input)) {
    if (typeof v !== 'string') continue
    const kk = k.toLowerCase()
    if (KEYS.has(kk) || kk.endsWith('_path') || kk.endsWith('path') || kk.endsWith('_uri') || kk.endsWith('_url') || kk.endsWith('_file')) {
      out.push(v)
    }
  }
  // 数组参数里的路径串（如多文件操作）
  for (const v of Object.values(input)) {
    if (!Array.isArray(v)) continue
    for (const item of v) {
      if (typeof item === 'string' && /[/\\]/.test(item)) out.push(item)
    }
  }
  return out
}
