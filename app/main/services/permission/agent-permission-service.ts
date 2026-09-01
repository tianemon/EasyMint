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

import { randomUUID } from 'node:crypto'
import {
  SAFE_TOOLS,
  isSafeBashCommand,
  isDangerousCommand,
  hasDangerousStructure,
  isForbiddenWritePath,
  isForbiddenReadPath,
  isSystemForbidden,
  isSecretForbidden,
  isUserDirForbidden,
  extractPathsFromCommand,
  normalizePath,
} from './permission-rules'
import { readCache } from '../session-cache'

// ── 本地类型（替代 @proma/shared） ─────────────────

type DangerLevel = 'safe' | 'normal' | 'dangerous'

interface PermissionRequest {
  requestId: string
  sessionId: string
  toolName: string
  toolInput: Record<string, unknown>
  description: string
  command?: string
  dangerLevel: DangerLevel
  decisionReason?: string
  decisionReasonType?: string
  classifierApprovable?: boolean
  sdkDisplayName?: string
  sdkTitle?: string
  sdkDescription?: string
}

interface AskUserRequest {
  requestId: string
  sessionId: string
  question: string
  options?: Array<{ label: string; description: string }>
}

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

/** 待处理的权限请求 */
interface PendingPermission {
  resolve: (result: PermissionResult) => void
  request: PermissionRequest
}

/** 会话级白名单 */
interface SessionWhitelist {
  /** 总是允许的工具名（如 'Write', 'Edit'） */
  allowedTools: Set<string>
  /** 总是允许的 Bash 基础命令（如 'git push', 'npm install'） */
  allowedBashCommands: Set<string>
}

/**
 * Agent 权限服务
 *
 * 单例模式，管理所有会话的权限状态。
 */
export class AgentPermissionService {
  /** 待处理的权限请求 Map（requestId → PendingPermission） */
  private pendingPermissions = new Map<string, PendingPermission>()

