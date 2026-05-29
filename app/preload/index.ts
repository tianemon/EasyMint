import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  dialog: {
    openDirectory: () => ipcRenderer.invoke("dialog:openDirectory"),
  },
  project: {
    list: () => ipcRenderer.invoke("project:list"),
    create: (opts: { name: string; path: string }) => ipcRenderer.invoke("project:create", opts),
    delete: (id: string) => ipcRenderer.invoke("project:delete", { id }),
    get: (id: string) => ipcRenderer.invoke("project:get", { id }),
  },
  file: {
    readTree: (dirPath: string) => ipcRenderer.invoke("file:readTree", { dirPath }),
    readContent: (filePath: string) => ipcRenderer.invoke("file:readContent", { filePath }),
    writeContent: (filePath: string, content: string) =>
      ipcRenderer.invoke("file:writeContent", { filePath, content }),
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
  conv: {
    list: () => ipcRenderer.invoke("conv:list"),
    create: (title?: string) => ipcRenderer.invoke("conv:create", { title }),
    update: (id: string, patch: Record<string, unknown>) => ipcRenderer.invoke("conv:update", { id, patch }),
    delete: (id: string) => ipcRenderer.invoke("conv:delete", { id }),
    messages: (id: string) => ipcRenderer.invoke("conv:messages", { id }),
    appendMessage: (convId: string, message: Record<string, unknown>) => ipcRenderer.invoke("conv:appendMessage", { convId, message }),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (key: string, value: unknown) => ipcRenderer.invoke("settings:set", { key, value }),
  },
  evaluator: {
    isEnabled: () => ipcRenderer.invoke("evaluator:isEnabled"),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke("evaluator:setEnabled", { enabled }),
    status: () => ipcRenderer.invoke("evaluator:status"),
    runEvaluator: (projectPath: string) => ipcRenderer.invoke("evaluator:runEvaluator", { projectPath }),
    abort: (evalId: string) => ipcRenderer.invoke("evaluator:abort", { evalId }),
  },
  agent: {
    runWorker: (projectPath: string, prompt: string) =>
      ipcRenderer.invoke("agent:runWorker", { projectPath, prompt }),
    sendMessage: (projectPath: string, message: string, sessionId?: string | null) =>
      ipcRenderer.invoke("agent:sendMessage", { projectPath, message, sessionId }),
    abort: (runId: string) => ipcRenderer.invoke("agent:abort", { runId }),
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
  },
});
