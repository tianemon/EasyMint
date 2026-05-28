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

let MOCK_SESSIONS: Session[] = [
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
  { runId: "mock-run", type: "system", data: { message: "启动 Claude Code..." }, timestamp: Date.now(), source: "worker" },
  { runId: "mock-run", type: "assistant", data: { text: "正在读取 task.json 和 WORKER.md..." }, timestamp: Date.now() + 100, source: "worker" },
  { runId: "mock-run", type: "tool_use", data: { tool: "Read", args: { file_path: "task.json" } }, timestamp: Date.now() + 200, source: "worker" },
  { runId: "mock-run", type: "tool_result", data: { result: "读取成功" }, timestamp: Date.now() + 500, source: "worker" },
  { runId: "mock-run", type: "assistant", data: { text: "开始实现任务 #5 — 首页项目列表..." }, timestamp: Date.now() + 600, source: "worker" },
];

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

let _streamCallback: ((event: StreamEvent) => void) | null = null;
let _exitCallback: ((data: { runId: string; code: number }) => void) | null = null;

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
      const runId = `run-${Date.now()}`;
      // Simulate streaming events after a short delay
      setTimeout(() => {
        if (_streamCallback) {
          MOCK_STREAM_EVENTS.forEach((ev, i) => setTimeout(() => _streamCallback!(ev), i * 300));
        }
      }, 200);
      // Simulate exit after worker events
      setTimeout(() => {
        if (_exitCallback) {
          _exitCallback({ runId, code: 0 });
        }
      }, 2000 + MOCK_STREAM_EVENTS.length * 300);
      return delay({ runId });
    },
    startChat: (_projectPath: string) => {
      // Simulate chat started
      setTimeout(() => {
        if (_streamCallback) {
          _streamCallback({
            runId: "mock-chat",
            type: "system",
            data: { message: "Chat 模式已启动 — 与 Claude 自由对话" },
            timestamp: Date.now(),
            source: "chat",
          });
        }
      }, 100);
      return delay({ chatId: "mock-chat" });
    },
    sendMessage: (_chatId: string, message: string) => {
      // Echo user message + simulate AI response
      setTimeout(() => {
        if (_streamCallback) {
          _streamCallback({
            runId: "mock-chat",
            type: "user_message",
            data: { text: message },
            timestamp: Date.now(),
            source: "chat",
          });
        }
      }, 50);
      setTimeout(() => {
        if (_streamCallback) {
          _streamCallback({
            runId: "mock-chat",
            type: "assistant",
            data: { text: `收到你的消息: "${message}"。这是来自 Claude 的模拟回复，实际使用时将连接到真实的 Claude 进程。` },
            timestamp: Date.now() + 100,
            source: "chat",
          });
        }
      }, 800);
    },
    stopChat: (_chatId: string) => {
      setTimeout(() => {
        if (_streamCallback) {
          _streamCallback({
            runId: "mock-chat",
            type: "system",
            data: { message: "Chat 已结束" },
            timestamp: Date.now(),
            source: "chat",
          });
        }
        if (_exitCallback) {
          _exitCallback({ runId: _chatId, code: 0 });
        }
      }, 100);
    },
    abort: (_runId: string) => {},
    onStream: (callback: (event: StreamEvent) => void) => {
      _streamCallback = callback;
      return () => { _streamCallback = null; };
    },
    onStderr: (_callback: (data: { runId: string; data: string; timestamp: number }) => void) => {
      return () => {};
    },
    onExit: (callback: (data: { runId: string; code: number }) => void) => {
      _exitCallback = callback;
      return () => { _exitCallback = null; };
    },
  },
  evaluator: {
    isEnabled: () => delay(true),
    setEnabled: (_enabled: boolean) => delay(undefined),
    status: () => delay({ running: false }),
    runEvaluator: (_projectPath: string) => {
      const evalId = `eval-${Date.now()}`;
      setTimeout(() => {
        if (_streamCallback) {
          _streamCallback({
            runId: evalId,
            type: "system",
            data: { message: "评估 Agent 已启动 — 按 EVALUATOR.md 流程评估..." },
            timestamp: Date.now(),
            source: "evaluator",
          });
        }
      }, 200);
      setTimeout(() => {
        if (_exitCallback) {
          _exitCallback({ runId: evalId, code: 0 });
        }
      }, 1500);
      return delay({ evalId });
    },
    abort: (_evalId: string) => delay(undefined),
  },
  claude: {
    detect: () => delay({ found: true, path: "/usr/local/bin/claude", version: "1.0.0" }),
  },
  session: {
    list: (_projectId: string) => delay([...MOCK_SESSIONS]),
    resume: (_sessionId: string) => {},
    delete: (_projectId: string, sessionId: string) => {
      MOCK_SESSIONS = MOCK_SESSIONS.filter((s) => s.id !== sessionId);
      return delay(undefined);
    },
  },
  settings: {
    get: () => delay({ theme: "dark" as const, terminalFontSize: 14, evaluateMode: true }),
    set: (_key: string, _value: unknown) => delay(undefined),
  },
};