  /** 会话级白名单 Map（sessionId → SessionWhitelist） */
  private sessionWhitelists = new Map<string, SessionWhitelist>()

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
    _sendToRenderer: (request: PermissionRequest) => void,
    _askUserHandler?: (sessionId: string, input: Record<string, unknown>, signal: AbortSignal, sendToRenderer: (request: AskUserRequest) => void) => Promise<PermissionResult>,
    _sendAskUserToRenderer?: (request: AskUserRequest) => void,
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
          return deny(`系统级变更命令（需用户手动执行，权限系统不代做系统级操作）：${cmd.slice(0, 100)}`)
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
        // 路径提取：含变量/命令替换 → 无法确认写入范围，保守拒绝（任何模式）
        const cmdPaths = extractPathsFromCommand(cmd)
        if (cmdPaths === null) {
          return deny(`命令含变量/命令替换，无法确认写入范围：${cmd.slice(0, 100)}（请改用显式路径）`)
        }
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
        // 禁区检查通过后：完全访问直接放行（可写项目外非禁止区）
        if (mode === 'full') return allow()
        // ── standard 附加：危险命令、危险结构、cwd 沙盒 ──
        if (isDangerousCommand(cmd)) return deny(`危险命令（标准模式拒绝，请切换「完全访问」并按需操作）：${cmd.slice(0, 120)}`)
        if (hasDangerousStructure(cmd)) {
          const redirPaths = extractRedirTargets(cmd)
          for (const p of redirPaths) {
            if (!isWithinCwd(p, cwd)) return deny(`标准模式仅可写工作空间内文件，重定向目标：${p}`)
          }
          // 危险结构但无重定向（如管道、&&）→ 标准模式保守拒绝
          if (redirPaths.length === 0) {
            return deny(`命令含管道/链接等危险结构（标准模式拒绝，请切换「完全访问」）：${cmd.slice(0, 120)}`)
          }
          return allow()
        }
        // 写类命令 cwd 沙盒（禁区已在上面检查）
        if (isWriteLikeCommand(cmd)) {
          const outside = cmdPaths.find((p) => !isWithinCwd(p, cwd))
          if (outside) return deny(`标准模式仅可操作工作空间内文件：${outside}（如需访问工作区外，请切换「完全访问」）`)
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
        if (!isWithinCwd(p, cwd)) return deny(`标准模式仅可操作工作空间内文件：${p}（如需访问工作区外，请切换「完全访问」）`)
      }
      // 其余工具（task/ask_user/use_skill 等 EM 工具）：标准模式放行
      return allow()
    }
  }

  /**
   * 响应权限请求（由 IPC handler 调用）
   *
   * @returns 对应的 sessionId，用于向渲染进程发送 resolved 事件；未找到请求时返回 null
   */
  respondToPermission(requestId: string, behavior: 'allow' | 'deny', alwaysAllow: boolean): string | null {
    const pending = this.pendingPermissions.get(requestId)
    if (!pending) return null

    const sessionId = pending.request.sessionId

    // "总是允许"选项：加入会话白名单
    if (alwaysAllow && behavior === 'allow') {
      this.addToWhitelist(sessionId, pending.request.toolName, pending.request.toolInput)
    }

    pending.resolve(
      behavior === 'allow'
        ? { behavior: 'allow' as const, updatedInput: pending.request.toolInput }
        : { behavior: 'deny' as const, message: '用户拒绝了此操作' }
    )
    this.pendingPermissions.delete(requestId)
    return sessionId
  }

  /**
   * 清除指定会话的所有待处理请求（会话结束或中止时调用）
   */
  clearSessionPending(sessionId: string): void {
    for (const [requestId, pending] of this.pendingPermissions) {
      if (pending.request.sessionId === sessionId) {
        pending.resolve({ behavior: 'deny' as const, message: '会话已结束' })
        this.pendingPermissions.delete(requestId)
      }
    }
  }

  /**
   * 获取当前所有待处理的权限请求（用于渲染进程重载后恢复状态）
   */
  getPendingRequests(): PermissionRequest[] {
    return [...this.pendingPermissions.values()].map((p) => p.request)
  }

  /**
   * 清除指定会话的白名单（会话结束时调用）
   */
  clearSessionWhitelist(sessionId: string): void {
    this.sessionWhitelists.delete(sessionId)
  }

  // ===== 工具分类判断 =====

  /**
   * 判断工具是否为只读操作（智能模式下自动允许）
   */
  private isReadOnlyTool(toolName: string, input: Record<string, unknown>): boolean {
    // 安全工具白名单（大小写不敏感：SDK 工具名 Read/read 混用）
    if (SAFE_TOOLS.some((s) => s.toLowerCase() === toolName.toLowerCase())) return true

    // Bash 工具：检查命令是否匹配安全模式
    if (toolName.toLowerCase() === 'bash') {
      const command = typeof input.command === 'string' ? input.command : ''
      return isSafeBashCommand(command)
    }

    return false
  }

  /**
   * 判断工具/命令是否在会话白名单中
   */
  private isWhitelisted(sessionId: string, toolName: string, input: Record<string, unknown>): boolean {
    const whitelist = this.sessionWhitelists.get(sessionId)
    if (!whitelist) return false

    // 非 Bash 工具：检查工具名是否在白名单中
    if (toolName !== 'Bash') {
      return whitelist.allowedTools.has(toolName)
    }

    // Bash 工具：即使基础命令在白名单中，也要重新检查完整命令的安全性
    const command = typeof input.command === 'string' ? input.command : ''
    if (hasDangerousStructure(command)) return false
    if (isDangerousCommand(command)) return false
    const baseCommand = this.extractBaseCommand(command)
    return whitelist.allowedBashCommands.has(baseCommand)
  }

  /**
   * 将工具/命令加入会话白名单
   */
  private addToWhitelist(sessionId: string, toolName: string, input: Record<string, unknown>): void {
    const whitelist = this.getOrCreateWhitelist(sessionId)

    if (toolName !== 'Bash') {
      whitelist.allowedTools.add(toolName)
    } else {
      const command = typeof input.command === 'string' ? input.command : ''
      const baseCommand = this.extractBaseCommand(command)
      if (baseCommand) {
        whitelist.allowedBashCommands.add(baseCommand)
      }
    }
  }

  /**
   * 获取或创建会话白名单
   */
  private getOrCreateWhitelist(sessionId: string): SessionWhitelist {
    const existing = this.sessionWhitelists.get(sessionId)
    if (existing) return existing

    const whitelist: SessionWhitelist = {
      allowedTools: new Set(),
      allowedBashCommands: new Set(),
    }
    this.sessionWhitelists.set(sessionId, whitelist)
    return whitelist
  }

  /**
   * 提取 Bash 命令的基础命令（用于白名单匹配）
   *
   * 提取前两个词（如 "git push"、"npm install"）或第一个词（如 "ls"）。
   */
  private extractBaseCommand(command: string): string {
    const parts = command.trim().split(/\s+/)
    // 两词组合命令（git push, npm install 等）
    if (parts.length >= 2 && ['git', 'npm', 'bun', 'yarn', 'pnpm'].includes(parts[0]!)) {
      return `${parts[0]} ${parts[1]}`
    }
    return parts[0] ?? ''
  }

  /**
   * 构建权限请求对象
   */
  private buildPermissionRequest(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions,
  ): PermissionRequest {
    const command = toolName === 'Bash' && typeof input.command === 'string'
      ? input.command
      : undefined

    return {
      requestId: randomUUID(),
      sessionId,
      toolName: options.displayName || toolName,
      toolInput: input,
      description: this.buildDescription(toolName, input),
      command,
      dangerLevel: this.assessDangerLevel(toolName, input),
      decisionReason: options.decisionReason,
      decisionReasonType: options.decisionReasonType,
      classifierApprovable: options.classifierApprovable,
      sdkDisplayName: options.displayName,
      sdkTitle: options.title,
      sdkDescription: options.description,
    }
  }

  /**
   * 生成人类可读的操作描述
   */
  private buildDescription(toolName: string, input: Record<string, unknown>): string {
    switch (toolName) {
      case 'Bash':
        return typeof input.command === 'string'
          ? `执行命令: ${input.command.slice(0, 200)}`
          : '执行 Bash 命令'
      case 'Write':
        return typeof input.file_path === 'string'
          ? `写入文件: ${input.file_path}`
          : '写入文件'
      case 'Edit':
        return typeof input.file_path === 'string'
          ? `编辑文件: ${input.file_path}`
          : '编辑文件'
      case 'NotebookEdit':
        return typeof input.notebook_path === 'string'
          ? `编辑 Notebook: ${input.notebook_path}`
          : '编辑 Notebook'
      case 'Task':
        return typeof input.description === 'string'
          ? `启动子任务: ${input.description}`
          : '启动子任务'
      case 'REPL':
        return typeof input.description === 'string'
          ? `执行 REPL: ${input.description}`
          : '执行 REPL 代码'
      case 'Workflow':
        return typeof input.name === 'string'
          ? `运行工作流: ${input.name}`
          : '运行工作流'
      case 'ScheduleWakeup':
        return typeof input.reason === 'string'
          ? `安排会话唤醒: ${input.reason}`
          : '安排会话唤醒'
      case 'Monitor':
        return typeof input.description === 'string'
          ? `启动监控任务: ${input.description}`
          : '启动监控任务'
      case 'PushNotification':
        return typeof input.message === 'string'
          ? `发送通知: ${input.message}`
          : '发送通知'
      default:
        return `使用工具: ${toolName}`
    }
  }

  /**
   * 评估操作的危险等级
   */
  private assessDangerLevel(toolName: string, input: Record<string, unknown>): DangerLevel {
    if (toolName === 'Bash') {
      const command = typeof input.command === 'string' ? input.command : ''
      if (isDangerousCommand(command)) return 'dangerous'
      if (hasDangerousStructure(command)) return 'normal'
      return 'normal'
    }

    // 文件写入操作默认为 normal
    if (['Write', 'Edit', 'NotebookEdit'].includes(toolName)) return 'normal'

    // Task 工具默认为 normal
    if (toolName === 'Task') return 'normal'

    // 新 SDK 的后台/定时/通知/脚本能力都可能产生会话外影响，需要明确审批
    if (['REPL', 'Workflow', 'ScheduleWakeup', 'Monitor', 'PushNotification', 'CronCreate', 'CronDelete', 'RemoteTrigger'].includes(toolName)) {
      return 'normal'
    }

    return 'normal'
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

/** 命令是否写类（含重定向、写命令前缀、编辑器直写） */
function isWriteLikeCommand(cmd: string): boolean {
  const c = cmd.trim().toLowerCase()
  if (/>+/.test(c)) return true
  return WRITE_COMMANDS.some((w) => c.startsWith(w))
}

/**
 * 系统级变更命令（任何模式拒绝——系统权限「该申请申请」，EM 不代做系统级操作，提示用户手动执行）。
 * 与「危险命令」不同：危险命令在标准模式拒、完全访问可（放宽文件范围）；系统级变更命令完全访问也不放。
 */
function isSystemMutationCommand(cmd: string): boolean {
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
  if (/(?:^|[;&|\n])\s*(?:rm|mv|cp|tee|install|ln)\s+[^|;&\n]*\/(?:etc|usr|System|bin|sbin|var|dev|private|Windows)(?:\/|$)/m.test(c)) return '写系统核心目录'
  if (/~\/\.(?:ssh|aws|gnupg|kube|docker)/.test(c)) return '操作凭据目录'
  if (/(?:^|[;&|\n])\s*(?:echo|printf|cat)\s+[^|;&\n]*>\s*\/etc\//m.test(c)) return '重定向写 /etc'
  // 3. 下载执行 / 混淆绕过
  if (/\b(?:curl|wget)\b[^|;&\n]*\|\s*(?:bash|sh|zsh)\b/.test(c)) return '下载脚本直接执行'
  if (/\beval\s*\(\s*["']?\$\(/.test(c)) return 'eval 命令替换'
  if (/base64\s+-d\s*[|>]/.test(c)) return 'base64 解码执行'
  return null
}

/** 提取重定向目标（> file / >> file） */
function extractRedirTargets(cmd: string): string[] {
  const out: string[] = []
  const re = />+[\s]*([^\s"'|;&]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cmd)) !== null) {
    if (m[1]) out.push(m[1])
  }
  return out
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
