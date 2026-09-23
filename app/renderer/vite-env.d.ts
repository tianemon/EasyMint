/// <reference types="vite/client" />

// monaco 语言 register 模块为副作用导入,无类型声明
declare module "monaco-editor/languages/definitions/*/register.js" {
  const _default: unknown;
  export default _default;
}
declare module "monaco-editor/languages/features/*/register.js" {
  const _default: unknown;
  export default _default;
}

// React 19 将 JSX namespace 移入模块作用域，此处补回全局声明
declare namespace JSX {
  type Element = import("react").ReactElement;
}

// ── 环境自检与依赖安装（env:*）────────────────────────────────────────────────
/** 与 main 的 provisioning/types.ts 对齐（渲染层不 import main，故在此镜像声明） */
interface EnvFixShape {
  /** pkg=包管理器（Linux，命令在 main 侧按发行版生成）；usernsProfile=加载 AppArmor profile；
   *  winInstall=srt 的 Windows 一次性装配 */
  auto?: { strategy: "pkg"; packages: string[] } | { strategy: "usernsProfile" } | { strategy: "winInstall" };
  /** command 可以是多行（\n 分隔的步骤），界面按多行展示、整体复制 */
  manual?: { command?: string; url?: string };
  sandboxOff?: boolean;
}
interface EnvItemShape {
  id: string;
  label: string;
  required: boolean;
  /** blocked=装了但被系统策略挡（如 Ubuntu 24.04 的 AppArmor）；unknown=探测失败，都不是"未安装" */
  status: "ok" | "missing" | "blocked" | "unknown";
  version?: string;
  /** 缺了它会影响什么功能（说能力，不说包名）；面板只在非 ok 时展示 */
  impact?: string;
  detail?: string;
  fix: EnvFixShape;
}
interface EnvReportShape {
  items: EnvItemShape[];
  distro: { id: string; idLike?: string[]; versionId?: string; autoInstallable: boolean };
  probedAt: number;
}
interface EnvInstallResultShape {
  ok: boolean;
  manualCommand?: string;
  reason?: string;
  exitCode?: number | null;
  report?: EnvReportShape;
}
interface EnvProgressShape {
  phase: "preparing" | "installing" | "verifying" | "done" | "failed";
  index: number;
  total: number;
  message?: string;
}

/** MCP 服务器配置（与 main/services/mcp-service.ts 的 McpServerConfig 对齐） */
interface McpServerCfg {
  type: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
  oauth?: boolean;
  callbackPort?: number;
}

interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
  status: "setup" | "development" | "completed";
  description: string;
  exists?: boolean;
}

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  modified?: boolean;
}

interface Session {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  lastActiveAt: string;
  sessionId: string;
  status: "active" | "completed";
}

interface Pin {
  id: string;
  content: string;
  title: string;
  x: number;
  y: number;
  width?: number;  // 缺省 320
  height?: number; // 缺省 auto（内容撑开）
  colorIdx?: number;    // 调色板索引 0-7
  minimized?: boolean;  // true = 贴纸态
  edge?: "left" | "right"; // 吸附边（minimized 时有效）
  createdAt: number;
}

// Pi SDK agent event stream types
/** 委派进度广播（agent:delegation-progress） */
interface DelegationProgressEvent {
  chatId?: string;
  delegationId: string;
  progress: {
    index: number;
    agent: string;
    status: "pending" | "running" | "completed" | "failed" | "aborted";
    task: string;
    description?: string;
    prompt?: string;
    taskId?: string;
    currentTool?: string;
    toolCount: number;
    durationMs: number;
    /** 子会话 jsonl 文件路径(查看 Agent 过程弹层定位用) */
    sessionFile?: string;
  };
}

/** 运行中委派快照项（agent:delegations IPC 返回，渲染层播种刷新后消失的委派卡片） */
interface DelegationSnapshotItem {
  delegationId: string;
  /** join activeChats 反查的 chatId（委派事件按 chatId 过滤，播种后凭它绑定门卫恢复事件流） */
  chatId?: string;
  startedAt: number;
  tasks: Array<{
    index: number;
    agent: string;
    task: string;
    title?: string;
    description?: string;
    prompt?: string;
    status: "pending" | "running" | "completed" | "failed" | "aborted";
  }>;
}

/** 子 Agent 实时流广播(agent:subagent-stream)——executor 转发子会话事件,弹层实时展示 */
interface SubagentStreamEvent {
  delegationId: string;
  index: number;
  sessionFile: string;
  ev: StreamEvent;
}

/** 后台 shell 实时输出广播(agent:shell-output)——registry 节流合并 chunk,查看弹层追加 */
interface ShellOutputEvent {
  id: string;
  chunk: string;
}

