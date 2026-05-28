import { BrowserWindow, ipcMain } from "electron";
import { ProjectService } from "./services/project-service";
import { FileService } from "./services/file-service";
import { AgentService } from "./services/agent-service";
import { Store } from "./services/store";
import { detectClaude } from "./utils/claude-detector";

interface Services {
  mainWindow: BrowserWindow;
  projectService: ProjectService;
  fileService: FileService;
  agentService: AgentService;
  store: Store;
}

export function registerIpcHandlers({ mainWindow, projectService, fileService, agentService, store }: Services): void {
  // project:*
  ipcMain.handle("project:list", () => projectService.list());
  ipcMain.handle("project:create", (_e, opts) => projectService.create(opts));
  ipcMain.handle("project:delete", (_e, { id }) => projectService.delete(id));
  ipcMain.handle("project:get", (_e, { id }) => projectService.get(id));

  // file:*
  ipcMain.handle("file:readTree", (_e, { dirPath }) => fileService.readTree(dirPath));
  ipcMain.handle("file:readContent", (_e, { filePath }) => fileService.readContent(filePath));
  ipcMain.handle("file:writeContent", (_e, { filePath, content }) => fileService.writeContent(filePath, content));

  // terminal:*
  ipcMain.handle("terminal:create", (_e, { cwd }) => agentService.createTerminal(cwd, mainWindow));
  ipcMain.on("terminal:write", (_e, { terminalId, data }) => agentService.write(terminalId, data));
  ipcMain.on("terminal:resize", (_e, { terminalId, cols, rows }) => agentService.resize(terminalId, cols, rows));
  ipcMain.on("terminal:destroy", (_e, { terminalId }) => agentService.destroyTerminal(terminalId));

  // session:*
  ipcMain.handle("session:list", (_e, { projectId }) => store.listSessions(projectId));
  ipcMain.on("session:resume", (_e, { sessionId }) => agentService.resumeSession(sessionId, mainWindow));
  ipcMain.handle("session:delete", (_e, { projectId, sessionId }) => store.deleteSession(projectId, sessionId));

  // agent:*
  ipcMain.handle("agent:runWorker", (_e, { projectPath, prompt }) =>
    agentService.runWorker(projectPath, prompt, mainWindow)
  );
  ipcMain.handle("agent:abort", (_e, { runId }) => {
    agentService.abort(runId);
  });
  ipcMain.handle("agent:startChat", (_e, { projectPath }) =>
    agentService.startChat(projectPath, mainWindow)
  );
  ipcMain.handle("agent:sendMessage", (_e, { chatId, message }) => {
    agentService.sendMessage(chatId, message);
  });
  ipcMain.handle("agent:stopChat", (_e, { chatId }) => {
    agentService.stopChat(chatId);
  });

  // claude:*
  ipcMain.handle("claude:detect", () => detectClaude());

  // settings:*
  ipcMain.handle("settings:get", () => store.getSettings());
  ipcMain.handle("settings:set", (_e, { key, value }) => {
    const settings = store.getSettings();
    if (key === "theme") {
      settings.theme = value as "dark" | "light";
    } else if (key === "evaluateMode") {
      settings.evaluateMode = value as boolean;
    }
    store.saveSettings(settings);
  });

  // evaluator:*
  ipcMain.handle("evaluator:isEnabled", () => {
    const settings = store.getSettings();
    return settings.evaluateMode ?? false;
  });
  ipcMain.handle("evaluator:setEnabled", (_e, { enabled }) => {
    const settings = store.getSettings();
    settings.evaluateMode = enabled;
    store.saveSettings(settings);
  });
  ipcMain.handle("evaluator:status", () => ({ running: false }));
}
