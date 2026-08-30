import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  window: {
    openProject: (projectId: string, sessionId?: string, init?: boolean) => ipcRenderer.invoke("window:open-project", { projectId, sessionId, init }),
    newWindow: () => ipcRenderer.invoke("window:new"),
  },
  editor: {
    open: (filePath?: string) => ipcRenderer.invoke("editor:open", filePath),
    openInBrowser: (filePath?: string) => ipcRenderer.invoke("editor:open-in-browser", filePath),
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
    saveProfile: (projectPath: string, platformSpec: string) => ipcRenderer.invoke("project:saveProfile", { projectPath, platformSpec }),
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
  git: {
    detect: () => ipcRenderer.invoke("git:detect"),
  },
  nodeRuntime: {
    detect: () => ipcRenderer.invoke("node:detect"),
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
    create: (input: { name: string; description: string; prompt: string; model?: string; provider?: string; agentType?: string; thinkingLevel?: string }) => ipcRenderer.invoke("agent-template:create", { input }),
    update: (id: string, input: { name?: string; description?: string; prompt?: string; model?: string; provider?: string; agentType?: string; thinkingLevel?: string }) => ipcRenderer.invoke("agent-template:update", { id, input }),
    delete: (id: string) => ipcRenderer.invoke("agent-template:delete", { id }),
  },
  task: {
    read: (projectPath: string) => ipcRenderer.invoke("task:read", { projectPath }),
    getSubagentMessages: (sessionFile: string) =>
      ipcRenderer.invoke("task:get-subagent-messages", { sessionFile }),
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
    readLog: (logPath: string) => ipcRenderer.invoke("shell:read-log", { logPath }),
    revealInFolder: (filePath: string) => ipcRenderer.invoke("shell:reveal-in-folder", { logPath: filePath }),
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
    add: (projectPath: string, title: string, module: string) => ipcRenderer.invoke("issue:add", { projectPath, title, module }),
    setStatus: (projectPath: string, id: string, status: string) => ipcRenderer.invoke("issue:set-status", { projectPath, id, status }),
    update: (projectPath: string, id: string, patch: { title?: string; module?: string }) => ipcRenderer.invoke("issue:update", { projectPath, id, patch }),
    delete: (projectPath: string, id: string) => ipcRenderer.invoke("issue:delete", { projectPath, id }),
  },
  process: {
    detect: (projectPath: string) => ipcRenderer.invoke("process:detect", { projectPath }),
    saveRunJson: (projectPath: string, runnables: unknown[]) => ipcRenderer.invoke("process:save-run-json", { projectPath, runnables }),
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
    onRunJsonChanged: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on("process:run-json-changed", handler);
      return () => ipcRenderer.removeListener("process:run-json-changed", handler);
    },
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
    restore: () => ipcRenderer.invoke("tab:restore") as Promise<{ tabs: Array<{ id: string; type: string; title: string; filePath?: string; sessionId?: string; isDesigner?: boolean }>; activeTabId: string | null } | null>,
  },
  agent: {
    runWorker: (projectPath: string, prompt: string) =>
      ipcRenderer.invoke("agent:runWorker", { projectPath, prompt }),
    sendMessage: (projectPath: string, message: string, opts?: { sessionId?: string | null; permissionMode?: string; model?: string; isDesigner?: boolean; images?: Array<{ type: "image"; data: string; mimeType: string }>; systemPayload?: { customType: string; content: string; display: boolean; details: Record<string, unknown> }; preferredProvider?: string; tabId?: string }) =>
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
    respondAsk: (requestId: string, answers: Array<{ questionId: string; values: string[] }> | null) =>
      ipcRenderer.invoke("agent:ask-response", { requestId, answers }),
    onAskRequest: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("agent:ask-request", handler);
      return () => ipcRenderer.removeListener("agent:ask-request", handler);
    },
    onAskClosed: (callback: (data: { requestId: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string }) => callback(data);
      ipcRenderer.on("agent:ask-closed", handler);
      return () => ipcRenderer.removeListener("agent:ask-closed", handler);
    },
    onPermissionRequest: (callback: (data: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
      ipcRenderer.on("agent:permission-request", handler);
      return () => ipcRenderer.removeListener("agent:permission-request", handler);
    },
    abort: (runId: string) => ipcRenderer.invoke("agent:abort", { runId }),
    setModel: (sessionId: string, model: string, provider?: string) => ipcRenderer.invoke("agent:setModel", { sessionId, model, provider }) as Promise<void>,
    spawnAgentChat: (projectPath: string, templateId: string, message: string) => ipcRenderer.invoke("agent:spawnAgentChat", { projectPath, templateId, message }) as Promise<{ chatId: string }>,
    chatStatus: (sessionId: string) => ipcRenderer.invoke("agent:chatStatus", { sessionId }),
    getBufferedStream: (sessionId: string) => ipcRenderer.invoke("agent:getBufferedStream", { sessionId }) as Promise<unknown[]>,
    killChat: (chatId: string) => ipcRenderer.invoke("agent:killChat", { chatId }) as Promise<void>,
    killSession: (sessionId: string) => ipcRenderer.invoke("agent:kill-session", { sessionId }) as Promise<void>,
    activeSessions: () => ipcRenderer.invoke("agent:active-sessions") as Promise<string[]>,
    reclaimChat: (sessionId: string) => ipcRenderer.invoke("agent:reclaim-chat", { sessionId }) as Promise<void>,
    cancelReclaim: (sessionId: string) => ipcRenderer.invoke("agent:cancel-reclaim", { sessionId }) as Promise<void>,
    onChatClosed: (callback: (data: { sessionId: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: { sessionId: string }) => callback(data);
      ipcRenderer.on("agent:chat-closed", handler);
      return () => ipcRenderer.removeListener("agent:chat-closed", handler);
    },
    isStreaming: (sessionId: string) => ipcRenderer.invoke("agent:isStreaming", { sessionId }) as Promise<boolean>,
    getPiProviders: () => ipcRenderer.invoke("agent:getPiProviders") as Promise<Array<{ id: string; name: string; baseUrl?: string }>>,
    getPiModels: (providerName: string) => ipcRenderer.invoke("agent:getPiModels", { providerName }) as Promise<Array<{ id: string; name: string; contextWindow: number }>>,
    sessionStats: (sessionId: string, projectPath?: string) => ipcRenderer.invoke("agent:sessionStats", { sessionId, projectPath }) as Promise<Record<string, unknown> | null>,
    scheduleIdleTimeout: (sessionId: string, delayMs: number) => ipcRenderer.invoke("agent:scheduleIdleTimeout", { sessionId, delayMs }),
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
    onConfirmDev: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on("agent:confirm-dev", handler);
      return () => ipcRenderer.removeListener("agent:confirm-dev", handler);
    },
    onNewProject: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on("agent:new-project", handler);
      return () => ipcRenderer.removeListener("agent:new-project", handler);
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
    onDelegationInit: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("agent:delegation-init", handler);
      return () => ipcRenderer.removeListener("agent:delegation-init", handler);
    },
    onSubagentStream: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("agent:subagent-stream", handler);
      return () => ipcRenderer.removeListener("agent:subagent-stream", handler);
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
    onShellOutput: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("agent:shell-output", handler);
      return () => ipcRenderer.removeListener("agent:shell-output", handler);
    },
    onChatSession: (callback: (data: { chatId: string; sessionId: string; tabId?: string }) => void) => {
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
    onContextUsage: (callback: (data: { chatId: string; percentage: number | null; totalTokens: number; maxTokens: number }) => void) => {
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
  // ── 设备互联（mDNS 发现 + WS 配对连接） ──
  device: {
    getSelf: () => ipcRenderer.invoke("device:getSelf") as Promise<{ id: string; name: string; discoverable: boolean }>,
    listPaired: () => ipcRenderer.invoke("device:listPaired") as Promise<Array<{ id: string; name: string; key: string; pairedAt: number; lastSeen: number; online: boolean }>>,
    listDiscovered: () => ipcRenderer.invoke("device:listDiscovered") as Promise<Array<{ id: string; name: string; address: string; port: number }>>,
    setName: (name: string) => ipcRenderer.invoke("device:setName", { name }),
    startPair: () => ipcRenderer.invoke("device:startPair"),
    stopPair: () => ipcRenderer.invoke("device:stopPair"),
    manualScan: () => ipcRenderer.invoke("device:manualScan"),
    requestPair: (peer: { id: string; name: string; address: string; port: number }) => ipcRenderer.invoke("device:requestPair", { peer }) as Promise<{ ok: boolean; error?: string }>,
    acceptPair: (peer: { id: string; name: string; address: string; port: number }) => ipcRenderer.invoke("device:acceptPair", { peer }) as Promise<{ ok: boolean; error?: string }>,
    unpair: (id: string) => ipcRenderer.invoke("device:unpair", { id }),
    connect: (id: string) => ipcRenderer.invoke("device:connect", { id }) as Promise<{ ok: boolean; error?: string }>,
    sendMessage: (id: string, message: Record<string, unknown>) => ipcRenderer.invoke("device:sendMessage", { id, message }) as Promise<{ ok: boolean }>,
    // 事件订阅
    onPairRequest: (cb: (req: { id: string; name: string; address: string; port: number }) => void) => {
      const h = (_e: Electron.IpcRendererEvent, d: { id: string; name: string; address: string; port: number }) => cb(d);
      ipcRenderer.on("device:pair-request", h);
      return () => ipcRenderer.removeListener("device:pair-request", h);
    },
    onChanged: (cb: () => void) => {
      const h = () => cb();
      ipcRenderer.on("device:changed", h);
      return () => ipcRenderer.removeListener("device:changed", h);
    },
    onOnline: (cb: (d: { id: string }) => void) => {
      const h = (_e: Electron.IpcRendererEvent, d: { id: string }) => cb(d);
      ipcRenderer.on("device:online", h);
      return () => ipcRenderer.removeListener("device:online", h);
    },
    onOffline: (cb: (d: { id: string }) => void) => {
      const h = (_e: Electron.IpcRendererEvent, d: { id: string }) => cb(d);
      ipcRenderer.on("device:offline", h);
      return () => ipcRenderer.removeListener("device:offline", h);
    },
  },
  // ── 项目/会话迁移（发送端打包传输 + 接收端恢复） ──
  migration: {
    accept: (transferId: string, targetPath: string) => ipcRenderer.invoke("migration:accept", { transferId, targetPath }) as Promise<{ ok: boolean; error?: string }>,
    reject: (transferId: string) => ipcRenderer.invoke("migration:reject", { transferId }) as Promise<{ ok: boolean }>,
    start: (projectPath: string, deviceId: string, selection?: { files: string[]; sessions: string[] }) =>
      ipcRenderer.invoke("migration:start", { projectPath, deviceId, selection }) as Promise<{ ok: boolean; transferId?: string; error?: string }>,
    scan: (projectPath: string) => ipcRenderer.invoke("migration:scan", { projectPath }) as Promise<{
      files: Array<{ relPath: string; absPath: string; size: number; excluded: boolean }>;
      sessions: Array<{ file: string; name: string; mtime: number }>;
      totalSize: number;
      excludedCount: number;
    }>,
    getIgnore: () => ipcRenderer.invoke("migration:getIgnore") as Promise<string>,
    saveIgnore: (content: string) => ipcRenderer.invoke("migration:saveIgnore", { content }) as Promise<{ ok: boolean }>,
    resetIgnore: () => ipcRenderer.invoke("migration:resetIgnore") as Promise<string>,
    // 接收端事件(弹窗确认/完成)
    onIncoming: (cb: (d: { transferId: string; fromName: string; projectName: string; fileCount: number; totalSize: number; sessionCount: number }) => void) => {
      const h = (_e: Electron.IpcRendererEvent, d: { transferId: string; fromName: string; projectName: string; fileCount: number; totalSize: number; sessionCount: number }) => cb(d);
      ipcRenderer.on("migration:incoming", h);
      return () => ipcRenderer.removeListener("migration:incoming", h);
    },
    onCompleted: (cb: (d: { projectName: string; projectPath: string; originPath: string; fromName: string; sessionRestoredCount: number }) => void) => {
      const h = (_e: Electron.IpcRendererEvent, d: { projectName: string; projectPath: string; originPath: string; fromName: string; sessionRestoredCount: number }) => cb(d);
      ipcRenderer.on("migration:completed", h);
      return () => ipcRenderer.removeListener("migration:completed", h);
    },
    // 发送端回执(接收端恢复完成/失败)
    onReceipt: (cb: (d: { ok: boolean; projectName?: string; projectPath?: string; failures?: string[] }) => void) => {
      const h = (_e: Electron.IpcRendererEvent, d: { ok: boolean; projectName?: string; projectPath?: string; failures?: string[] }) => cb(d);
      ipcRenderer.on("migration:receipt", h);
      return () => ipcRenderer.removeListener("migration:receipt", h);
    },
    // 接收端传输进度(每块到达更新)
    onProgress: (cb: (d: { transferId: string; received: number }) => void) => {
      const h = (_e: Electron.IpcRendererEvent, d: { transferId: string; received: number }) => cb(d);
      ipcRenderer.on("migration:progress", h);
      return () => ipcRenderer.removeListener("migration:progress", h);
    },
    // 发送端传输进度(本地发送统计;phase: scanning 扫描 / packing 打包 / waiting 等待确认 / transferring 传输中 / sent 已发送 / rejected 被拒 / timeout 超时)
    onSendProgress: (cb: (d: { transferId: string; sent: number; total: number; phase?: "scanning" | "packing" | "waiting" | "transferring" | "sent" | "rejected" | "timeout" }) => void) => {
      const h = (_e: Electron.IpcRendererEvent, d: { transferId: string; sent: number; total: number; phase?: "scanning" | "packing" | "waiting" | "transferring" | "sent" | "rejected" | "timeout" }) => cb(d);
      ipcRenderer.on("migration:send-progress", h);
      return () => ipcRenderer.removeListener("migration:send-progress", h);
    },
    // 接收端阶段(verify 校验 / extract 解压 / session 会话恢复 / done 完成)
    onStage: (cb: (d: { transferId: string; stage: "verify" | "extract" | "session" | "done" }) => void) => {
      const h = (_e: Electron.IpcRendererEvent, d: { transferId: string; stage: "verify" | "extract" | "session" | "done" }) => cb(d);
      ipcRenderer.on("migration:stage", h);
      return () => ipcRenderer.removeListener("migration:stage", h);
    },
  },
  // Windows 防火墙放行提示(设备互联,一次)
  onFirewallHint: (cb: (d: { port: number }) => void) => {
    const h = (_e: Electron.IpcRendererEvent, d: { port: number }) => cb(d);
    ipcRenderer.on("device:firewall-hint", h);
    return () => ipcRenderer.removeListener("device:firewall-hint", h);
  },
});
