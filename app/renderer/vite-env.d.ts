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

interface ElectronAPI {
  project: {
    list: () => Promise<Project[]>;
    create: (opts: { name: string; path: string }) => Promise<Project>;
    delete: (id: string) => Promise<void>;
    get: (id: string) => Promise<Project>;
  };
  file: {
    readTree: (dirPath: string) => Promise<FileNode[]>;
    readContent: (filePath: string) => Promise<string>;
    writeContent: (filePath: string, content: string) => Promise<void>;
  };
  terminal: {
    create: (cwd: string) => Promise<{ terminalId: string }>;
    write: (terminalId: string, data: string) => void;
    resize: (terminalId: string, cols: number, rows: number) => void;
    destroy: (terminalId: string) => void;
    onData: (callback: (data: { terminalId: string; data: string }) => void) => () => void;
  };
  session: {
    list: (projectId: string) => Promise<Session[]>;
    resume: (sessionId: string) => void;
    delete: (sessionId: string) => Promise<void>;
  };
  claude: {
    detect: () => Promise<{ found: boolean; path?: string; version?: string }>;
  };
}

interface Window {
  electronAPI: ElectronAPI;
}
