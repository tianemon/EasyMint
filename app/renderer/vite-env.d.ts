/// <reference types="vite/client" />

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
  runId: string;
  sessionId?: string;
  type: "assistant" | "message_delta" | "tool_use" | "tool_result" | "user_message" | "system" | "error" | "status";
  data: Record<string, unknown>;
  timestamp: number;
  source?: "worker" | "evaluator" | "chat";
}

interface TaskStep {
  label: string;
  status: "done" | "running" | "pending" | "failed";
}

interface TaskItem {
  id: number;
  title: string;
  status: "done" | "running" | "pending" | "failed";
  steps: TaskStep[];
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
    killChat: (chatId: string) => Promise<void>;
    onStream: (callback: (event: StreamEvent) => void) => () => void;
    onStderr: (callback: (data: { runId: string; data: string; timestamp: number }) => void) => () => void;
    onExit: (callback: (data: { runId: string; code: number }) => void) => () => void;
    onChatSession: (callback: (data: { chatId: string; sessionId: string }) => void) => () => void;
  };
  task: {
    read: (projectPath: string) => Promise<{ tasks: { id: string; title: string; description: string; command: string; passes: boolean }[] }>;
    markDone: (projectPath: string, taskId: string) => Promise<boolean>;
  };
  shell: {
    exec: (projectPath: string, command: string) => Promise<{ code: number | null }>;
    onStdout: (callback: (data: { line: string }) => void) => () => void;
    onStderr: (callback: (data: { line: string }) => void) => () => void;
  };
  skill: {
    list: (projectPath?: string) => Promise<{ name: string; description: string; path: string; level: "global" | "project"; enabled: boolean }[]>;
    get: (skillPath: string) => Promise<{ name: string; description: string; path: string; level: "global" | "project"; enabled: boolean; body: string } | null>;
    import: (sourcePath: string, level: "global" | "project", projectPath?: string) => Promise<{ name: string; description: string; path: string; level: "global" | "project"; enabled: boolean }>;
    delete: (skillPath: string) => Promise<void>;
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
  conv: {
    list: (projectPath: string) => Promise<{ sessionId: string; title: string; createdAt: number; updatedAt: number; pinnedAt?: number }[]>;
    get: (id: string, projectPath: string) => Promise<{ sessionId: string; title: string; createdAt: number; updatedAt: number; pinnedAt?: number } | null>;
    messages: (id: string, projectPath: string) => Promise<{ type: string; uuid: string; session_id: string; message: unknown; parent_tool_use_id: string | null }[]>;
    rename: (id: string, title: string, projectPath: string) => Promise<void>;
    delete: (id: string, projectPath: string) => Promise<void>;
    togglePin: (id: string) => Promise<boolean>;
  };
  session: {
    list: (projectId: string) => Promise<Session[]>;
    resume: (sessionId: string) => void;
    create: (projectId: string, title: string) => Promise<Session>;
    delete: (projectId: string, sessionId: string) => Promise<void>;
  };
  systemPrompt: {
    getConfig: () => Promise<{ prompts: { id: string; name: string; content: string; isBuiltin: boolean; createdAt: number; updatedAt: number }[]; defaultPromptId?: string; appendDateTimeAndUserName: boolean }>;
    create: (input: { name: string; content: string }) => Promise<{ id: string; name: string; content: string; isBuiltin: boolean; createdAt: number; updatedAt: number }>;
    update: (id: string, input: { name?: string; content?: string }) => Promise<{ id: string; name: string; content: string; isBuiltin: boolean; createdAt: number; updatedAt: number }>;
    delete: (id: string) => Promise<void>;
    updateAppend: (enabled: boolean) => Promise<void>;
    setDefault: (id: string) => Promise<void>;
  };
  settings: {
    get: () => Promise<{ defaultProjectDir?: string; terminalFontSize: number; evaluateMode: boolean; tddMode: boolean; screenshotVerification: boolean; setupComplete?: boolean; apiBaseUrl?: string; apiKey?: string; apiKeys?: Record<string, string>; model?: string; availableModels?: string[] }>;
    set: (key: string, value: unknown) => Promise<void>;
    setLastProject: (projectId: string) => Promise<void>;
    fetchModels: () => Promise<string[]>;
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
