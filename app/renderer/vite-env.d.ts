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
  claudeSessionId: string;
  status: "active" | "completed";
}

// JSONL stream event types from Claude --output-format stream-json
interface StreamEvent {
  seq: number;           // 全局单调递增，前端去重用
  runId: string;
  sessionId?: string;
  type: "assistant" | "message_delta" | "tool_use" | "tool_result" | "user_message" | "system" | "error" | "status";
  data: Record<string, unknown>;
  timestamp: number;
  source?: "worker" | "evaluator" | "chat";
}

interface ElectronAPI {
  window: {
    openProject: (projectId: string, sessionId?: string, init?: boolean) => Promise<void>;
    newWindow: () => Promise<void>;
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
    readState: (projectPath: string) => Promise<Record<string, string> | null>;
    writeState: (projectPath: string, state: unknown) => Promise<boolean>;
  };
  file: {
    readTree: (dirPath: string) => Promise<FileNode[]>;
    readContent: (filePath: string) => Promise<string>;
    writeContent: (filePath: string, content: string) => Promise<void>;
    saveUpload: (name: string, data: Uint8Array) => Promise<{ path: string; dataUrl: string }>;
    readUpload: (filePath: string) => Promise<string | null>;
  };
  agent: {
    runWorker: (projectPath: string, prompt: string) => Promise<{ runId: string }>;
    sendMessage: (projectPath: string, message: string, opts?: { sessionId?: string | null; permissionMode?: string; model?: string }) => Promise<{ chatId: string }>;
    abort: (runId: string) => void;
    setModel: (sessionId: string, model: string) => Promise<void>;
    notifySession: (sessionId: string, message: string) => void;
    spawnAgentChat: (projectPath: string, templateId: string, message: string) => Promise<{ chatId: string }>;
    chatStatus: (sessionId: string) => Promise<string | null>;
    getBufferedStream: (sessionId: string) => Promise<unknown[]>;
    listCommands: () => Promise<Array<{ name: string; description: string; argumentHint: string; aliases?: string[] }>>;
    killChat: (chatId: string) => Promise<void>;
    scheduleIdleTimeout: (sessionId: string, delayMs: number) => void;
    peekUsage: (projectPath: string, sessionId: string) => Promise<void>;
    onStream: (callback: (event: StreamEvent) => void) => () => void;
    onStderr: (callback: (data: { runId: string; data: string; timestamp: number }) => void) => () => void;
    onExit: (callback: (data: { runId: string; code: number }) => void) => () => void;
    onChatSession: (callback: (data: { chatId: string; sessionId: string }) => void) => () => void;
    onContextSummarizing: (callback: (data: { chatId: string }) => void) => () => void;
    onContextSummary: (callback: (data: { chatId: string; summary: string }) => void) => () => void;
    onRotateCreate: (callback: (data: { oldChatId: string; oldSessionId: string; projectPath: string; handoffPrompt: string }) => void) => () => void;
    onContextUsage: (callback: (data: { chatId: string; percentage: number; totalTokens: number; maxTokens: number }) => void) => () => void;
    onTaskStatus: (callback: (data: { taskId: string; status: string; projectPath: string }) => void) => () => void;
    onProjectStage: (callback: (data: { stage: string; projectPath: string }) => void) => () => void;
    onCommandsChanged: (callback: (data: { commands: Array<{ name: string; description: string; argumentHint: string; aliases?: string[] }> }) => void) => () => void;
    onRenameProgress: (callback: (data: { phase: string }) => void) => () => void;
    onSessionRenamed: (callback: (data: { sessionId: string; title: string }) => void) => () => void;
  };
  task: {
    read: (projectPath: string) => Promise<{ tasks: { id: string; title: string; description: string; command: string; status: string; attempts: number }[] }>;
  };
  shell: {
    exec: (projectPath: string, command: string) => Promise<{ code: number | null }>;
    onStdout: (callback: (data: { line: string }) => void) => () => void;
    onStderr: (callback: (data: { line: string }) => void) => () => void;
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
  },
  evaluator: {
    isEnabled: () => Promise<boolean>;
    setEnabled: (enabled: boolean) => Promise<void>;
  };
  claude: {
    detect: () => Promise<{ found: boolean; path?: string; version?: string }>;
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
    get: (id: string, projectPath: string) => Promise<{ sessionId: string; title: string; createdAt: number; updatedAt: number; pinnedAt?: number } | null>;
    messages: (id: string, projectPath: string) => Promise<{ type: string; uuid: string; session_id: string; message: unknown; parent_tool_use_id: string | null }[]>;
    rename: (id: string, title: string, projectPath: string) => Promise<void>;
    delete: (id: string, projectPath: string) => Promise<void>;
    togglePin: (id: string) => Promise<boolean>;
    archiveSession: (sessionId: string) => Promise<void>;
    unarchiveSession: (sessionId: string) => Promise<void>;
  };
  session: {
    list: (projectId: string) => Promise<Session[]>;
    resume: (sessionId: string) => void;
    create: (projectId: string, title: string) => Promise<Session>;
    delete: (projectId: string, sessionId: string) => Promise<void>;
  };
  sessionCache: {
    read: (sessionId: string) => Promise<{ permissionMode: string; model?: string; contextUsage: number; updatedAt: number } | null>;
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
  };
  agentTemplates: {
    list: () => Promise<{ id: string; name: string; description: string; prompt: string; tools: string[]; model?: string; agentType: string }[]>;
    create: (input: { name: string; description: string; prompt: string; tools: string[]; model?: string; agentType: string }) => Promise<{ id: string; name: string; description: string; prompt: string; tools: string[]; model?: string; agentType: string }>;
    update: (id: string, input: { name?: string; description?: string; prompt?: string; tools?: string[]; model?: string; agentType?: string }) => Promise<{ id: string; name: string; description: string; prompt: string; tools: string[]; model?: string; agentType: string }>;
    delete: (id: string) => Promise<void>;
  };
}

interface Window {
  electronAPI: ElectronAPI;
}
