import { BrowserWindow, ipcMain, dialog } from "electron";
import { ProjectService } from "./services/project-service";
import { FileService } from "./services/file-service";
import { AgentService } from "./services/agent-service";
import { Store } from "./services/store";
import { detectClaude } from "./utils/claude-detector";
import { execShell } from "./services/shell-service";
import { closeProjectWindows } from "./services/window-manager";
import {
  getSystemPromptConfig,
  createSystemPrompt,
  updateSystemPrompt,
  deleteSystemPrompt,
  updateAppendSetting,
  setDefaultPrompt,
} from "./services/system-prompt-manager";
import {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from "./services/agent-templates";
import {
  scanSkills,
  readSkill,
  importSkill,
  deleteSkill,
  toggleSkill,
  buildSkillsPrompt,
} from "./services/skill-service";
import {
  scanMcpServers,
  buildMcpServersOption,
  toggleMcpServer,
  getMcpRequiredKeys,
} from "./services/mcp-service";
import {
  trackUpload,
  getUploadStats,
  cleanFiles,
  cleanAll,
} from "./services/upload-cache";
import {
  listSessions,
  getSessionMessages,
  renameSession,
  deleteSession,
  getSessionInfo,
  togglePin,
  archiveSession,
  unarchiveSession,
} from "./services/session-service";

interface Services {
  mainWindow: BrowserWindow;
  projectService: ProjectService;
  fileService: FileService;
  agentService: AgentService;
  store: Store;
}

export function registerIpcHandlers({ mainWindow, projectService, fileService, agentService, store }: Services): void {
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
  ipcMain.handle("project:delete", (_e, { id }) => {
    if (closeProjectWindows) closeProjectWindows(id);
    projectService.delete(id);
  });
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
  ipcMain.handle("agent:chatStatus", (_e, { sessionId }) => {
    return agentService.getChatStatus(sessionId);
  });
  ipcMain.handle("agent:getBufferedStream", (_e, { sessionId }) => {
    return agentService.getBufferedStream(sessionId);
  });
  ipcMain.handle("agent:setModel", (_e, { sessionId, model }) => {
    return agentService.setModel(sessionId, model);
  });
  ipcMain.handle("agent:notifySession", (_e, { sessionId, message }) => {
    agentService.notifySession(sessionId, message);
  });
  ipcMain.handle("agent:spawnAgentChat", (_e, { projectPath, templateId, message }) => {
    return agentService.spawnAgentChat(projectPath, templateId, message);
  });
  ipcMain.handle("agent:sendMessage", (_e, { projectPath, message, sessionId, permissionMode, model }) => {
    return agentService.sendMessage(projectPath, message, sessionId ?? null, permissionMode, mainWindow, model);
  });
  ipcMain.handle("agent:ensureActive", (_e, { projectPath, sessionId }) => {
    agentService.ensureActive(projectPath, sessionId);
  });
  ipcMain.handle("agent:killChat", (_e, { chatId }) => {
    agentService.killChat(chatId);
  });
  ipcMain.handle("agent:stopChat", (_e, { chatId }) => {
    agentService.stopChat(chatId);
  });

  // agent-template:*
  ipcMain.handle("agent-template:list", () => listTemplates());
  ipcMain.handle("agent-template:create", (_e, { input }) => createTemplate(input));
  ipcMain.handle("agent-template:update", (_e, { id, input }) => updateTemplate(id, input));
  ipcMain.handle("agent-template:delete", (_e, { id }) => { deleteTemplate(id); });

  // skill:*
  ipcMain.handle("skill:list", (_e, { projectPath }: { projectPath?: string }) => scanSkills(projectPath));
  ipcMain.handle("skill:get", (_e, { skillPath }: { skillPath: string }) => readSkill(skillPath));
  ipcMain.handle("skill:import", (_e, { sourcePath, level, projectPath }: { sourcePath: string; level: "global" | "project"; projectPath?: string }) => importSkill(sourcePath, level, projectPath));
  ipcMain.handle("skill:delete", (_e, { skillPath }: { skillPath: string }) => { deleteSkill(skillPath); });
  ipcMain.handle("skill:toggle", (_e, { name, enabled }: { name: string; enabled: boolean }) => { toggleSkill(name, enabled); });
  ipcMain.handle("skill:buildPrompt", (_e, { projectPath }: { projectPath?: string }) => buildSkillsPrompt(projectPath));

  // mcp:*
  ipcMain.handle("mcp:list", () => scanMcpServers());
  ipcMain.handle("mcp:toggle", (_e, { name, enabled }: { name: string; enabled: boolean }) => { toggleMcpServer(name, enabled); });
  ipcMain.handle("mcp:requiredKeys", () => getMcpRequiredKeys());

  // upload:*
  ipcMain.handle("upload:stats", (_e, { sortBy }: { sortBy?: "time" | "size" }) => getUploadStats(sortBy));
  ipcMain.handle("upload:clean", (_e, { filenames }: { filenames: string[] }) => cleanFiles(filenames));
  ipcMain.handle("upload:cleanAll", () => cleanAll());

  // conversation:* — backed by SDK session APIs
  ipcMain.handle("conv:list", (_e, { projectPath }) => listSessions(projectPath));
  ipcMain.handle("conv:get", (_e, { id, projectPath }) => getSessionInfo(id, projectPath));
  ipcMain.handle("conv:messages", (_e, { id, projectPath }) => getSessionMessages(id, projectPath));
  ipcMain.handle("conv:rename", (_e, { id, title, projectPath }) => renameSession(id, title, projectPath));
  ipcMain.handle("conv:delete", (_e, { id, projectPath }) => { deleteSession(id, projectPath); });
  ipcMain.handle("conv:togglePin", (_e, { id }) => togglePin(id));
  ipcMain.handle("conv:archiveSession", (_e, { sessionId }) => { archiveSession(sessionId); });
  ipcMain.handle("conv:unarchiveSession", (_e, { sessionId }) => { unarchiveSession(sessionId); });

  // claude:*
  ipcMain.handle("claude:detect", () => detectClaude());

  // settings:*
  ipcMain.handle("settings:get", () => store.getSettings());
  ipcMain.handle("settings:set", (_e, { key, value }) => {
    const settings = store.getSettings();
    (settings as unknown as Record<string, unknown>)[key] = value;
    store.saveSettings(settings);
  });
  ipcMain.handle("settings:fetchModels", async () => {
    const settings = store.getSettings();
    const rawUrl = settings.apiBaseUrl || "https://api.deepseek.com";
    const apiKey = settings.apiKey;
    if (!apiKey) throw new Error("请先配置 API Key");
    // /models is at API root, not under /anthropic etc.
    const origin = new URL(rawUrl).origin;
    const url = `${origin}/models`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json() as { data?: { id: string }[] };
    return (json.data || []).map((m: { id: string }) => m.id);
  });
  ipcMain.handle("settings:fetchBalance", async () => {
    const settings = store.getSettings();
    const rawUrl = settings.apiBaseUrl || "https://api.deepseek.com";
    const apiKey = settings.apiKey;
    if (!apiKey) throw new Error("请先配置 API Key");
    const origin = new URL(rawUrl).origin;
    const url = `${origin}/user/balance`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json() as { balance_infos?: { currency: string; total_balance: string; granted_balance: string; topped_up_balance: string }[] };
    return json;
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

  // system-prompt:*
  ipcMain.handle("system-prompt:get-config", () => getSystemPromptConfig());
  ipcMain.handle("system-prompt:create", (_e, input) => createSystemPrompt(input));
  ipcMain.handle("system-prompt:update", (_e, { id, input }) => updateSystemPrompt(id, input));
  ipcMain.handle("system-prompt:delete", (_e, { id }) => { deleteSystemPrompt(id); });
  ipcMain.handle("system-prompt:update-append", (_e, { enabled }) => { updateAppendSetting(enabled); });
  ipcMain.handle("system-prompt:set-default", (_e, { id }) => { setDefaultPrompt(id); });

  // project:checkInitStatus — check if init.sh has been filled
  ipcMain.handle("project:checkInitStatus", (_e, { projectPath }) => {
    try {
      const p = require("path");
      const fs = require("fs");
      const filePath = p.join(projectPath, "init.sh");
      if (!fs.existsSync(filePath)) return { done: false, reason: "init.sh not found" };
      const content = fs.readFileSync(filePath, "utf-8");
      return { done: !content.includes("{{PROJECT_DIR}}"), reason: content.includes("{{PROJECT_DIR}}") ? "still template" : "filled" };
    } catch { return { done: false, reason: "error" }; }
  });

  // project:readState — read .easymint/state.json in project
  ipcMain.handle("project:readState", (_e, { projectPath }) => {
    try {
      const p = require("path");
      const fs = require("fs");
      const filePath = p.join(projectPath, ".easymint", "state.json");
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch { return null; }
  });

  // project:writeState — write .easymint/state.json in project
  ipcMain.handle("project:writeState", (_e, { projectPath, state }) => {
    try {
      const p = require("path");
      const fs = require("fs");
      const dir = p.join(projectPath, ".easymint");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(p.join(dir, "state.json"), JSON.stringify(state, null, 2));
      return true;
    } catch { return false; }
  });

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
        command: "",
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

  // file:saveUpload — save uploaded image to ~/.easymint/uploads/
  ipcMain.handle("file:saveUpload", async (_e, { name, data }: { name: string; data: number[] }) => {
    const os = require("os");
    const fs = require("fs");
    const p = require("path");
    const uploadDir = p.join(os.homedir(), ".easymint", "uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const timestamp = Date.now();
    const safeName = `${timestamp}-${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const filePath = p.join(uploadDir, safeName);
    const buf = Buffer.from(data);
    fs.writeFileSync(filePath, buf);
    const ext = p.extname(name).toLowerCase();
    const mimeMap: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml" };
    const mime = mimeMap[ext] || "image/png";
    const result = { path: filePath, dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
    trackUpload(safeName, buf.length);
    return result;
  });

  // file:readUpload — read an uploaded file and return as data URL (for history restore)
  ipcMain.handle("file:readUpload", async (_e, { filePath }: { filePath: string }) => {
    const fs = require("fs");
    const p = require("path");
    const os = require("os");
    // Security: only allow files under ~/.easymint/uploads/
    const allowedDir = p.resolve(p.join(os.homedir(), ".easymint", "uploads"));
    if (!p.resolve(filePath).startsWith(allowedDir)) return null;
    if (!fs.existsSync(filePath)) return null;
    const buf = fs.readFileSync(filePath);
    const ext = p.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml" };
    const mime = mimeMap[ext] || "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
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

}
