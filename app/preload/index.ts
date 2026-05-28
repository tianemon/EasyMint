import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
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
    delete: (sessionId: string) => ipcRenderer.invoke("session:delete", { sessionId }),
  },
  claude: {
    detect: () => ipcRenderer.invoke("claude:detect"),
  },
});