interface StreamEvent {
  seq: number;           // 全局单调递增，前端去重用
  runId: string;
  sessionId?: string;
  chatId?: string;       // event-bridge 注入（agent:stream 广播时设置）
  type: "message_start" | "message" | "turn_start" | "turn_end" | "thinking"
      | "tool_progress" | "tool_done" | "tool_result" | "compacting" | "compacted" | "error" | "context_usage" | "status" | "user_message" | "custom_event" | "entry_appended" | "session_info_changed" | "retry_state" | "queue_dropped";
  blocks?: Array<{ type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown>; thinking?: string }>;
  partial?: boolean;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolCallId?: string;
  /** tool_progress 的工具增量输出(事件桥从 partialResult 提取;bash 执行中实时输出) */
  deltaText?: string;
  /** tool_result 是否错误(toolResult 消息 isError) */
  isError?: boolean;
  /** tool_result 内容(主进程 event-bridge 转发,与 text 冗余兼容) */
  content?: string;
  /** tool_result 工具名(event-bridge 转发 toolName) */
  toolName?: string;
  /** user 消息文本(user_message 事件) */
  text?: string;
  /** user 消息落盘时间(委派完成通知等,前端按时间戳有序插入) */
  timestamp?: number;
  /** custom 消息类型(custom_event:system_message) */
  customType?: string;
  /** custom 消息元数据(custom_event:kind 细分) */
  details?: Record<string, unknown>;
  message?: string;
  canRetry?: boolean;
  operation?: "prompt" | "compaction";
  summary?: string;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number };
  /** 落盘条目 id（entry_appended 事件；气泡据此回填 ChatMessage.entryId） */
  entryId?: string;
  /** 条目消息角色（entry_appended 事件）——只发 user/assistant（对应前端 user / ai 气泡） */
  entryRole?: "user" | "assistant";
  /** 会话标题（session_info_changed 事件；SDK setSessionName 的回执，空 = 标题被清掉） */
  title?: string;
  /** 重试态阶段（retry_state 事件）：start = 进入退避等待；end = 重试链结束（成功/重试耗尽/被取消） */
  retryPhase?: "start" | "end";
  /** 第几次尝试（retry_state 事件） */
  retryAttempt?: number;
  /** 重试上限（retry_state start 事件；settings.retry.maxRetries，默认 3） */
  retryMaxAttempts?: number;
  /** 退避等待时长 ms（retry_state start 事件） */
  retryDelayMs?: number;
  /** 本次重试链是否成功（retry_state end 事件；false 时 message = 最终错误原文或「Retry cancelled」） */
  retrySuccess?: boolean;
  /** 打断时被丢弃的未投递插话原文（queue_dropped 事件） */
  queueDropped?: string[];
  percentage?: number;
  data?: Record<string, unknown>;
  source?: "worker" | "evaluator" | "chat";
  /** 群聊消息的 Agent 角色(群聊视图标注来源;user 为用户消息) */
  agentRole?: string;
  /** 群聊转发消息标记(该回合由其他 Agent 转发触发) */
  forwarded?: boolean;
  /** 群聊转发来源 Agent 角色(前端显示 [A → B]) */
  forwardedFrom?: string;
  /** 群聊会话 ID(前端群聊 ChatPanel 按此过滤事件) */
  groupId?: string;
}

