/// <reference types="vite/client" />

// React 19 将 JSX namespace 移入模块作用域，此处补回全局声明
declare namespace JSX {
  type Element = import("react").ReactElement;
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
    taskId?: string;
    currentTool?: string;
    toolCount: number;
    durationMs: number;
    /** 子会话 jsonl 文件路径(查看 Agent 过程弹层定位用) */
    sessionFile?: string;
  };
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
      | "tool_progress" | "tool_done" | "compacting" | "compacted" | "error" | "context_usage" | "status" | "user_message" | "custom_event";
  blocks?: Array<{ type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown>; thinking?: string }>;
  partial?: boolean;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolCallId?: string;
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
  summary?: string;
  usage?: { inputTokens: number; outputTokens: number };
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
    delete: (id: string) => Promise<void>;
    get: (id: string) => Promise<Project | undefined>;
    update: (id: string, patch: { name?: string; path?: string }) => Promise<Project | undefined>;
    import: (dirPath: string) => Promise<Project & { isNew: boolean }>;
    renameExec: (oldPath: string, newName: string) => Promise<{ ok: boolean; error?: string }>;
    checkInitStatus: (projectPath: string) => Promise<{ done: boolean; reason: string }>;
    saveProfile: (projectPath: string, platformSpec: string) => Promise<{ ok: boolean; error?: string }>;
  };
  file: {
    readTree: (dirPath: string) => Promise<FileNode[]>;
    readContent: (filePath: string) => Promise<string>;
    writeContent: (filePath: string, content: string) => Promise<void>;
    createFile: (filePath: string, content?: string) => Promise<void>;
    createFolder: (dirPath: string) => Promise<void>;
    saveUpload: (name: string, data: Uint8Array) => Promise<{ path: string; dataUrl: string }>;
    readUpload: (filePath: string) => Promise<string | null>;
  };
  agent: {
    runWorker: (projectPath: string, prompt: string) => Promise<{ runId: string }>;
    sendMessage: (projectPath: string, message: string, opts?: { sessionId?: string | null; permissionMode?: string; model?: string; isDesigner?: boolean; images?: Array<{ type: "image"; data: string; mimeType: string }>; thinkingLevel?: string; systemPayload?: { customType: string; content: string; display: boolean; details: Record<string, unknown> }; preferredProvider?: string }) => Promise<{ chatId: string }>;
    steer: (sessionId: string, text: string) => Promise<void>;
    stopDelegation: (delegationId: string, taskIndex: number) => Promise<void>;
    stopShell: (shellId: string) => Promise<void>;
    followUp: (sessionId: string, text: string) => Promise<void>;
    compact: (sessionId: string, instructions?: string) => Promise<void>;
    setThinkingLevel: (sessionId: string, level: string) => Promise<void>;
    cycleModel: (sessionId: string, direction?: "forward" | "backward") => Promise<void>;
    setActiveTools: (sessionId: string, toolNames: string[]) => Promise<void>;
    respondPermission: (requestId: string, behavior: "allow" | "deny", alwaysAllow?: boolean) => Promise<void>;
    onPermissionRequest: (callback: (data: any) => void) => () => void;
    abort: (runId: string) => void;
    setModel: (sessionId: string, model: string) => Promise<void>;
    spawnAgentChat: (projectPath: string, templateId: string, message: string) => Promise<{ chatId: string }>;
    chatStatus: (sessionId: string) => Promise<string | null>;
    getPiProviders: () => Promise<Array<{ id: string; name: string; baseUrl?: string }>>;
    getPiModels: (providerName: string) => Promise<Array<{ id: string; name: string; contextWindow: number }>>;
    isStreaming: (sessionId: string) => Promise<boolean>;
    sessionStats: (sessionId: string, projectPath?: string) => Promise<Record<string, unknown> | null>;
    getBufferedStream: (sessionId: string) => Promise<unknown[]>;
    killChat: (chatId: string) => Promise<void>;
    scheduleIdleTimeout: (sessionId: string, delayMs: number) => void;
    peekUsage: (projectPath: string, sessionId: string) => Promise<void>;
    onStream: (callback: (event: StreamEvent) => void) => () => void;
    onStderr: (callback: (data: { runId: string; data: string; timestamp: number }) => void) => () => void;
    onFallbackUsed: (callback: (data: { provider: string; modelId: string }) => void) => () => void;
    onExit: (callback: (data: { runId: string; code: number }) => void) => () => void;
    onDelegationProgress: (callback: (data: DelegationProgressEvent) => void) => () => void;
    onSubagentStream: (callback: (data: SubagentStreamEvent) => void) => () => void;
    onDelegationCount: (callback: (data: { count: number; tasks: { delegationId: string; index: number; title: string }[] }) => void) => () => void;
    onShellCount: (callback: (data: { id: string; command: string; startedAt: number; status: "running" | "stopping"; logPath: string }[]) => void) => () => void;
    onShellOutput: (callback: (data: ShellOutputEvent) => void) => () => void;
    onChatSession: (callback: (data: { chatId: string; sessionId: string }) => void) => () => void;
    onContextSummarizing: (callback: (data: { chatId: string }) => void) => () => void;
    onContextSummary: (callback: (data: { chatId: string; summary: string }) => void) => () => void;
    onContextRotated: (callback: (data: { chatId: string; sessionId: string }) => void) => () => void;
    onContextUsage: (callback: (data: { chatId: string; percentage: number; totalTokens: number; maxTokens: number }) => void) => () => void;
    onTaskStatus: (callback: (data: { taskId: string; status: string; projectPath: string }) => void) => () => void;
    onCommandsChanged: (callback: (data: { commands: Array<{ name: string; description: string; argumentHint: string; aliases?: string[] }> }) => void) => () => void;
    onRenameProgress: (callback: (data: { phase: string }) => void) => () => void;
    onSessionRenamed: (callback: (data: { sessionId: string; title: string }) => void) => () => void;
  };
  group: {
    create: (projectPath: string, templateIds: string[], opts?: { presetId?: string; message?: string }) => Promise<{ groupId: string; chatId: string }>;
    send: (groupId: string, text: string) => Promise<void>;
    list: (projectPath: string) => Promise<Array<{ groupId: string; projectId: string; presetId?: string; createdAt: number; agents: Array<{ role: string; templateId: string; provider?: string; model?: string; sessionId: string }> }>>;
    close: (groupId: string) => Promise<void>;
  };
  task: {
    read: (projectPath: string) => Promise<{ tasks: { id: string; title: string; description: string; command: string; status: string; attempts: number }[] }>;
    getSubagentMessages: (sessionFile: string) => Promise<{ type: string; message: unknown }[]>;
  };
  shell: {
    exec: (projectPath: string, command: string) => Promise<{ code: number | null }>;
    onStdout: (callback: (data: { line: string }) => void) => () => void;
    onStderr: (callback: (data: { line: string }) => void) => () => void;
    readLog: (logPath: string) => Promise<{ content: string; truncated: boolean }>;
  };
  skill: {
    list: (projectPath?: string) => Promise<{ name: string; description: string; path: string; level: "builtin" | "global" | "project"; enabled: boolean }[]>;
    get: (skillPath: string) => Promise<{ name: string; description: string; path: string; level: "builtin" | "global" | "project"; enabled: boolean; body: string } | null>;
    toggle: (name: string, enabled: boolean) => Promise<void>;
    buildPrompt: (projectPath?: string) => Promise<string>;
  },
  mcp: {
    list: () => Promise<{ name: string; type: "stdio" | "http" | "sse"; command?: string; args?: string[]; url?: string; enabled: boolean }[]>;
    toggle: (name: string, enabled: boolean) => Promise<void>;
    requiredKeys: () => Promise<Record<string, Record<string, string>>>;
  },
  upload: {
    stats: (sortBy?: "time" | "size") => Promise<{ totalSize: number; fileCount: number; files: { name: string; size: number; created: number; isImage: boolean }[] }>;
    clean: (filenames: string[]) => Promise<number>;
    cleanAll: () => Promise<number>;
    openDir: () => Promise<void>;
  },
  issue: {
    list: (projectPath: string) => Promise<Array<{ id: string; title: string; module: string; symptom: string; notes: Array<{ content: string; createdAt: number }>; status: "open" | "fixed"; createdAt: number }>>;
    add: (projectPath: string, title: string, module: string, symptom: string) => Promise<{ id: string; title: string; module: string; symptom: string; notes: Array<{ content: string; createdAt: number }>; status: "open" | "fixed"; createdAt: number }>;
    setStatus: (projectPath: string, id: string, status: "open" | "fixed") => Promise<void>;
    appendNote: (projectPath: string, id: string, content: string) => Promise<void>;
    delete: (projectPath: string, id: string) => Promise<void>;
  };
  tab: {
    save: (data: { tabs: Array<{ id: string; type: string; title: string; filePath?: string; sessionId?: string; groupId?: string }>; activeTabId: string | null }) => Promise<void>;
    restore: () => Promise<{ tabs: Array<{ id: string; type: string; title: string; filePath?: string; sessionId?: string; groupId?: string }>; activeTabId: string | null } | null>;
  };
  process: {
    detect: (projectPath: string) => Promise<Array<{ id: string; platform: string; label: string; run_command: string; cwd?: string; install_command?: string; url?: string }>>;
    start: (projectPath: string, commandId: string, port?: number) => Promise<void>;
    stop: (commandId: string) => Promise<void>;
    restart: (projectPath: string, commandId: string) => Promise<void>;
    status: (commandId: string) => Promise<{ running: boolean; pid?: number; run_command?: string; output: string[] }>;
    runningIds: () => Promise<string[]>;
    checkPort: (port: number) => Promise<{ free: boolean; pid?: number; name?: string }>;
    killPort: (port: number) => Promise<boolean>;
    onOutput: (callback: (data: { commandId: string; line: string; stream: string }) => void) => () => void;
    onStatusChanged: (callback: (data: { commandId: string; running: boolean }) => void) => () => void;
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
  npx: {
    detect: () => Promise<{ found: boolean; version?: string }>;
  };
  codegraph: {
    detect: () => Promise<{ found: boolean; version?: string }>;
  };
  conv: {
    list: (projectPath: string) => Promise<{ sessionId: string; title: string; createdAt: number; updatedAt: number; pinnedAt?: number }[]>;
	    listDesign: (projectPath: string) => Promise<{ sessionId: string; title: string; createdAt: number; updatedAt: number; pinnedAt?: number }[]>;
    get: (id: string, projectPath: string) => Promise<{ sessionId: string; title: string; createdAt: number; updatedAt: number; pinnedAt?: number } | null>;
    messages: (id: string, projectPath: string) => Promise<{ type: string; uuid: string; session_id: string; message: unknown; parent_tool_use_id: string | null }[]>;
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
    read: (sessionId: string) => Promise<{ permissionMode: string; model?: string; provider?: string; contextUsage: number; updatedAt: number } | null>;
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
    get: () => Promise<{
      defaultProjectDir?: string; terminalFontSize: number; evaluateMode: boolean; setupComplete?: boolean; apiBaseUrl?: string;
      apiKey?: string; apiKeys?: Record<string, string>; builtinTools?: Record<string, boolean>; model?: string;
      availableModels?: string[]; contextThreshold?: number; context1M?: boolean;
      showThinking?: boolean; showToolUse?: boolean;
      defaultProvider?: string; defaultModel?: string; fallbackProvider?: string; fallbackModel?: string;
      subagentDefaultModel?: string;
      maxGroupAgents?: number;
      groupForwardStrategy?: "all" | "conclusion";
      groupInjectMode?: "steer" | "followUp";
      maxForwardDepth?: number;
      groupPresets?: Array<{ id: string; name: string; templateIds: string[] }>;
      apiProviders?: {
        current: string | null;
        configs: Record<string, {
          id: string; presetId: string; name: string; apiKey: string;
          baseUrl?: string; model: string; models: string[];
          context1M: boolean; createdAt: number;
        }>;
      };
    }>;
    set: (key: string, value: unknown) => Promise<void>;
    setLastProject: (projectId: string) => Promise<void>;
    fetchModels: (modelsUrl: string, apiKey: string) => Promise<string[]>;
    fetchBalance: () => Promise<{ balance_infos?: { currency: string; total_balance: string; granted_balance: string }[] }>;
    revealApiKey: (providerId: string) => Promise<string>;
  };
  agentTemplates: {
    list: () => Promise<{ id: string; name: string; description: string; prompt: string; tools: string[]; model?: string; agentType: string }[]>;
    create: (input: { name: string; description: string; prompt: string; tools: string[]; model?: string; agentType: string }) => Promise<{ id: string; name: string; description: string; prompt: string; tools: string[]; model?: string; agentType: string }>;
    update: (id: string, input: { name?: string; description?: string; prompt?: string; tools?: string[]; model?: string; agentType?: string }) => Promise<{ id: string; name: string; description: string; prompt: string; tools: string[]; model?: string; agentType: string }>;
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
    onUpdateStatus: (callback: (data: { status: string; version?: string; percent?: number; transferred?: number; totalSize?: number }) => void) => () => void;
  };
}

interface Window {
  electronAPI: ElectronAPI;
}
