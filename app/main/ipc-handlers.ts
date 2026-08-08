import { BrowserWindow, ipcMain, dialog, app, shell } from "electron";
import p from "path";
import fs from "fs";
import os from "os";
import { ProjectService } from "./services/project-service";
import { FileService } from "./services/file-service";
import { AgentService, getDesignSessionIds } from "./services/agent-service";
import { Store } from "./services/store";
import { broadcast } from "./services/ipc-broadcast";
import { resetModelRuntime } from "./services/pi-init";
import { permissionService } from "./services/permission/agent-permission-service";
import { IMAGE_MIME } from "./utils/paths";
import { execShell } from "./services/shell-service";
import { backgroundShellRegistry } from "./services/background-shell/registry";
import { closeProjectWindows } from "./services/window-manager";
import { detectGit } from "./utils/git-detector";
import { detectNode } from "./utils/node-detector";
import { detectCodegraph } from "./utils/codegraph-detector";
import {
  getSystemPromptConfig,
  createSystemPrompt,
  updateSystemPrompt,
  deleteSystemPrompt,
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
  toggleSkill,
  buildSkillsPrompt,
} from "./services/skill-service";
import {
  scanMcpServers,
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
  listDesignSessions,
  getSessionMessages,
  getSubagentMessages,
  renameSession,
  deleteSession,
  getSessionInfo,
  togglePin,
  archiveSession,
  unarchiveSession,
} from "./services/session-service";
import { readCache, writeCache, deleteCache } from "./services/session-cache";
import { listIssues, addIssue, setStatus, appendNote, deleteIssue } from "./services/issue-service";
import { getPins, setPins } from "./services/pin-service";
import type { IssueStatus } from "./services/issue-service";
import { detectRunnable, startProcess, stopProcess, restartProcess, getStatus, getRunningIds, checkPort, killPort } from "./services/process-service";
import { networkService } from "./services/network-service";
import { migrationService } from "./services/migration-service";

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

  // win:* — Windows 自绘窗口按钮控制
  ipcMain.handle("win:minimize", (e) => { BrowserWindow.fromWebContents(e.sender)?.minimize(); });
  ipcMain.handle("win:maximize", (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    if (w.isMaximized()) w.unmaximize(); else w.maximize();
  });
  ipcMain.handle("win:close", (e) => { BrowserWindow.fromWebContents(e.sender)?.close(); });
  ipcMain.handle("win:isMaximized", (e) => BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false);

  // project:*
  ipcMain.handle("project:list", () => projectService.list());
  ipcMain.handle("project:create", (_e, opts) => projectService.create(opts));
  ipcMain.handle("project:delete", async (_e, { id }) => {
    if (closeProjectWindows) closeProjectWindows(id);
    await projectService.delete(id);
  });
  ipcMain.handle("project:get", (_e, { id }) => projectService.get(id));
  ipcMain.handle("project:update", (_e, { id, patch }) => projectService.update(id, patch));
  ipcMain.handle("project:import", (_e, { dirPath }) => projectService.import_(dirPath));

  // project:rename-exec — 委托 projectService.rename() + 进度事件 + relaunch
  ipcMain.handle("project:rename-exec", async (_e, { oldPath, newName }: { oldPath: string; newName: string }) => {
    const oldDir = p.resolve(oldPath);

    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send("agent:rename-progress", { phase: "copying" });
    });

    const result = await projectService.rename(oldDir, newName);
    if (!result.ok) return result;

    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send("agent:rename-progress", { phase: "finalizing" });
    });

    app.relaunch();
    app.quit();

    return { ok: true };
  });

  // file:*
  ipcMain.handle("file:readTree", (_e, { dirPath }) => fileService.readTree(dirPath));
  ipcMain.handle("file:readContent", (_e, { filePath }) => fileService.readContent(filePath));
  ipcMain.handle("file:writeContent", (_e, { filePath, content }) => fileService.writeContent(filePath, content));
  ipcMain.handle("file:createFile", (_e, { filePath, content }) => fileService.createFile(filePath, content ?? ""));
  ipcMain.handle("file:createFolder", (_e, { dirPath }) => fileService.createFolder(dirPath));

  // agent:*
  ipcMain.handle("agent:runWorker", (_e, { projectPath, prompt }) =>
    agentService.runWorker(projectPath, prompt, mainWindow)
  );
  ipcMain.handle("agent:abort", (_e, { runId }) => {
    // 打断（chat 与 worker 统一处理）：abort 当前回合，保留会话/run 注册表
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
  ipcMain.handle("agent:spawnAgentChat", (_e, { projectPath, templateId, message }) => {
    return agentService.spawnAgentChat(projectPath, templateId, message);
  });
  // ── 群聊会话(需求 4:多 Agent 同一会话,应用层消息转发) ──
  ipcMain.handle("group:create", (_e, { projectPath, templateIds, presetId, message, permissionMode, thinkingLevel }) => {
    return agentService.createGroupChat(projectPath, templateIds, { presetId, message, permissionMode, thinkingLevel });
  });
  ipcMain.handle("group:send", (_e, { groupId, text }) => {
    return agentService.sendGroupMessage(groupId, text);
  });
  ipcMain.handle("group:list", (_e, { projectPath }) => {
    return agentService.listGroupChats(projectPath);
  });
  ipcMain.handle("group:messages", (_e, { projectPath, groupId }) => {
    return agentService.getGroupRecord(projectPath, groupId);
  });
  ipcMain.handle("group:close", (_e, { groupId }) => {
    agentService.closeGroupChat(groupId);
  });
  ipcMain.handle("agent:sendMessage", async (_e, { projectPath, message, sessionId, permissionMode, model, isDesigner, images, thinkingLevel, systemPayload, preferredProvider }) => {
    try {
      return await agentService.sendMessage(projectPath, message, sessionId ?? null, permissionMode, mainWindow, model, isDesigner, images, thinkingLevel, systemPayload, preferredProvider);
    } catch (e) {
      console.error("[ipc] sendMessage 失败:", (e as Error).message);
      throw e;
    }
  });
  ipcMain.handle("agent:stop-delegation", (_e, { delegationId, taskIndex }) =>
    agentService.stopDelegationTask(delegationId, taskIndex),
  );
  ipcMain.handle("agent:stop-shell", (_e, { shellId }) => {
    backgroundShellRegistry.stop(String(shellId ?? ""));
  });
  ipcMain.handle("agent:steer", (_e, { sessionId, text }) => {
    agentService.steer(sessionId, text);
  });
  ipcMain.handle("agent:followUp", (_e, { sessionId, text }) => {
    agentService.followUp(sessionId, text);
  });
  ipcMain.handle("agent:compact", async (_e, { sessionId, instructions }) => {
    await agentService.compact(sessionId, instructions);
  });
  ipcMain.handle("agent:setThinkingLevel", (_e, { sessionId, level }) => {
    agentService.setThinkingLevel(sessionId, level);
  });
  ipcMain.handle("agent:cycleModel", async (_e, { sessionId, direction }) => {
    await agentService.cycleModel(sessionId, direction);
  });
  ipcMain.handle("agent:setActiveTools", (_e, { sessionId, toolNames }) => {
    agentService.setActiveTools(sessionId, toolNames);
  });
  ipcMain.handle("agent:permission-response", (_e, { requestId, behavior, alwaysAllow }) => {
    const sid = permissionService.respondToPermission(requestId, behavior, alwaysAllow);
    if (sid) broadcast("agent:permission-resolved", { requestId, sessionId: sid, behavior });
  });
  ipcMain.handle("agent:getPiProviders", async () => {
    const { getPiProviders } = await import("./services/pi-init");
    return await getPiProviders();
  });
  ipcMain.handle("agent:getPiModels", async (_e, { providerName }) => {
    const { getPiModels } = await import("./services/pi-init");
    return getPiModels(providerName);
  });
  ipcMain.handle("agent:isStreaming", (_e, { sessionId }) => {
    return agentService.isStreaming(sessionId);
  });
  ipcMain.handle("agent:sessionStats", async (_e, { sessionId, projectPath }) => {
    return agentService.getSessionStats(sessionId, projectPath);
  });
  ipcMain.handle("agent:peekUsage", async (_e, { projectPath, sessionId }) => {
    await agentService.peekUsage(projectPath, sessionId);
  });
  ipcMain.handle("agent:killChat", (_e, { chatId }) => {
    agentService.killChat(chatId);
  });

  ipcMain.handle("agent:scheduleIdleTimeout", (_e, { sessionId, delayMs }) => {
    agentService.scheduleIdleTimeout(sessionId, delayMs);
  });

  // agent-template:*
  ipcMain.handle("agent-template:list", () => listTemplates());
  ipcMain.handle("agent-template:create", (_e, { input }) => createTemplate(input));
  ipcMain.handle("agent-template:update", (_e, { id, input }) => updateTemplate(id, input));
  ipcMain.handle("agent-template:delete", (_e, { id }) => { deleteTemplate(id); });

  // skill:*
  ipcMain.handle("skill:list", (_e, { projectPath }: { projectPath?: string }) => scanSkills(projectPath));
  ipcMain.handle("skill:get", (_e, { skillPath }: { skillPath: string }) => readSkill(skillPath));
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
  ipcMain.handle("upload:openDir", () => {
    const dir = p.join(os.homedir(), ".easymint", "uploads");
    shell.openPath(dir);
  });

  // conversation:* — backed by SDK session APIs
  // issue:* - 本地问题记录
  ipcMain.handle("issue:list", (_e, { projectPath }) => listIssues(projectPath));
  ipcMain.handle("issue:add", (_e, { projectPath, title, module, symptom }) => addIssue(projectPath, title, module, symptom));
  ipcMain.handle("issue:set-status", (_e, { projectPath, id, status }) => setStatus(projectPath, id, status as IssueStatus));
  ipcMain.handle("issue:append-note", (_e, { projectPath, id, content }) => appendNote(projectPath, id, content));
  ipcMain.handle("issue:delete", (_e, { projectPath, id }) => deleteIssue(projectPath, id));

  // process:* - 项目运行进程管理（按 commandId）
  ipcMain.handle("process:detect", (_e, { projectPath }) => detectRunnable(projectPath));
  ipcMain.handle("process:start", (_e, { projectPath, commandId, port }) => startProcess(projectPath, commandId, port));
  ipcMain.handle("process:stop", (_e, { commandId }) => stopProcess(commandId));
  ipcMain.handle("process:restart", (_e, { projectPath, commandId }) => restartProcess(projectPath, commandId));
  ipcMain.handle("process:status", (_e, { commandId }) => getStatus(commandId));
  ipcMain.handle("process:running-ids", () => getRunningIds());
  ipcMain.handle("process:checkPort", (_e, { port }) => checkPort(port));
  ipcMain.handle("process:killPort", (_e, { port }) => killPort(port));
  ipcMain.handle("conv:list", (_e, { projectPath }) => listSessions(projectPath));
  ipcMain.handle("conv:listDesign", (_e, { projectPath }) => listDesignSessions(projectPath));
  ipcMain.handle("conv:get", (_e, { id, projectPath }) => getSessionInfo(id, projectPath));
  ipcMain.handle("conv:design-sessions", () => getDesignSessionIds());
  ipcMain.handle("conv:messages", (_e, { id, projectPath }) => getSessionMessages(id, projectPath));
  // 子 Agent 会话消息(按 jsonl 路径读;前端查看 Agent 过程)
  ipcMain.handle("task:get-subagent-messages", (_e, { sessionFile }) =>
    getSubagentMessages(sessionFile));

  // shell:read-log — 读取后台命令输出日志(尾部 100KB 截断,弹层展示最近输出)
  ipcMain.handle("shell:read-log", (_e, { logPath }) => {
    try {
      if (!logPath || !fs.existsSync(logPath)) return { content: "", truncated: false };
      const stat = fs.statSync(logPath);
      if (stat.size <= 100 * 1024) {
        return { content: fs.readFileSync(logPath, "utf-8"), truncated: false };
      }
      const buf = Buffer.alloc(100 * 1024);
      const fd = fs.openSync(logPath, "r");
      try {
        fs.readSync(fd, buf, 0, 100 * 1024, stat.size - 100 * 1024);
      } finally {
        fs.closeSync(fd);
      }
      return { content: buf.toString("utf-8"), truncated: true };
    } catch {
      return { content: "", truncated: false };
    }
  });
  ipcMain.handle("conv:rename", (_e, { id, title, projectPath }) => {
    agentService.onSessionRenamed(id);
    return renameSession(id, title, projectPath);
  });
  ipcMain.handle("conv:delete", async (_e, { id, projectPath }) => {
    // Step 1: gracefully interrupt and kill the chat
    const chat = agentService.findActiveChat(id);
    if (chat) agentService.killChat(chat.chatId);
    // Step 2: brief delay for OS to reap the CLI subprocess, then
    //   delete the session file. Without the delay the SDK may
    //   recreate an empty file from a still-alive file descriptor.
    await new Promise((r) => setTimeout(r, 150));
    return deleteSession(id, projectPath);
  });
  ipcMain.handle("conv:togglePin", (_e, { id }) => togglePin(id));
  ipcMain.handle("conv:archiveSession", (_e, { sessionId }) => { archiveSession(sessionId); });
  ipcMain.handle("conv:unarchiveSession", (_e, { sessionId }) => { unarchiveSession(sessionId); });
  ipcMain.handle("pin:get", (_e, { sessionId }) => getPins(sessionId));
  ipcMain.handle("pin:set", (_e, { sessionId, pins }) => { setPins(sessionId, pins); });
  ipcMain.handle("session-cache:read", (_e, { sessionId }) => readCache(sessionId));
  ipcMain.handle("session-cache:write", (_e, { sessionId, data }) => { writeCache(sessionId, data); });
  ipcMain.handle("session-cache:delete", (_e, { sessionId }) => { deleteCache(sessionId); });

  ipcMain.handle("git:detect", () => detectGit());
  ipcMain.handle("node:detect", () => detectNode());
  ipcMain.handle("codegraph:detect", () => detectCodegraph());

  // settings:*
  ipcMain.handle("settings:get", () => store.getSettings());
  ipcMain.handle("settings:set", (_e, { key, value }) => {
    const settings = store.getSettings();
    (settings as unknown as Record<string, unknown>)[key] = value;
    store.saveSettings(settings);
    // 供应商配置/激活变更 → 重置模型缓存,切换供应商后新会话立即用新供应商的默认/兜底模型
    if (key === "apiProviders") {
      resetModelRuntime();
    }
  });
  ipcMain.handle("settings:fetchModels", async (_e, modelsUrl?: string, apiKey?: string) => {
    const key = apiKey || store.getActiveApiKey();
    if (!key) throw new Error("请先配置 API Key");
    if (!modelsUrl) throw new Error("该平台未配置模型列表地址");

    const resp = await fetch(modelsUrl, { headers: { Authorization: `Bearer ${key}` } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    let json: { data?: { id: string }[] };
    try { json = await resp.json() as any; } catch { throw new Error("模型列表返回格式错误"); }
    const models: string[] = [];
    if (json.data) {
      for (const m of json.data) {
        models.push(typeof m === "string" ? m : (m as { id: string }).id);
      }
    }
    return models;
  });
  ipcMain.handle("settings:fetchBalance", async () => {
    const settings = store.getSettings();
    const providers = settings.apiProviders;
    const activeId = providers?.current;
    const activeCfg = activeId ? providers?.configs?.[activeId] : undefined;
    const apiKey = store.getActiveApiKey();
    // 仅 DeepSeek 支持余额查询 API(/user/balance);其他供应商返回 null(前端不显示)
    if (activeCfg?.presetId && activeCfg.presetId !== "deepseek") return null;
    if (!apiKey) return null;
    // Pi 内置 provider — 从 Pi 拿 baseUrl
    let rawUrl = "https://api.deepseek.com";
    if (activeCfg?.presetId) {
      const { getPiProviders } = await import("./services/pi-init");
      const providers = await getPiProviders();
      const pi = providers.find((p) => p.id === activeCfg.presetId);
      if (pi?.baseUrl) rawUrl = pi.baseUrl;
    }
    let origin: string;
    try { origin = new URL(rawUrl).origin; } catch { return null; }
    try {
      const url = `${origin}/user/balance`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!resp.ok) return null;
      const json = await resp.json() as Record<string, unknown>;
      return json;
    } catch { return null; }
  });

  // system-prompt:*
  ipcMain.handle("system-prompt:get-config", () => getSystemPromptConfig());
  ipcMain.handle("system-prompt:create", (_e, input) => createSystemPrompt(input));
  ipcMain.handle("system-prompt:update", (_e, { id, input }) => updateSystemPrompt(id, input));
  ipcMain.handle("system-prompt:delete", (_e, { id }) => { deleteSystemPrompt(id); });
  ipcMain.handle("system-prompt:set-default", (_e, { id }) => { setDefaultPrompt(id); });

  // project:checkInitStatus — check if init.sh has been filled
  ipcMain.handle("project:checkInitStatus", (_e, { projectPath }) => {

const filePath = p.join(projectPath, "init.sh");
      if (!fs.existsSync(filePath)) return { done: false, reason: "init.sh not found" };
      const content = fs.readFileSync(filePath, "utf-8");
      return { done: !content.includes("{{PROJECT_DIR}}"), reason: content.includes("{{PROJECT_DIR}}") ? "still template" : "filled" };

  });

  // project:saveProfile — 持久化项目产品类型规范(NewProjectDialog 创建时写入,
  // 主进程 buildSystemPrompt 读取注入 Mint 提示词)
  ipcMain.handle("project:saveProfile", (_e, { projectPath, platformSpec }) => {
    try {
      if (!projectPath || !platformSpec) return { ok: false, error: "缺少参数" };
      const dir = p.join(projectPath, ".easymint");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(p.join(dir, "project-profile.json"),
        JSON.stringify({ platformSpec, savedAt: Date.now() }, null, 2), "utf-8");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  // task:read — read task.json and return tasks
  ipcMain.handle("task:read", (_e, { projectPath }) => {

const filePath = p.join(projectPath, "task.json");
      if (!fs.existsSync(filePath)) return { tasks: [] };
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return { tasks: (data.tasks || []).map((t: { id: number; title: string; description?: string; steps?: string[]; status?: string; attempts?: number }) => ({
        id: String(t.id),
        title: t.title,
        description: t.description || (t.steps ? t.steps.join("; ") : ""),
        command: "",
        status: t.status || "pending",
        attempts: t.attempts ?? 0,
      })) };
  });

  // file:saveUpload — save uploaded image to ~/.easymint/uploads/
  ipcMain.handle("file:saveUpload", async (_e, { name, data }: { name: string; data: number[] }) => {
    const uploadDir = p.join(os.homedir(), ".easymint", "uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const timestamp = Date.now();
    const safeName = `${timestamp}-${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const filePath = p.join(uploadDir, safeName);
    const buf = Buffer.from(data);
    fs.writeFileSync(filePath, buf);
    const ext = p.extname(name).toLowerCase();
    const mime = IMAGE_MIME[ext] || "image/png";
    const result = { path: filePath, dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
    trackUpload(safeName, buf.length);
    return result;
  });

  // file:readUpload — read an uploaded file and return as data URL (for history restore)
  ipcMain.handle("file:readUpload", async (_e, { filePath }: { filePath: string }) => {
    // Security: only allow files under ~/.easymint/uploads/
    const allowedDir = p.resolve(p.join(os.homedir(), ".easymint", "uploads"));
    if (!p.resolve(filePath).startsWith(allowedDir)) return null;
    if (!fs.existsSync(filePath)) return null;
    const buf = fs.readFileSync(filePath);
    const ext = p.extname(filePath).toLowerCase();
    const mime = IMAGE_MIME[ext] || "image/png";
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

  // ── migration:* — 项目/会话迁移（发送端打包传输 + 接收端恢复） ──
  const mig = migrationService;
  // 接收端事件 → 前端(弹窗确认/进度/完成/失败)
  mig.on("message", (e) => broadcast("migration:event", e));
  // 发送端收到接收端回执 → 前端提示"已在对方设备恢复完成"
  mig.on("done", (e: { projectName?: string; projectPath?: string; transferId?: string }) => {
    broadcast("migration:receipt", { ok: true, ...e });
    // 注入系统消息给发起迁移的会话(Mint 主导场景下,Mint 能看到迁移结果并衔接下一步)
    if (e.projectPath) {
      const text = `迁移完成: 项目已在目标设备恢复成功。\n接收端已自动完成: 解压落位、会话恢复(cwd 已改写为对方路径)、通知对端 Mint。\n你可以告知用户迁移已完成,并提示在目标设备上继续开发。`;
      void listSessions(e.projectPath).then((sessions) => {
        if (sessions.length > 0) {
          agentService.injectSystemMessage(sessions[0]!.sessionId, text, "delegation");
        }
      });
    }
  });
  mig.on("failed", (e: { projectName?: string; failures?: string[]; projectPath?: string }) => {
    broadcast("migration:receipt", { ok: false, ...e });
    if (e.projectPath) {
      const detail = (e.failures?.length ?? 0) > 0 ? `\n未通过校验的文件: ${e.failures!.slice(0, 5).join(", ")}${(e.failures?.length ?? 0) > 5 ? "…" : ""}` : "";
      const text = `迁移失败: 目标设备恢复未成功${detail}。\n建议: 检查目标设备状态后重试迁移,或告知用户手动排查。`;
      void listSessions(e.projectPath).then((sessions) => {
        if (sessions.length > 0) {
          agentService.injectSystemMessage(sessions[0]!.sessionId, text, "delegation");
        }
      });
    }
  });
  // 迁移完成 → 注入系统消息给本机 Mint(接收端,对齐上下文继续开发)
  mig.on("completed", (e: { projectName: string; projectPath: string; fromName: string }) => {
    broadcast("migration:completed", e);
    // 找到该项目下最活跃的会话,注入迁移完成系统消息
    const text = `迁移完成: 来自 ${e.fromName} 的「${e.projectName}」已恢复到本机。\n注意事项:\n1. 项目路径已变更为 ${e.projectPath}——记忆中的旧路径已失效,读写以新路径为准\n2. 原 git 仓库未迁移,需重新 git init;如有远程仓库(GitHub 等),重新配置 remote origin\n3. 任务进度以 task.json 为唯一真相,重新核对(历史对话中的进度快照仅供参考)\n4. 平台差异:换行符/可执行权限/包管理器/工具链按本机环境\n5. 建议主动读一遍项目结构确认环境`;
    void listSessions(e.projectPath).then((sessions) => {
      if (sessions.length > 0) {
        agentService.injectSystemMessage(sessions[0]!.sessionId, text, "delegation", { triggerTurn: true });
      }
    });
  });
  ipcMain.handle("migration:listIncoming", () => mig.listIncoming());
  ipcMain.handle("migration:accept", (_e, { transferId, targetPath }) => mig.acceptTransfer(transferId, targetPath));
  ipcMain.handle("migration:reject", (_e, { transferId }) => { mig.rejectTransfer(transferId); return { ok: true }; });
  ipcMain.handle("migration:start", (_e, { projectPath, deviceId, files, sessionFile }) =>
    mig.startTransfer(projectPath, deviceId, files, { sessionFile })
  );
  ipcMain.handle("migration:getSessionFile", (_e, { projectPath }) => {
    // 取项目最新主会话 jsonl(迁移会话用)
    const encoded = projectPath.replace(/[:/\\]/g, "-");
    const dir = p.join(os.homedir(), ".easymint", "sessions", encoded);
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl") && !f.startsWith("."));
    if (files.length === 0) return null;
    files.sort();
    return files[files.length - 1]!; // 最新
  });

  // ── device:* — 设备互联（mDNS 发现 + WS 配对连接） ──
  const net = networkService;
  // 事件 → 前端广播（devices-changed 由各前端轮询或推送;配对请求/上下线推送）
  net.on("pair-request", (req) => broadcast("device:pair-request", req));
  net.on("device-online", (d) => broadcast("device:online", d));
  net.on("device-offline", (d) => broadcast("device:offline", d));
  net.on("devices-changed", () => broadcast("device:changed", {}));

  ipcMain.handle("device:getSelf", () => net.getSelf());
  ipcMain.handle("device:listPaired", () => net.listPaired());
  ipcMain.handle("device:listDiscovered", () => net.listDiscovered());
  ipcMain.handle("device:setName", (_e, { name }) => net.setDeviceName(name));
  ipcMain.handle("device:startPair", () => { net.startPairMode(); return { ok: true }; });
  ipcMain.handle("device:stopPair", () => { net.stopPairMode(); return { ok: true }; });
  ipcMain.handle("device:manualScan", () => { net.startManualScan(); return { ok: true }; });
  ipcMain.handle("device:requestPair", (_e, { peer }) => net.requestPair(peer));
  ipcMain.handle("device:acceptPair", (_e, { peer }) => net.acceptPair(peer));
  ipcMain.handle("device:unpair", (_e, { id }) => { net.unpair(id); return { ok: true }; });
  // 预留:会话/项目迁移通道（网络层就绪,迁移逻辑后续实现）
  ipcMain.handle("device:sendMessage", (_e, { id, message }) => ({ ok: net.sendToDevice(id, message) }));

  // 启动时:已配对设备自动连接（保持常驻心跳）
  net.startKeepalive();

}
