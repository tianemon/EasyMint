import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  window: {
    openProject: (projectId: string, sessionId?: string, init?: boolean) => ipcRenderer.invoke("window:open-project", { projectId, sessionId, init }),
    newWindow: () => ipcRenderer.invoke("window:new"),
  },
  dialog: {
    openDirectory: () => ipcRenderer.invoke("dialog:openDirectory"),
  },
  project: {
    list: () => ipcRenderer.invoke("project:list"),
    create: (opts: { name: string; path: string }) => ipcRenderer.invoke("project:create", opts),
    delete: (id: string) => ipcRenderer.invoke("project:delete", { id }),
    get: (id: string) => ipcRenderer.invoke("project:get", { id }),
    checkInitStatus: (projectPath: string) => ipcRenderer.invoke("project:checkInitStatus", { projectPath }),
    readState: (projectPath: string) => ipcRenderer.invoke("project:readState", { projectPath }),
    writeState: (projectPath: string, state: unknown) => ipcRenderer.invoke("project:writeState", { projectPath, state }),
  },
  file: {
    readTree: (dirPath: string) => ipcRenderer.invoke("file:readTree", { dirPath }),
    readContent: (filePath: string) => ipcRenderer.invoke("file:readContent", { filePath }),
    writeContent: (filePath: string, content: string) =>
      ipcRenderer.invoke("file:writeContent", { filePath, content }),
    saveUpload: (name: string, data: Uint8Array) => ipcRenderer.invoke("file:saveUpload", { name, data: Array.from(data) }) as Promise<{ path: string; dataUrl: string }>,
    readUpload: (filePath: string) => ipcRenderer.invoke("file:readUpload", { filePath }) as Promise<string | null>,
  },
  terminal: {
    create: (cwd: string) => ipcRenderer.invoke("terminal:create", { cwd }),
    write: (terminalId: string, data: string) =>
      ipcRenderer.send("terminal:write", { terminalId, data }),
    resize: (terminalId: string, cols: number, rows: number) =>
      ipcRenderer.send("terminal:resize", { terminalId, cols, rows }),
    destroy: (terminalId: string) => ipcRenderer.send("terminal:destroy", { terminalId }),
    onData: (callback: (data: { terminalId: string; data: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { terminalId: string; data: string }) =>
        callback(data);
      ipcRenderer.on("terminal:onData", handler);
      return () => ipcRenderer.removeListener("terminal:onData", handler);
    },
  },
  session: {
    list: (projectId: string) => ipcRenderer.invoke("session:list", { projectId }),
    resume: (sessionId: string) => ipcRenderer.send("session:resume", { sessionId }),
    delete: (projectId: string, sessionId: string) =>
      ipcRenderer.invoke("session:delete", { projectId, sessionId }),
  },
  claude: {
    detect: () => ipcRenderer.invoke("claude:detect"),
  },
  git: {
    detect: () => ipcRenderer.invoke("git:detect"),
  },
  nodeRuntime: {
    detect: () => ipcRenderer.invoke("node:detect"),
  },
  npx: {
    detect: () => ipcRenderer.invoke("npx:detect"),
  },
  codegraph: {
    detect: () => ipcRenderer.invoke("codegraph:detect"),
  },
  conv: {
    list: (projectPath: string) => ipcRenderer.invoke("conv:list", { projectPath }),
    get: (id: string, projectPath: string) => ipcRenderer.invoke("conv:get", { id, projectPath }),
    messages: (id: string, projectPath: string) => ipcRenderer.invoke("conv:messages", { id, projectPath }),
    rename: (id: string, title: string, projectPath: string) => ipcRenderer.invoke("conv:rename", { id, title, projectPath }),
    delete: (id: string, projectPath: string) => ipcRenderer.invoke("conv:delete", { id, projectPath }),
    togglePin: (id: string) => ipcRenderer.invoke("conv:togglePin", { id }),
    archiveSession: (sessionId: string) => ipcRenderer.invoke("conv:archiveSession", { sessionId }),
    unarchiveSession: (sessionId: string) => ipcRenderer.invoke("conv:unarchiveSession", { sessionId }),
  },
  sessionCache: {
    read: (sessionId: string) => ipcRenderer.invoke("session-cache:read", { sessionId }),
    write: (sessionId: string, data: Record<string, unknown>) => ipcRenderer.invoke("session-cache:write", { sessionId, data }),
    delete: (sessionId: string) => ipcRenderer.invoke("session-cache:delete", { sessionId }),
  },
  systemPrompt: {
    getConfig: () => ipcRenderer.invoke("system-prompt:get-config"),
    create: (input: { name: string; content: string }) => ipcRenderer.invoke("system-prompt:create", input),
    update: (id: string, input: { name?: string; content?: string }) => ipcRenderer.invoke("system-prompt:update", { id, input }),
    delete: (id: string) => ipcRenderer.invoke("system-prompt:delete", { id }),
    setDefault: (id: string) => ipcRenderer.invoke("system-prompt:set-default", { id }),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (key: string, value: unknown) => ipcRenderer.invoke("settings:set", { key, value }),
    setLastProject: (projectId: string) => ipcRenderer.invoke("settings:set-last-project", { projectId }),
    fetchModels: (modelsUrl: string, apiKey: string) => ipcRenderer.invoke("settings:fetchModels", modelsUrl, apiKey) as Promise<string[]>,
    fetchBalance: () => ipcRenderer.invoke("settings:fetchBalance") as Promise<{ balance_infos?: { currency: string; total_balance: string; granted_balance: string }[] }>,
  },
  agentTemplates: {
    list: () => ipcRenderer.invoke("agent-template:list"),
    create: (input: { name: string; description: string; prompt: string; tools: string[]; model?: string; agentType: string }) => ipcRenderer.invoke("agent-template:create", { input }),
    update: (id: string, input: { name?: string; description?: string; prompt?: string; tools?: string[]; model?: string; agentType?: string }) => ipcRenderer.invoke("agent-template:update", { id, input }),
    delete: (id: string) => ipcRenderer.invoke("agent-template:delete", { id }),
  },
  task: {
    read: (projectPath: string) => ipcRenderer.invoke("task:read", { projectPath }),
  },
  shell: {
    exec: (projectPath: string, command: string) => ipcRenderer.invoke("shell:exec", { projectPath, command }),
    onStdout: (callback: (data: { line: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: { line: string }) => callback(data);
      ipcRenderer.on("shell:stdout", handler);
      return () => ipcRenderer.removeListener("shell:stdout", handler);
    },
    onStderr: (callback: (data: { line: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: { line: string }) => callback(data);
      ipcRenderer.on("shell:stderr", handler);
      return () => ipcRenderer.removeListener("shell:stderr", handler);
    },
  },
  skill: {
    list: (projectPath?: string) => ipcRenderer.invoke("skill:list", { projectPath }),
    get: (skillPath: string) => ipcRenderer.invoke("skill:get", { skillPath }),
    toggle: (name: string, enabled: boolean) => ipcRenderer.invoke("skill:toggle", { name, enabled }),
    buildPrompt: (projectPath?: string) => ipcRenderer.invoke("skill:buildPrompt", { projectPath }),
  },
  mcp: {
    list: () => ipcRenderer.invoke("mcp:list"),
    toggle: (name: string, enabled: boolean) => ipcRenderer.invoke("mcp:toggle", { name, enabled }),
    requiredKeys: () => ipcRenderer.invoke("mcp:requiredKeys") as Promise<Record<string, string[]>>,
  },
  upload: {
    stats: (sortBy?: "time" | "size") => ipcRenderer.invoke("upload:stats", { sortBy }),
    clean: (filenames: string[]) => ipcRenderer.invoke("upload:clean", { filenames }),
    cleanAll: () => ipcRenderer.invoke("upload:cleanAll"),
  },
  evaluator: {
    isEnabled: () => ipcRenderer.invoke("evaluator:isEnabled"),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke("evaluator:setEnabled", { enabled }),
  },
  agent: {
    runWorker: (projectPath: string, prompt: string) =>
      ipcRenderer.invoke("agent:runWorker", { projectPath, prompt }),
    sendMessage: (projectPath: string, message: string, opts?: { sessionId?: string | null; permissionMode?: string; model?: string }) =>
      ipcRenderer.invoke("agent:sendMessage", { projectPath, message, ...opts }),
    abort: (runId: string) => ipcRenderer.invoke("agent:abort", { runId }),
    setModel: (sessionId: string, model: string) => ipcRenderer.invoke("agent:setModel", { sessionId, model }) as Promise<void>,
    notifySession: (sessionId: string, message: string) => ipcRenderer.invoke("agent:notifySession", { sessionId, message }),
    spawnAgentChat: (projectPath: string, templateId: string, message: string) => ipcRenderer.invoke("agent:spawnAgentChat", { projectPath, templateId, message }) as Promise<{ chatId: string }>,
    chatStatus: (sessionId: string) => ipcRenderer.invoke("agent:chatStatus", { sessionId }),
    getBufferedStream: (sessionId: string) => ipcRenderer.invoke("agent:getBufferedStream", { sessionId }) as Promise<unknown[]>,
    listCommands: () => ipcRenderer.invoke("agent:listCommands") as Promise<Array<{ name: string; description: string; argumentHint: string; aliases?: string[] }>>,
    killChat: (chatId: string) => ipcRenderer.invoke("agent:killChat", { chatId }) as Promise<void>,
    peekUsage: (projectPath: string, sessionId: string) => ipcRenderer.invoke("agent:peekUsage", { projectPath, sessionId }) as Promise<void>,
    onStream: (callback: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("agent:stream", handler);
      return () => ipcRenderer.removeListener("agent:stream", handler);
    },
    onStderr: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("agent:stderr", handler);
      return () => ipcRenderer.removeListener("agent:stderr", handler);
    },
    onExit: (callback: (data: { runId: string; code: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { runId: string; code: number }) =>
        callback(data);
      ipcRenderer.on("agent:exit", handler);
      return () => ipcRenderer.removeListener("agent:exit", handler);
    },
    onChatSession: (callback: (data: { chatId: string; sessionId: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { chatId: string; sessionId: string }) =>
        callback(data);
      ipcRenderer.on("agent:chat-session", handler);
      return () => ipcRenderer.removeListener("agent:chat-session", handler);
    },
    onContextSummarizing: (callback: (data: { chatId: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { chatId: string }) => callback(data);
      ipcRenderer.on("agent:context-summarizing", handler);
      return () => ipcRenderer.removeListener("agent:context-summarizing", handler);
    },
    onContextSummary: (callback: (data: { chatId: string; summary: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { chatId: string; summary: string }) => callback(data);
      ipcRenderer.on("agent:context-summary", handler);
      return () => ipcRenderer.removeListener("agent:context-summary", handler);
    },
    onRotateCreate: (callback: (data: { oldChatId: string; oldSessionId: string; projectPath: string; handoffPrompt: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { oldChatId: string; oldSessionId: string; projectPath: string; handoffPrompt: string }) => callback(data);
      ipcRenderer.on("agent:rotate-create", handler);
      return () => ipcRenderer.removeListener("agent:rotate-create", handler);
    },
    onContextUsage: (callback: (data: { chatId: string; percentage: number; totalTokens: number; maxTokens: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { chatId: string; percentage: number; totalTokens: number; maxTokens: number }) => callback(data);
      ipcRenderer.on("agent:context-usage", handler);
      return () => ipcRenderer.removeListener("agent:context-usage", handler);
    },
    onTaskStatus: (callback: (data: { taskId: string; status: string; projectPath: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { taskId: string; status: string; projectPath: string }) => callback(data);
      ipcRenderer.on("agent:task-status", handler);
      return () => ipcRenderer.removeListener("agent:task-status", handler);
    },
    onProjectStage: (callback: (data: { stage: string; projectPath: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { stage: string; projectPath: string }) => callback(data);
      ipcRenderer.on("agent:project-stage", handler);
      return () => ipcRenderer.removeListener("agent:project-stage", handler);
    },
    onCommandsChanged: (callback: (data: { commands: Array<{ name: string; description: string; argumentHint: string; aliases?: string[] }> }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { commands: Array<{ name: string; description: string; argumentHint: string; aliases?: string[] }> }) => callback(data);
      ipcRenderer.on("agent:commands-changed", handler);
      return () => ipcRenderer.removeListener("agent:commands-changed", handler);
    },
  },
});
