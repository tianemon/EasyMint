import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  window: {
    openProject: (projectId: string, sessionId?: string, init?: boolean) => ipcRenderer.invoke("window:open-project", { projectId, sessionId, init }),
    newWindow: () => ipcRenderer.invoke("window:new"),
  },
  editor: {
    open: (filePath?: string) => ipcRenderer.invoke("editor:open", filePath),
    onOpenPrototype: (callback: (data: { projectPath: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { projectPath: string }) => callback(data);
      ipcRenderer.on("editor:open-prototype", handler);
      return () => ipcRenderer.removeListener("editor:open-prototype", handler);
    },
  },
  dialog: {
    openDirectory: () => ipcRenderer.invoke("dialog:openDirectory"),
  },
  project: {
    list: () => ipcRenderer.invoke("project:list"),
    create: (opts: { name: string; path: string }) => ipcRenderer.invoke("project:create", opts),
    delete: (id: string) => ipcRenderer.invoke("project:delete", { id }),
    get: (id: string) => ipcRenderer.invoke("project:get", { id }),
    update: (id: string, patch: { name?: string; path?: string }) => ipcRenderer.invoke("project:update", { id, patch }),
    import: (dirPath: string) => ipcRenderer.invoke("project:import", { dirPath }),
    renameExec: (oldPath: string, newName: string) => ipcRenderer.invoke("project:rename-exec", { oldPath, newName }) as Promise<{ ok: boolean; error?: string }>,
    checkInitStatus: (projectPath: string) => ipcRenderer.invoke("project:checkInitStatus", { projectPath }),
  },
  file: {
    readTree: (dirPath: string) => ipcRenderer.invoke("file:readTree", { dirPath }),
    readContent: (filePath: string) => ipcRenderer.invoke("file:readContent", { filePath }),
    writeContent: (filePath: string, content: string) =>
      ipcRenderer.invoke("file:writeContent", { filePath, content }),
    createFile: (filePath: string, content?: string) =>
      ipcRenderer.invoke("file:createFile", { filePath, content: content ?? "" }),
    createFolder: (dirPath: string) =>
      ipcRenderer.invoke("file:createFolder", { dirPath }),
    saveUpload: (name: string, data: Uint8Array) => ipcRenderer.invoke("file:saveUpload", { name, data: Array.from(data) }) as Promise<{ path: string; dataUrl: string }>,
    readUpload: (filePath: string) => ipcRenderer.invoke("file:readUpload", { filePath }) as Promise<string | null>,
  },
  session: {
    list: (projectId: string) => ipcRenderer.invoke("session:list", { projectId }),
    resume: (sessionId: string) => ipcRenderer.send("session:resume", { sessionId }),
    delete: (projectId: string, sessionId: string) =>
      ipcRenderer.invoke("session:delete", { projectId, sessionId }),
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
    listDesign: (projectPath: string) => ipcRenderer.invoke("conv:listDesign", { projectPath }) as Promise<Array<{ sessionId: string; title: string; createdAt: number; updatedAt: number; pinnedAt?: number; archivedAt?: number }>>,
    get: (id: string, projectPath: string) => ipcRenderer.invoke("conv:get", { id, projectPath }),
    messages: (id: string, projectPath: string) => ipcRenderer.invoke("conv:messages", { id, projectPath }),
    rename: (id: string, title: string, projectPath: string) => ipcRenderer.invoke("conv:rename", { id, title, projectPath }),
    designSessions: () => ipcRenderer.invoke("conv:design-sessions") as Promise<string[]>,
    delete: (id: string, projectPath: string) => ipcRenderer.invoke("conv:delete", { id, projectPath }),
    togglePin: (id: string) => ipcRenderer.invoke("conv:togglePin", { id }),
    archiveSession: (sessionId: string) => ipcRenderer.invoke("conv:archiveSession", { sessionId }),
    unarchiveSession: (sessionId: string) => ipcRenderer.invoke("conv:unarchiveSession", { sessionId }),
  },
  pin: {
    get: (sessionId: string) => ipcRenderer.invoke("pin:get", { sessionId }) as Promise<Array<{ id: string; content: string; title: string; x: number; y: number; width?: number; height?: number; colorIdx?: number; minimized?: boolean; edge?: "left" | "right"; createdAt: number }>>,
    set: (sessionId: string, pins: Array<{ id: string; content: string; title: string; x: number; y: number; width?: number; height?: number; colorIdx?: number; minimized?: boolean; edge?: "left" | "right"; createdAt: number }>) => ipcRenderer.invoke("pin:set", { sessionId, pins }),
  },
  win: {
    minimize: () => ipcRenderer.invoke("win:minimize"),
    maximize: () => ipcRenderer.invoke("win:maximize"),
    close: () => ipcRenderer.invoke("win:close"),
    isMaximized: () => ipcRenderer.invoke("win:isMaximized") as Promise<boolean>,
    onMaximizedChanged: (callback: (maximized: boolean) => void) => {
      const listener = (_e: unknown, maximized: boolean) => callback(maximized);
      ipcRenderer.on("win:maximized-changed", listener);
      return () => ipcRenderer.removeListener("win:maximized-changed", listener);
    },
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
    openDir: () => ipcRenderer.invoke("upload:openDir"),
  },
  issue: {
    list: (projectPath: string) => ipcRenderer.invoke("issue:list", { projectPath }),
    add: (projectPath: string, title: string, module: string, symptom: string) => ipcRenderer.invoke("issue:add", { projectPath, title, module, symptom }),
    setStatus: (projectPath: string, id: string, status: string) => ipcRenderer.invoke("issue:set-status", { projectPath, id, status }),
    appendNote: (projectPath: string, id: string, content: string) => ipcRenderer.invoke("issue:append-note", { projectPath, id, content }),
    delete: (projectPath: string, id: string) => ipcRenderer.invoke("issue:delete", { projectPath, id }),
  },
  process: {
    detect: (projectPath: string) => ipcRenderer.invoke("process:detect", { projectPath }),
    start: (projectPath: string, commandId: string, port?: number) => ipcRenderer.invoke("process:start", { projectPath, commandId, port }),
    stop: (commandId: string) => ipcRenderer.invoke("process:stop", { commandId }),
    restart: (projectPath: string, commandId: string) => ipcRenderer.invoke("process:restart", { projectPath, commandId }),
    status: (commandId: string) => ipcRenderer.invoke("process:status", { commandId }),
    runningIds: () => ipcRenderer.invoke("process:running-ids"),
    checkPort: (port: number) => ipcRenderer.invoke("process:checkPort", { port }),
    killPort: (port: number) => ipcRenderer.invoke("process:killPort", { port }),
    onOutput: (callback: (data: { commandId: string; line: string; stream: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: { commandId: string; line: string; stream: string }) => callback(data);
      ipcRenderer.on("process:output", handler);
      return () => ipcRenderer.removeListener("process:output", handler);
    },
    onStatusChanged: (callback: (data: { commandId: string; running: boolean }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: { commandId: string; running: boolean }) => callback(data);
      ipcRenderer.on("process:status-changed", handler);
      return () => ipcRenderer.removeListener("process:status-changed", handler);
    },
  },
  evaluator: {
    isEnabled: () => ipcRenderer.invoke("evaluator:isEnabled"),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke("evaluator:setEnabled", { enabled }),
  },
  app: {
    getVersion: () => ipcRenderer.invoke("app:get-version") as Promise<string>,
    checkUpdate: () => ipcRenderer.invoke("app:check-update") as Promise<boolean>,
    installUpdate: () => ipcRenderer.invoke("app:install-update") as Promise<boolean>,
    hasUpdate: () => ipcRenderer.invoke("app:has-update") as Promise<{ hasUpdate: boolean; version: string | null }>,
    clearUpdateCache: () => ipcRenderer.invoke("app:clear-update-cache") as Promise<{ cleaned: string[]; errors: string[] }>,
    updateCacheSize: () => ipcRenderer.invoke("app:update-cache-size") as Promise<number>,
    openUpdateCache: () => ipcRenderer.invoke("app:open-update-cache"),
    onUpdateStatus: (callback: (data: { status: string; version?: string; percent?: number; transferred?: number; totalSize?: number }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: { status: string; version?: string; percent?: number; transferred?: number; totalSize?: number }) =>
        callback(data);
      ipcRenderer.on("app:update-status", handler);
      return () => ipcRenderer.removeListener("app:update-status", handler);
    },
  },
  tab: {
    save: (data: unknown) => ipcRenderer.invoke("tab:save", data),
    restore: () => ipcRenderer.invoke("tab:restore") as Promise<{ tabs: Array<{ id: string; type: string; title: string; filePath?: string; sessionId?: string }>; activeTabId: string | null } | null>,
  },
  agent: {
    runWorker: (projectPath: string, prompt: string) =>
      ipcRenderer.invoke("agent:runWorker", { projectPath, prompt }),
    sendMessage: (projectPath: string, message: string, opts?: { sessionId?: string | null; permissionMode?: string; model?: string; isDesigner?: boolean; images?: Array<{ type: "image"; data: string; mimeType: string }>; systemPayload?: { customType: string; content: string; display: boolean; details: Record<string, unknown> } }) =>
      ipcRenderer.invoke("agent:sendMessage", { projectPath, message, ...opts }),
    steer: (sessionId: string, text: string) =>
      ipcRenderer.invoke("agent:steer", { sessionId, text }),
      stopDelegation: (delegationId: string, taskIndex: number) =>
        ipcRenderer.invoke("agent:stop-delegation", { delegationId, taskIndex }),
    stopShell: (shellId: string) =>
      ipcRenderer.invoke("agent:stop-shell", { shellId }),
    followUp: (sessionId: string, text: string) =>
      ipcRenderer.invoke("agent:followUp", { sessionId, text }),
    compact: (sessionId: string, instructions?: string) =>
      ipcRenderer.invoke("agent:compact", { sessionId, instructions }),
    setThinkingLevel: (sessionId: string, level: string) =>
      ipcRenderer.invoke("agent:setThinkingLevel", { sessionId, level }),
    cycleModel: (sessionId: string, direction?: "forward" | "backward") =>
      ipcRenderer.invoke("agent:cycleModel", { sessionId, direction }),
    setActiveTools: (sessionId: string, toolNames: string[]) =>
      ipcRenderer.invoke("agent:setActiveTools", { sessionId, toolNames }),
    respondPermission: (requestId: string, behavior: "allow" | "deny", alwaysAllow?: boolean) =>
      ipcRenderer.invoke("agent:permission-response", { requestId, behavior, alwaysAllow }),
    onPermissionRequest: (callback: (data: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
      ipcRenderer.on("agent:permission-request", handler);
      return () => ipcRenderer.removeListener("agent:permission-request", handler);
    },
    abort: (runId: string) => ipcRenderer.invoke("agent:abort", { runId }),
    setModel: (sessionId: string, model: string) => ipcRenderer.invoke("agent:setModel", { sessionId, model }) as Promise<void>,
    spawnAgentChat: (projectPath: string, templateId: string, message: string) => ipcRenderer.invoke("agent:spawnAgentChat", { projectPath, templateId, message }) as Promise<{ chatId: string }>,
    chatStatus: (sessionId: string) => ipcRenderer.invoke("agent:chatStatus", { sessionId }),
    getBufferedStream: (sessionId: string) => ipcRenderer.invoke("agent:getBufferedStream", { sessionId }) as Promise<unknown[]>,
    killChat: (chatId: string) => ipcRenderer.invoke("agent:killChat", { chatId }) as Promise<void>,
    isStreaming: (sessionId: string) => ipcRenderer.invoke("agent:isStreaming", { sessionId }) as Promise<boolean>,
    getPiProviders: () => ipcRenderer.invoke("agent:getPiProviders") as Promise<Array<{ id: string; name: string; baseUrl?: string }>>,
    getPiModels: (providerName: string) => ipcRenderer.invoke("agent:getPiModels", { providerName }) as Promise<Array<{ id: string; name: string; contextWindow: number }>>,
    sessionStats: (sessionId: string, projectPath?: string) => ipcRenderer.invoke("agent:sessionStats", { sessionId, projectPath }) as Promise<Record<string, unknown> | null>,
    scheduleIdleTimeout: (sessionId: string, delayMs: number) => ipcRenderer.invoke("agent:scheduleIdleTimeout", { sessionId, delayMs }),
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
    onDelegationProgress: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("agent:delegation-progress", handler);
      return () => ipcRenderer.removeListener("agent:delegation-progress", handler);
    },
    onDelegationCount: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("agent:delegation-count", handler);
      return () => ipcRenderer.removeListener("agent:delegation-count", handler);
    },
    onShellCount: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("agent:shell-count", handler);
      return () => ipcRenderer.removeListener("agent:shell-count", handler);
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
    onContextRotated: (callback: (data: { chatId: string; sessionId: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { chatId: string; sessionId: string }) => callback(data);
      ipcRenderer.on("agent:context-rotated", handler);
      return () => ipcRenderer.removeListener("agent:context-rotated", handler);
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
    onCommandsChanged: (callback: (data: { commands: Array<{ name: string; description: string; argumentHint: string; aliases?: string[] }> }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { commands: Array<{ name: string; description: string; argumentHint: string; aliases?: string[] }> }) => callback(data);
      ipcRenderer.on("agent:commands-changed", handler);
      return () => ipcRenderer.removeListener("agent:commands-changed", handler);
    },
    onRenameProgress: (callback: (data: { phase: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { phase: string }) => callback(data);
      ipcRenderer.on("agent:rename-progress", handler);
      return () => ipcRenderer.removeListener("agent:rename-progress", handler);
    },
    onSessionRenamed: (callback: (data: { sessionId: string; title: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string; title: string }) => callback(data);
      ipcRenderer.on("agent:session-renamed", handler);
      return () => ipcRenderer.removeListener("agent:session-renamed", handler);
    },
  },
});
