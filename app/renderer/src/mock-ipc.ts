const MOCK_PROJECTS: Project[] = [
  {
    id: "mock-1",
    name: "示例项目 — 记账软件",
    path: "/Users/demo/projects/ledger",
    createdAt: "2026-05-20T08:00:00.000Z",
    lastOpenedAt: "2026-05-28T10:30:00.000Z",
    status: "development",
    description: "个人记账工具",
  },
  {
    id: "mock-2",
    name: "示例项目 — Todo 应用",
    path: "/Users/demo/projects/todo",
    createdAt: "2026-05-15T12:00:00.000Z",
    lastOpenedAt: "2026-05-27T16:00:00.000Z",
    status: "setup",
    description: "",
  },
];

const MOCK_FILE_TREE: FileNode[] = [
  { name: "CLAUDE.md", path: "/mock/project/CLAUDE.md", isDirectory: false },
  { name: "task.json", path: "/mock/project/task.json", isDirectory: false },
  {
    name: "app", path: "/mock/project/app", isDirectory: true, children: [
      { name: "index.ts", path: "/mock/project/app/index.ts", isDirectory: false },
      { name: "utils.ts", path: "/mock/project/app/utils.ts", isDirectory: false },
    ],
  },
  {
    name: "docs", path: "/mock/project/docs", isDirectory: true, children: [
      { name: "requirements.md", path: "/mock/project/docs/requirements.md", isDirectory: false },
    ],
  },
];

const MOCK_FILE_CONTENT: Record<string, string> = {
  "/mock/project/CLAUDE.md": "# 示例项目\n\n这是一个示例项目的 CLAUDE.md 文件。\n",
  "/mock/project/task.json": '{\n  "project": "示例项目",\n  "tasks": [...]\n}\n',
  "/mock/project/app/index.ts": "console.log('Hello World');\n",
  "/mock/project/app/utils.ts": "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
  "/mock/project/docs/requirements.md": "# 需求规格\n\n## 项目概述\n示例项目用于演示 EasyMint 功能。\n\n## 功能清单\n- P0: 核心功能\n- P1: 增强功能\n",
};

const MOCK_SESSIONS: Session[] = [
  {
    id: "sess-1", projectId: "mock-1", title: "需求访谈 — 记账软件",
    createdAt: "2026-05-20T08:30:00.000Z", lastActiveAt: "2026-05-20T09:15:00.000Z",
    claudeSessionId: "claude-sess-abc", status: "completed",
  },
  {
    id: "sess-2", projectId: "mock-1", title: "数据库设计讨论",
    createdAt: "2026-05-22T14:00:00.000Z", lastActiveAt: "2026-05-22T15:30:00.000Z",
    claudeSessionId: "claude-sess-def", status: "active",
  },
];

const MOCK_STREAM_EVENTS: StreamEvent[] = [
  { type: "system", data: { message: "启动 Claude Code..." }, timestamp: Date.now(), source: "worker" },
  { type: "assistant", data: { text: "正在读取 task.json 和 WORKER.md..." }, timestamp: Date.now() + 100, source: "worker" },
  { type: "tool_use", data: { tool: "Read", args: { file_path: "task.json" } }, timestamp: Date.now() + 200, source: "worker" },
  { type: "tool_result", data: { result: "读取成功" }, timestamp: Date.now() + 500, source: "worker" },
  { type: "assistant", data: { text: "开始实现任务 #5 — 首页项目列表..." }, timestamp: Date.now() + 600, source: "worker" },
];

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

let _streamCallback: ((event: StreamEvent) => void) | null = null;

export const electronAPIMock = {
  project: {
    list: () => delay(MOCK_PROJECTS),
    create: (opts: { name: string; path: string }) =>
      delay({
        id: `mock-${Date.now()}`, name: opts.name,
        path: `${opts.path}/${opts.name}`,
        createdAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString(),
        status: "setup" as const, description: "",
      }, 400),
    delete: (_id: string) => delay(undefined),
    get: (id: string) => delay(MOCK_PROJECTS.find((p) => p.id === id)),
  },
  file: {
    readTree: (_dirPath: string) => delay(MOCK_FILE_TREE),
    readContent: (filePath: string) => delay(MOCK_FILE_CONTENT[filePath] ?? "// 文件内容\n"),
    writeContent: (_filePath: string, _content: string) => delay(undefined),
  },
  agent: {
    runWorker: (_projectPath: string, _prompt: string) => {
      // Simulate streaming events after a short delay
      setTimeout(() => {
        if (_streamCallback) {
          MOCK_STREAM_EVENTS.forEach((ev, i) => setTimeout(() => _streamCallback!(ev), i * 300));
        }
      }, 200);
      return delay({ runId: `run-${Date.now()}` });
    },
    startChat: (_projectPath: string) => delay({ chatId: `chat-${Date.now()}` }),
    sendMessage: (_chatId: string, _message: string) => {},
    stopChat: (_chatId: string) => {},
    abort: (_runId: string) => {},
    onStream: (callback: (event: StreamEvent) => void) => {
      _streamCallback = callback;
      return () => { _streamCallback = null; };
    },
    onExit: (callback: (data: { runId: string; code: number }) => void) => {
      return () => {};
    },
  },
  evaluator: {
    isEnabled: () => delay(true),
    setEnabled: (_enabled: boolean) => delay(undefined),
    status: () => delay({ running: false }),
  },
  session: {
    list: (_projectId: string) => delay(MOCK_SESSIONS),
    delete: (_projectId: string, _sessionId: string) => delay(undefined),
  },
  settings: {
    get: () => delay({ theme: "dark" as const, terminalFontSize: 14, evaluateMode: true }),
    set: (_key: string, _value: unknown) => delay(undefined),
  },
};
