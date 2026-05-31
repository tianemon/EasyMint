import { BrowserWindow, ipcMain, dialog } from "electron";
import { ProjectService } from "./services/project-service";
import { FileService } from "./services/file-service";
import { AgentService } from "./services/agent-service";
import { EvaluatorService } from "./services/evaluator-service";
import { Store } from "./services/store";
import { detectClaude } from "./utils/claude-detector";
import { execShell } from "./services/shell-service";
import {
  getSystemPromptConfig,
  createSystemPrompt,
  updateSystemPrompt,
  deleteSystemPrompt,
  updateAppendSetting,
  setDefaultPrompt,
  PROJECT_INIT_INSTRUCTION,
} from "./services/system-prompt-manager";
import {
  listSessions,
  getSessionMessages,
  renameSession,
  deleteSession,
  getSessionInfo,
  togglePin,
} from "./services/session-service";

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
    // Try chat first (chat uses chatId), fall back to worker runs
    agentService.stopChat(runId);
    agentService.abort(runId);
  });
  ipcMain.handle("agent:isSessionActive", (_e, { sessionId }) => {
    return agentService.getActiveChatId(sessionId);
  });
  ipcMain.handle("agent:sendMessage", (_e, { projectPath, message, sessionId, permissionMode }) => {
    return agentService.sendMessage(projectPath, message, sessionId ?? null, permissionMode, mainWindow);
  });
  ipcMain.handle("agent:stopChat", (_e, { chatId }) => {
    agentService.stopChat(chatId);
  });

  // conversation:* — backed by SDK session APIs
  ipcMain.handle("conv:list", (_e, { projectPath }) => listSessions(projectPath));
  ipcMain.handle("conv:get", (_e, { id, projectPath }) => getSessionInfo(id, projectPath));
  ipcMain.handle("conv:messages", (_e, { id, projectPath }) => getSessionMessages(id, projectPath));
  ipcMain.handle("conv:rename", (_e, { id, title, projectPath }) => renameSession(id, title, projectPath));
  ipcMain.handle("conv:delete", (_e, { id, projectPath }) => { deleteSession(id, projectPath); });
  ipcMain.handle("conv:togglePin", (_e, { id }) => togglePin(id));

  // claude:*
  ipcMain.handle("claude:detect", () => detectClaude());

  // settings:*
  ipcMain.handle("settings:get", () => store.getSettings());
  ipcMain.handle("settings:set", (_e, { key, value }) => {
    const settings = store.getSettings();
    (settings as unknown as Record<string, unknown>)[key] = value;
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

  // system-prompt:*
  ipcMain.handle("system-prompt:get-config", () => getSystemPromptConfig());
  ipcMain.handle("system-prompt:create", (_e, input) => createSystemPrompt(input));
  ipcMain.handle("system-prompt:update", (_e, { id, input }) => updateSystemPrompt(id, input));
  ipcMain.handle("system-prompt:delete", (_e, { id }) => { deleteSystemPrompt(id); });
  ipcMain.handle("system-prompt:update-append", (_e, { enabled }) => { updateAppendSetting(enabled); });
  ipcMain.handle("system-prompt:set-default", (_e, { id }) => { setDefaultPrompt(id); });
  ipcMain.handle("system-prompt:get-init-instruction", () => PROJECT_INIT_INSTRUCTION);

  // task:read — read task.json and return tasks
  ipcMain.handle("task:read", (_e, { projectPath }) => {
    try {
      const p = require("path");
      const fs = require("fs");
      const filePath = p.join(projectPath, "task.json");
      if (!fs.existsSync(filePath)) return { tasks: [] };
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return { tasks: (data.tasks || []).map((t: { id: number; title: string; description?: string; steps?: string[]; passes?: boolean }) => ({
        id: String(t.id),
        title: t.title,
        description: t.description || (t.steps ? t.steps.join("; ") : ""),
        command: `bash init.sh`,
        passes: t.passes ?? false,
      })) };
    } catch { return { tasks: [] }; }
  });

  // task:markDone — update passes field in task.json
  ipcMain.handle("task:markDone", (_e, { projectPath, taskId }) => {
    try {
      const p = require("path");
      const fs = require("fs");
      const filePath = p.join(projectPath, "task.json");
      if (!fs.existsSync(filePath)) return false;
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const task = (data.tasks || []).find((t: { id: number }) => String(t.id) === String(taskId));
      if (task) {
        task.passes = true;
        task.evaluated = false;
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      }
      return true;
    } catch { return false; }
  });

  // shell:exec — run a shell command in project directory, stream output
  ipcMain.handle("shell:exec", async (event, { projectPath, command }) => {
    const result = await execShell(
      projectPath,
      command,
      (line) => event.sender.send("shell:stdout", { line }),
      (line) => event.sender.send("shell:stderr", { line }),
    );
    return { code: result.code };
  });

  // worker 成功后自动触发 evaluator（如果评估模式开启）
  agentService.onWorkerComplete = (projectPath: string) => {
    const settings = store.getSettings();
    if (settings.evaluateMode) {
      evaluatorService.runEvaluator(projectPath, mainWindow);
    }
  };
}
