/// <reference types="vite/client" />

interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
  status: "setup" | "development" | "completed";
  description: string;
}

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
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
  type: "assistant" | "message_delta" | "tool_use" | "tool_result" | "user_message" | "system" | "error";
  data: Record<string, unknown>;
  timestamp: number;
  source?: "worker" | "evaluator" | "chat";
}

interface ElectronAPI {
  project: {
    list: () => Promise<Project[]>;
    create: (opts: { name: string; path: string }) => Promise<Project>;
    delete: (id: string) => Promise<void>;
    get: (id: string) => Promise<Project | undefined>;
  };
  file: {
    readTree: (dirPath: string) => Promise<FileNode[]>;
    readContent: (filePath: string) => Promise<string>;
    writeContent: (filePath: string, content: string) => Promise<void>;
  };
  agent: {
    runWorker: (projectPath: string, prompt: string) => Promise<{ runId: string }>;
    startChat: (projectPath: string) => Promise<{ chatId: string }>;
    sendMessage: (chatId: string, message: string) => void;
    stopChat: (chatId: string) => void;
    abort: (runId: string) => void;
    onStream: (callback: (event: StreamEvent) => void) => () => void;
    onStderr: (callback: (data: { runId: string; data: string; timestamp: number }) => void) => () => void;
    onExit: (callback: (data: { runId: string; code: number }) => void) => () => void;
  };
  evaluator: {
    isEnabled: () => Promise<boolean>;
    setEnabled: (enabled: boolean) => Promise<void>;
    status: () => Promise<{ running: boolean; currentTask?: number }>;
  };
  claude: {
    detect: () => Promise<{ found: boolean; path?: string; version?: string }>;
  };
  session: {
    list: (projectId: string) => Promise<Session[]>;
    resume: (sessionId: string) => void;
    delete: (projectId: string, sessionId: string) => Promise<void>;
  };
  settings: {
    get: () => Promise<{ theme: "dark" | "light"; terminalFontSize: number; evaluateMode: boolean }>;
    set: (key: string, value: unknown) => Promise<void>;
  };
}

interface Window {
  electronAPI: ElectronAPI;
}