interface ElectronAPI {
  platform: string;
  window: {
    openProject: (projectId: string, sessionId?: string, init?: boolean) => Promise<void>;
    newWindow: () => Promise<void>;
  };
  editor: {
    open: (filePath?: string) => Promise<void>;
    onOpenPrototype: (callback: (data: { projectPath: string }) => void) => () => void;
  };
  dialog: {
    openDirectory: () => Promise<string | null>;
  };
  project: {
    list: () => Promise<Project[]>;
    create: (opts: { name: string; path: string }) => Promise<Project>;
    checkDir: (dir: string, name: string) => Promise<{ conflict: boolean }>;
    openedInWindows: () => Promise<string[]>;
    delete: (id: string) => Promise<void>;
    get: (id: string) => Promise<Project | undefined>;
    update: (id: string, patch: { name?: string; path?: string }) => Promise<Project | undefined>;
    import: (dirPath: string) => Promise<Project & { isNew: boolean }>;
    renameExec: (oldPath: string, newName: string) => Promise<{ ok: boolean; error?: string }>;
    saveProfile: (projectPath: string, platformSpec: string) => Promise<{ ok: boolean; error?: string }>;
  };
  file: {
    readTree: (dirPath: string) => Promise<FileNode[]>;
    readContent: (filePath: string) => Promise<{ ok: true; content: string } | { ok: false; reason: "missing" | "outside-project" }>;
    writeContent: (filePath: string, content: string) => Promise<void>;
    createFile: (filePath: string, content?: string) => Promise<void>;
    createFolder: (dirPath: string) => Promise<void>;
    saveUpload: (name: string, data: Uint8Array) => Promise<{ path: string; dataUrl: string }>;
    readUpload: (filePath: string) => Promise<string | null>;
    readImage: (filePath: string) => Promise<string | null>;
  };
  todos: {
    list: (projectPath: string) => Promise<{ ok: boolean; error?: string; data?: { todos: Array<{ id: number; title: string; note?: string; status: "open" | "done"; createdAt: number; doneAt: number | null }>; migrated?: boolean; migratedCount?: number } }>;
    add: (projectPath: string, title: string, note?: string) => Promise<{ ok: boolean; error?: string }>;
    update: (projectPath: string, id: number, title?: string, note?: string) => Promise<{ ok: boolean; error?: string }>;
    toggle: (projectPath: string, id: number) => Promise<{ ok: boolean; error?: string }>;
    remove: (projectPath: string, id: number) => Promise<{ ok: boolean; error?: string }>;
    onChanged: (callback: (data: { projectPath: string }) => void) => () => void;
  };
  agent: {
    runWorker: (projectPath: string, prompt: string) => Promise<{ runId: string }>;
    sendMessage: (projectPath: string, message: string, opts?: { sessionId?: string | null; permissionMode?: string; model?: string; isDesigner?: boolean; images?: Array<{ type: "image"; data: string; mimeType: string }>; thinkingLevel?: string; systemPayload?: { customType: string; content: string; display: boolean; details: Record<string, unknown> }; preferredProvider?: string; tabId?: string }) => Promise<{ chatId: string; sessionId: string }>;
    steer: (sessionId: string, text: string, images?: Array<{ type: "image"; data: string; mimeType: string }>, tabId?: string) => Promise<void>;
    stopDelegation: (delegationId: string, taskIndex: number) => Promise<void>;
    getDelegations: (sessionId: string) => Promise<DelegationSnapshotItem[]>;
    /** 运行态快照（渲染层挂载/刷新时拉取一次；广播不重播，不拉取会空白） */
    getRunningState: () => Promise<{
      delegations: { count: number; tasks: Array<{ delegationId: string; index: number; title: string; sessionId?: string }> };
      shells: Array<{ id: string; command: string; startedAt: number; status: "running" | "stopping"; logPath: string; sessionId?: string }>;
    }>;
    stopShell: (shellId: string) => Promise<void>;
    followUp: (sessionId: string, text: string) => Promise<void>;
    compact: (sessionId: string, instructions?: string) => Promise<void>;
    activate: (sessionId: string, projectPath: string) => Promise<string | null>;
    setThinkingLevel: (sessionId: string, level: string) => Promise<void>;
    cycleModel: (sessionId: string, direction?: "forward" | "backward") => Promise<void>;
    setActiveTools: (sessionId: string, toolNames: string[]) => Promise<void>;
    respondAsk: (requestId: string, answers: Array<{ questionId: string; values: string[] }> | null) => Promise<unknown>;
    onAskRequest: (callback: (data: any) => void) => () => void;
    onAskClosed: (callback: (data: { requestId: string }) => void) => () => void;
    onTodos: (callback: (data: { sessionId: string; todos: Array<{ content: string; status: "pending" | "in_progress" | "completed"; startedAt?: number; waiting?: boolean }> }) => void) => () => void;
    abort: (runId: string, opts?: { clearQueue?: boolean; rewind?: boolean }) => Promise<{ rewound: boolean; stopTimedOut?: boolean }>;
    /** 按节点撤回（编辑消息/重新生成用）：不依赖运行中的回合；失败返回可读 error（目标非法/回合中/压缩中）
     *  target="prompt"：把 entryId 当「某条回答」，主进程沿 parentId 定位所属提问并撤回它，
     *  返回 promptEntryId（提问条目 id）供渲染层找到那条提问气泡复用重发 */
    rewindToNode: (sessionId: string, entryId: string, target?: "entry" | "prompt", projectPath?: string) => Promise<{ ok: boolean; error?: string; promptEntryId?: string }>;
    /** 单条消息移出（inContext=false）/ 恢复（true）模型上下文——轻档，只改会话投影、
     *  不影响它之后的对话（与 rewindToNode 的级联撤回是轻/重两档）；失败返回可读 error */
    setEntryInContext: (sessionId: string, entryId: string, inContext: boolean, projectPath?: string) => Promise<{ ok: boolean; error?: string }>;
    imageRetryCandidates: (sessionId: string, failedEntryId: string, projectPath?: string) => Promise<{ ok: boolean; error?: string; candidates?: Array<{ entryId: string; imageCount: number; encodedBytes: number; preview: string; timestamp: number }> }>;
    contextImageStats: (sessionId: string, projectPath?: string) => Promise<{ ok: boolean; error?: string; candidates?: Array<{ entryId: string; imageCount: number; encodedBytes: number; preview: string; timestamp: number }>; encodedBytes?: number; maxRequestBytes?: number }>;
    removeContextImages: (sessionId: string, selectedEntryIds: string[], projectPath?: string) => Promise<{ ok: boolean; error?: string; reloadRequired?: boolean; removedBytes?: number; removedImages?: number }>;
    prepareImageRetry: (sessionId: string, failedEntryId: string, selectedEntryIds: string[], omitCurrentImages: boolean, projectPath?: string) => Promise<{ ok: boolean; error?: string; reloadRequired?: boolean; removedBytes?: number; removedImages?: number }>;
    setModel: (sessionId: string, model: string, provider?: string) => Promise<void>;
    spawnAgentChat: (projectPath: string, templateId: string, message: string) => Promise<{ chatId: string }>;
    chatStatus: (sessionId: string) => Promise<string | null>;
    /** 忙碌态兜底：busy=主进程登记的占用态（唯一判据），sdkIdle 仅供日志排查 */
    busyState: (sessionId: string) => Promise<{ busy: boolean; sdkIdle: boolean }>;
    getPiProviders: () => Promise<Array<{ id: string; name: string; baseUrl?: string }>>;
    getPiModels: (providerName: string) => Promise<Array<{ id: string; name: string; contextWindow: number }>>;
    /** 供应商级静态参数：官方名 / 官方 Base URL / 接入协议（内置供应商只读展示用） */
    getPiProviderInfo: (providerName: string) => Promise<{ name: string; baseUrl?: string; apis: string[] } | null>;
    getThinkingLevels: (sessionId: string) => Promise<{ level?: string; available?: string[] } | null>;
    getModelThinkingSupport: (modelId: string) => Promise<string[] | null>;
    /** 按模型 id（含自添加/官方）查模型定义：providerId 缺省用激活供应商 */
    getModelInfo: (modelId: string, providerId?: string) => Promise<{ name: string; contextWindow: number; maxTokens: number } | null>;
    sessionStats: (sessionId: string, projectPath?: string) => Promise<Record<string, unknown> | null>;
    getBufferedStream: (sessionId: string) => Promise<unknown[]>;
    killChat: (chatId: string) => Promise<void>;
    killSession: (sessionId: string) => Promise<void>;
    activeSessions: () => Promise<string[]>;
    reclaimChat: (sessionId: string) => Promise<void>;
    cancelReclaim: (sessionId: string) => Promise<void>;
    onChatClosed: (callback: (data: { sessionId: string }) => void) => () => void;
    scheduleIdleTimeout: (sessionId: string, delayMs: number) => void;
    onStream: (callback: (event: StreamEvent) => void) => () => void;
    onStderr: (callback: (data: { runId: string; data: string; timestamp: number }) => void) => () => void;
    onConfirmDev: (callback: () => void) => () => void;
    onExit: (callback: (data: { runId: string; code: number }) => void) => () => void;
    onDelegationProgress: (callback: (data: DelegationProgressEvent) => void) => () => void;
    onDelegationInit: (callback: (data: {
      chatId?: string;
      delegationId: string;
      tasks: Array<{
        index: number;
        agent: string;
        status: "pending" | "running" | "completed" | "failed" | "aborted";
        task: string;
        title?: string;
        description?: string;
        prompt?: string;
      }>;
    }) => void) => () => void;
    onSubagentStream: (callback: (data: SubagentStreamEvent) => void) => () => void;
    onDelegationCount: (callback: (data: { count: number; tasks: { delegationId: string; index: number; title: string }[] }) => void) => () => void;
    onShellCount: (callback: (data: { id: string; command: string; startedAt: number; status: "running" | "stopping"; logPath: string }[]) => void) => () => void;
    onShellOutput: (callback: (data: ShellOutputEvent) => void) => () => void;
    onChatSession: (callback: (data: { chatId: string; sessionId: string; tabId?: string; projectPath?: string }) => void) => () => void;
    onContextSummarizing: (callback: (data: { chatId: string; sessionId?: string; type?: string }) => void) => () => void;
    onContextRotated: (callback: (data: { chatId: string; sessionId: string }) => void) => () => void;
    onContextUsage: (callback: (data: { chatId: string; percentage: number | null; totalTokens: number; maxTokens: number }) => void) => () => void;
    onTaskStatus: (callback: (data: { taskId: string; status: string; projectPath: string }) => void) => () => void;
    onCommandsChanged: (callback: (data: { commands: Array<{ name: string; description: string; argumentHint: string; aliases?: string[] }> }) => void) => () => void;
    onRenameProgress: (callback: (data: { phase: string }) => void) => () => void;
    onSessionRenamed: (callback: (data: { sessionId: string; title: string }) => void) => () => void;
    onModelChanged: (callback: (data: { sessionId: string; model: string }) => void) => () => void;
    onThinkingLevelChanged: (callback: (data: { sessionId: string; level: string; available?: string[] }) => void) => () => void;
    onPermissionModeChanged: (callback: (data: { sessionId: string; mode: "readonly" | "standard" | "full" }) => void) => () => void;
  };
  device: {
    getSelf: () => Promise<{ id: string; name: string; discoverable: boolean }>;
    listPaired: () => Promise<Array<{ id: string; name: string; key: string; pairedAt: number; lastSeen: number; online: boolean }>>;
    listDiscovered: () => Promise<Array<{ id: string; name: string; address: string; port: number }>>;
    setName: (name: string) => Promise<void>;
    startPair: () => Promise<void>;
    stopPair: () => Promise<void>;
    manualScan: () => Promise<void>;
    requestPair: (peer: { id: string; name: string; address: string; port: number }) => Promise<{ ok: boolean; error?: string }>;
    acceptPair: (peer: { id: string; name: string; address: string; port: number }) => Promise<{ ok: boolean; error?: string }>;
    unpair: (id: string) => Promise<void>;
    connect: (id: string) => Promise<{ ok: boolean; error?: string }>;
    sendMessage: (id: string, message: Record<string, unknown>) => Promise<{ ok: boolean }>;
    onPairRequest: (cb: (req: { id: string; name: string; address: string; port: number }) => void) => () => void;
    onChanged: (cb: () => void) => () => void;
    onOnline: (cb: (d: { id: string }) => void) => () => void;
    onOffline: (cb: (d: { id: string }) => void) => () => void;
  };
  mobileTerminal: {
    createOffer: () => Promise<{
      uri: string;
      token: string;
      pcId: string;
      pcName: string;
      addresses: string[];
      port: number;
      publicKey: string;
      expiresAt: number;
    }>;
    listDevices: () => Promise<Array<{
      id: string;
      name: string;
      pairedAt: number;
      lastSeen: number;
      online: boolean;
    }>>;
    listPending: () => Promise<Array<{
      requestId: string;
      deviceId: string;
      deviceName: string;
      verificationCode: string;
      expiresAt: number;
    }>>;
    acceptPair: (requestId: string) => Promise<{ ok: boolean }>;
    rejectPair: (requestId: string) => Promise<{ ok: boolean }>;
    revoke: (deviceId: string) => Promise<{ ok: boolean }>;
    onPairRequest: (callback: (data: unknown) => void) => () => void;
    onChanged: (callback: () => void) => () => void;
    onError: (callback: (data: { message: string }) => void) => () => void;
  };
  migration: {
    accept: (transferId: string, targetPath: string) => Promise<{ ok: boolean; error?: string }>;
    reject: (transferId: string) => Promise<{ ok: boolean }>;
    start: (projectPath: string, deviceId: string, selection?: { files: string[]; sessions: string[] }) => Promise<{ ok: boolean; transferId?: string; error?: string }>;
    scan: (projectPath: string) => Promise<{ files: Array<{ relPath: string; absPath: string; size: number; excluded: boolean }>; sessions: Array<{ file: string; name: string; mtime: number }>; totalSize: number; excludedCount: number }>;
    getIgnore: () => Promise<string>;
    saveIgnore: (content: string) => Promise<{ ok: boolean }>;
    resetIgnore: () => Promise<string>;
    onIncoming: (cb: (d: { transferId: string; fromName: string; projectName: string; fileCount: number; totalSize: number; sessionCount: number }) => void) => () => void;
    onCompleted: (cb: (d: { projectName: string; projectPath: string; originPath: string; fromName: string; sessionRestoredCount: number }) => void) => () => void;
    onReceipt: (cb: (d: { ok: boolean; projectName?: string; projectPath?: string; failures?: string[] }) => void) => () => void;
    onProgress: (cb: (d: { transferId: string; received: number }) => void) => () => void;
    onSendProgress: (cb: (d: { transferId: string; sent: number; total: number; phase?: "scanning" | "packing" | "waiting" | "transferring" | "sent" | "rejected" | "timeout" }) => void) => () => void;
    onStage: (cb: (d: { transferId: string; stage: "verify" | "extract" | "session" | "done"; sessionRestoredCount?: number }) => void) => () => void;
  };
  onFirewallHint: (cb: (d: { port: number }) => void) => () => void;
  task: {
    read: (projectPath: string) => Promise<{ tasks: { id: string; title: string; description: string; command: string; status: string; attempts: number }[] }>;
    getSubagentMessages: (sessionFile: string) => Promise<{ type: string; message: unknown }[]>;
  };
  shell: {
    exec: (projectPath: string, command: string) => Promise<{ code: number | null }>;
    onStdout: (callback: (data: { line: string }) => void) => () => void;
    onStderr: (callback: (data: { line: string }) => void) => () => void;
    readLog: (logPath: string) => Promise<{ content: string; truncated: boolean }>;
    revealInFolder: (filePath: string) => Promise<void>;
  };
  skill: {
    list: (projectPath?: string) => Promise<{ name: string; description: string; path: string; level: "builtin" | "global" | "project"; source: "builtin" | "authored" | "imported" | "managed"; enabled: boolean; managedRoot?: string; shadowed?: boolean }[]>;
    get: (skillPath: string) => Promise<{ name: string; description: string; path: string; level: "builtin" | "global" | "project"; source: "builtin" | "authored" | "imported" | "managed"; enabled: boolean; shadowed?: boolean; body: string } | null>;
    toggle: (name: string, enabled: boolean) => Promise<void>;
    createManaged: (name: string, description: string, body: string, projectPath?: string) => Promise<{ ok: boolean; error?: string; shadowed?: boolean }>;
    updateManaged: (name: string, description?: string, body?: string) => Promise<{ ok: boolean; error?: string; shadowed?: boolean }>;
    deleteManaged: (name: string) => Promise<{ ok: boolean; error?: string; shadowed?: boolean }>;
    delete: (skillPath: string, projectPath?: string) => Promise<{ ok: boolean; error?: string }>;
    getStats: () => Promise<Record<string, { usageCount: number; lastUsedAt: number; failCount: number }>>;
    import: (source: string, name?: string, overwrite?: boolean) => Promise<{ ok: boolean; error?: string; name?: string; path?: string }>;
  },
  mcp: {
    list: (projectPath?: string) => Promise<{ name: string; type: "stdio" | "http" | "sse"; command?: string; args?: string[]; url?: string; enabled: boolean; scope: "user" | "project" | "project-compat"; writable: boolean; pendingApproval?: boolean }[]>;
    toggle: (name: string, enabled: boolean) => Promise<void>;
    requiredKeys: () => Promise<Record<string, Record<string, string>>>;
    save: (name: string, cfg: McpServerCfg, scope?: "user" | "project" | "project-compat", projectPath?: string) => Promise<{ ok: boolean; error?: string; overwritten?: boolean }>;
    delete: (name: string, scope?: "user" | "project" | "project-compat", projectPath?: string) => Promise<{ ok: boolean; error?: string }>;
    get: (name: string, scope?: "user" | "project" | "project-compat", projectPath?: string) => Promise<McpServerCfg | null>;
    configPath: () => Promise<string>;
    status: (projectPath?: string) => Promise<{ name: string; state: "connected" | "connecting" | "failed" | "disabled" | "pending"; toolCount?: number; error?: string }[]>;
    test: (cfg: McpServerCfg) => Promise<{ ok: boolean; error?: string; toolCount?: number }>;
    retry: (name: string, projectPath?: string) => Promise<{ ok: boolean; error?: string }>;
    approve: (name: string, projectPath: string) => Promise<void>;
    importText: (text: string) => Promise<{ ok: boolean; error?: string; message?: string; notes?: string[] }>;
  },
  upload: {
    stats: (sortBy?: "time" | "size") => Promise<{ totalSize: number; fileCount: number; files: { name: string; size: number; created: number; isImage: boolean }[] }>;
    clean: (filenames: string[]) => Promise<number>;
    cleanAll: () => Promise<number>;
    openDir: () => Promise<void>;
  },
  issue: {
    list: (projectPath: string) => Promise<Array<{ id: string; title: string; module: string; status: "open" | "fixed"; createdAt: number }>>;
    add: (projectPath: string, title: string, module: string) => Promise<{ id: string; title: string; module: string; status: "open" | "fixed"; createdAt: number }>;
    setStatus: (projectPath: string, id: string, status: "open" | "fixed") => Promise<void>;
    update: (projectPath: string, id: string, patch: { title?: string; module?: string }) => Promise<void>;
    delete: (projectPath: string, id: string) => Promise<void>;
  };
  tab: {
    save: (data: { tabs: Array<{ id: string; type: string; title: string; filePath?: string; sessionId?: string; groupId?: string }>; activeTabId: string | null }) => Promise<void>;
    restore: () => Promise<{ tabs: Array<{ id: string; type: string; title: string; filePath?: string; sessionId?: string; groupId?: string }>; activeTabId: string | null } | null>;
  };
  process: {
    detect: (projectPath: string) => Promise<Array<{ id: string; platform: string; label: string; run_command: string; cwd?: string; install_command?: string; url?: string }>>;
    saveRunJson: (projectPath: string, runnables: Array<{ id?: string; platform: string; label: string; run_command: string; cwd?: string; install_command?: string; url?: string }>) => Promise<void>;
    start: (projectPath: string, commandId: string, port?: number) => Promise<void>;
    stop: (commandId: string) => Promise<void>;
    restart: (projectPath: string, commandId: string) => Promise<void>;
    status: (commandId: string) => Promise<{ running: boolean; pid?: number; run_command?: string; output: string[]; ready?: boolean }>;
    askRepair: (projectPath: string, summary: string) => Promise<boolean>;
    runningIds: () => Promise<string[]>;
    checkPort: (port: number) => Promise<{ free: boolean; pid?: number; name?: string }>;
    killPort: (port: number) => Promise<boolean>;
    onOutput: (callback: (data: { commandId: string; line: string; stream: string }) => void) => () => void;
    onStatusChanged: (callback: (data: { commandId: string; running: boolean; ready?: boolean }) => void) => () => void;
    onRunJsonChanged: (callback: () => void) => () => void;
  };
  evaluator: {
    isEnabled: () => Promise<boolean>;
    setEnabled: (enabled: boolean) => Promise<void>;
  };
  git: {
    detect: () => Promise<{ found: boolean; version?: string }>;
  };
  nodeRuntime: {
    detect: () => Promise<{ found: boolean; version?: string }>;
  };
  codegraph: {
    detect: () => Promise<{ found: boolean; version?: string; reason?: "not-found" | "probe-error" }>;
  };
  env: {
    /** 环境自检（只读） */
    probe: () => Promise<EnvReportShape>;
    /** 重新检测：重置沙盒失败缓存后再探测（装完依赖点它即可生效，不必重启） */
    retest: () => Promise<EnvReportShape>;
    /** 安装缺失项（id 白名单在 main 侧；进度走 onProgress） */
    install: (ids: string[]) => Promise<EnvInstallResultShape>;
    /** 「一键修复」bwrap 的 userns 放行（不带参数；命令全在 main 侧常量表里） */
    fixUserns: () => Promise<EnvInstallResultShape>;
    cancel: () => Promise<void>;
    onProgress: (cb: (ev: EnvProgressShape) => void) => () => void;
    /** 启动自检结果（侧边栏红点） */
    onReport: (cb: (report: EnvReportShape) => void) => () => void;
  };
  conv: {
    list: (projectPath: string) => Promise<{ sessionId: string; title: string; createdAt: number; updatedAt: number; pinnedAt?: number }[]>;
	    listDesign: (projectPath: string) => Promise<{ sessionId: string; title: string; createdAt: number; updatedAt: number; pinnedAt?: number }[]>;
    get: (id: string, projectPath: string) => Promise<{ sessionId: string; title: string; createdAt: number; updatedAt: number; pinnedAt?: number } | null>;
    messages: (id: string, projectPath: string) => Promise<{ type: string; uuid: string; session_id: string; message: unknown; parent_tool_use_id: string | null; out_of_context?: boolean; image_stripped?: boolean }[]>;
    rename: (id: string, title: string, projectPath: string) => Promise<void>;
    designSessions: () => Promise<string[]>;
    delete: (id: string, projectPath: string) => Promise<void>;
    togglePin: (id: string) => Promise<boolean>;
    archiveSession: (sessionId: string) => Promise<void>;
    unarchiveSession: (sessionId: string) => Promise<void>;
  };
  pin: {
    get: (sessionId: string) => Promise<Pin[]>;
    set: (sessionId: string, pins: Pin[]) => Promise<void>;
  };
  win: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    onMaximizedChanged: (callback: (maximized: boolean) => void) => () => void;
  };
  session: {
    list: (projectId: string) => Promise<Session[]>;
    resume: (sessionId: string) => void;
    create: (projectId: string, title: string) => Promise<Session>;
    delete: (projectId: string, sessionId: string) => Promise<void>;
  };
  sessionCache: {
    read: (sessionId: string) => Promise<{ permissionMode: string; model?: string; provider?: string; thinkingLevel?: string; contextUsage: number | null; updatedAt: number } | null>;
    write: (sessionId: string, data: Record<string, unknown>) => Promise<void>;
    delete: (sessionId: string) => Promise<void>;
  };
  systemPrompt: {
    getConfig: () => Promise<{ prompts: { id: string; name: string; content: string; isBuiltin: boolean; createdAt: number; updatedAt: number }[]; defaultPromptId?: string }>;
    create: (input: { name: string; content: string }) => Promise<{ id: string; name: string; content: string; isBuiltin: boolean; createdAt: number; updatedAt: number }>;
    update: (id: string, input: { name?: string; content?: string }) => Promise<{ id: string; name: string; content: string; isBuiltin: boolean; createdAt: number; updatedAt: number }>;
    delete: (id: string) => Promise<void>;
    setDefault: (id: string) => Promise<void>;
  };
  settings: {
    piImport: (input?: { sourceDir?: string; apply?: boolean; probe?: boolean }) => Promise<import("@shared/pi-config-import").PiImportSummary>;
    get: () => Promise<{
      nativeConfigMigration?: { migratedAt: string; duplicateConfigIds: string[] };
      defaultProjectDir?: string; setupComplete?: boolean;
      apiKeys?: Record<string, string>; model?: string;
      manageSkillEnabled?: boolean;
      learnEnabled?: boolean;
      importExternalSkills?: boolean;
      availableModels?: string[]; contextThreshold?: number;
      chatThinkingLevel?: string;
      chatPermissionMode?: "standard" | "full";
      sandboxDisabled?: boolean;
      chatFontLevel?: number;
      chatFontScale?: number;
      uiFontScale?: number;
      glowEffect?: "orbit" | "slide" | "breathe" | "off";
      glowColorMode?: "solid" | "multi";
      glowColorLight?: string;
      glowColorDark?: string;
      glowGroupsLight?: Array<{ id: string; name: string; colors: string[]; isBuiltin?: boolean }>;
      glowGroupsDark?: Array<{ id: string; name: string; colors: string[]; isBuiltin?: boolean }>;
      activeGlowGroupLight?: string;
      activeGlowGroupDark?: string;
      statusTextStyle?: "solid" | "shimmer";
      statusColorLight?: string;
      statusColorDark?: string;
      statusTextGroupsLight?: Array<{ id: string; name: string; colors: string[]; isBuiltin?: boolean }>;
      statusTextGroupsDark?: Array<{ id: string; name: string; colors: string[]; isBuiltin?: boolean }>;
      activeStatusGroupLight?: string;
      activeStatusGroupDark?: string;
      apiProviders?: import("@shared/platform-presets").ApiProvidersData;
    }>;
    set: (key: string, value: unknown) => Promise<void>;
    setLastProject: (projectId: string) => Promise<void>;
    testProvider: (input: { baseUrl: string }) => Promise<import("@shared/provider-test").ProviderTestResult>;
    fetchBalance: () => Promise<{ balance_infos?: { currency: string; total_balance: string; granted_balance: string }[] }>;
  };
  /** 供应商账号登录（OAuth）：凭据落盘与刷新在 SDK，这里只驱动流程与查状态 */
  provider: {
    authStatus: (providerIds?: string[]) => Promise<Array<import("@shared/provider-auth").ProviderAuthStatus>>;
    authLogin: (providerId: string, requestId: string) => Promise<import("@shared/provider-auth").ProviderLoginResult>;
    authLogout: (providerId: string) => Promise<import("@shared/provider-auth").ProviderLoginResult>;
    authInput: (requestId: string, value: string) => Promise<boolean>;
    authCancel: (requestId: string) => Promise<boolean>;
    openAuthUrl: (url: string) => Promise<boolean>;
    onAuthEvent: (callback: (data: import("@shared/provider-auth").ProviderAuthEventMessage) => void) => () => void;
  };
  agentTemplates: {
    list: () => Promise<{ id: string; name: string; description: string; prompt: string; agentType: string }[]>;
    create: (input: { name: string; description: string; prompt: string; agentType?: string }) => Promise<{ id: string; name: string; description: string; prompt: string; agentType: string }>;
    update: (id: string, input: { name?: string; description?: string; prompt?: string; agentType?: string }) => Promise<{ id: string; name: string; description: string; prompt: string; agentType: string }>;
    delete: (id: string) => Promise<void>;
  };
  app: {
    getVersion: () => Promise<string>;
    checkUpdate: () => Promise<boolean>;
    installUpdate: () => Promise<boolean>;
    hasUpdate: () => Promise<{ hasUpdate: boolean; version: string | null }>;
    clearUpdateCache: () => Promise<{ cleaned: string[]; errors: string[] }>;
    updateCacheSize: () => Promise<number>;
    openUpdateCache: () => Promise<void>;
    /** 更新状态广播。errorMessage / errorPhase 仅在 status === "error" 时有值（errorPhase 区分检测/下载阶段） */
    onUpdateStatus: (callback: (data: { status: string; version?: string; percent?: number; transferred?: number; totalSize?: number; errorMessage?: string; errorPhase?: "check" | "download" }) => void) => () => void;
  };
  /** 主题上报：macOS 下主进程据此切换 Dock 图标（其它平台忽略） */
  appearance: {
    setEffective: (theme: "light" | "dark") => Promise<{ ok: boolean }>;
  };
}

interface Window {
  electronAPI: ElectronAPI;
}
