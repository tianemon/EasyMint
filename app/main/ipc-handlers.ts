import { BrowserWindow, ipcMain, dialog } from "electron";
import { ProjectService } from "./services/project-service";
import { FileService } from "./services/file-service";
import { AgentService } from "./services/agent-service";
import { EvaluatorService } from "./services/evaluator-service";
import { Store } from "./services/store";
import { detectClaude } from "./utils/claude-detector";

interface Services {
  mainWindow: BrowserWindow;
  projectService: ProjectService;
  fileService: FileService;
  agentService: AgentService;
  evaluatorService: EvaluatorService;
  store: Store;
}

export function registerIpcHandlers({ mainWindow, projectService, fileService, agentService, evaluatorService, store }: Services): void {
  // dialog:*
  ipcMain.handle("dialog:openDirectory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      title: "选择项目目录",
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  // project:*
  ipcMain.handle("project:list", () => projectService.list());
  ipcMain.handle("project:create", (_e, opts) => projectService.create(opts));
  ipcMain.handle("project:delete", (_e, { id }) => projectService.delete(id));
  ipcMain.handle("project:get", (_e, { id }) => projectService.get(id));

  // file:*
  ipcMain.handle("file:readTree", (_e, { dirPath }) => fileService.readTree(dirPath));
  ipcMain.handle("file:readContent", (_e, { filePath }) => fileService.readContent(filePath));
  ipcMain.handle("file:writeContent", (_e, { filePath, content }) => fileService.writeContent(filePath, content));

  // session:*
  ipcMain.handle("session:list", (_e, { projectId }) => {
    if (!projectId || typeof projectId !== "string") return [];
    return store.listSessions(projectId);
  });
  ipcMain.handle("session:delete", (_e, { projectId, sessionId }) => {
    if (!projectId || typeof projectId !== "string") return;
    store.deleteSession(projectId, sessionId);
  });

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
    if (key === "evaluateMode") {
      settings.evaluateMode = value as boolean;
    } else if (key === "tddMode") {
      settings.tddMode = value as boolean;
    } else if (key === "screenshotVerification") {
      settings.screenshotVerification = value as boolean;
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
  ipcMain.handle("evaluator:status", () => ({
    running: evaluatorService.isRunning,
  }));
  ipcMain.handle("evaluator:runEvaluator", (_e, { projectPath }) =>
    evaluatorService.runEvaluator(projectPath, mainWindow)
  );
  ipcMain.handle("evaluator:abort", (_e, { evalId }) => {
    evaluatorService.abort(evalId);
  });

  // worker 成功后自动触发 evaluator（如果评估模式开启）
  agentService.onWorkerComplete = (projectPath: string) => {
    const settings = store.getSettings();
    if (settings.evaluateMode) {
      evaluatorService.runEvaluator(projectPath, mainWindow);
    }
  };
}
