import { BrowserWindow, ipcMain, dialog, app, shell } from "electron";
import p from "path";
import fs from "fs";
import os from "os";
import { ProjectService } from "./services/project-service";
import { FileService } from "./services/file-service";
import { AgentService, getDesignSessionIds, respondAsk, respondLearn } from "./services/agent-service";
import { Store } from "./services/store";
import { broadcast } from "./services/ipc-broadcast";
import { resetModelRuntime } from "./services/pi-init";
import { IMAGE_MIME, resolveHome } from "./utils/paths";
import { z } from "zod";
import { guard, expectPayload, pathString } from "./ipc-validation";
import { execShell } from "./services/shell-service";
import { backgroundShellRegistry } from "./services/background-shell/registry";
import { getRunningSummary } from "./services/task/registry";
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
  writeManagedSkill,
  deleteSkill,
  importSkillFromUrl,
  importSkillFromDir,
} from "./services/skill-service";
import { getSkillStats } from "./services/skill-registry";
import {
  scanMcpServers,
  toggleMcpServer,
  getMcpRequiredKeys,
  saveMcpServer,
  deleteMcpServer,
  getMcpServerConfig,
  getMcpConfigPath,
  parseMcpConfig,
  approveMcpServer,
  type McpServerConfig,
  type McpScope,
} from "./services/mcp-service";
import { getMcpStatus, ensureStatusProbe, reloadMcpTools, dropMcpClient, retryMcpServer, testMcpServer } from "./services/permission/mcp-adapter";
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
import { listIssues, addIssue, setStatus, updateIssue, deleteIssue } from "./services/issue-service";
import { getPins, setPins } from "./services/pin-service";
import type { IssueStatus } from "./services/issue-service";
import { detectRunnable, startProcess, stopProcess, restartProcess, getStatus, getRunningIds, checkPort, killPort, ensureRunJsonWatch, saveRunJson } from "./services/process-service";
import { networkService } from "./services/network-service";
import { migrationService, readIgnoreFileRaw, saveIgnoreFileRaw, DEFAULT_IGNORE_CONTENT } from "./services/migration-service";
import { listTodos, addTodo, updateTodo, toggleTodo, removeTodo } from "./services/todo-service";
import { testProvider } from "./services/provider-test";

interface Services {
  mainWindow: BrowserWindow;
  projectService: ProjectService;
  fileService: FileService;
  agentService: AgentService;
  store: Store;
}

export function registerIpcHandlers({ mainWindow, projectService, fileService, agentService, store }: Services): void {
  /**
   * file:* / shell 日志通道的可信根解析：目标路径必须落在某个已登记项目根之内
   * （`~/.ssh/id_rsa`、`/etc/passwd`、`~/Documents/../.ssh/id_rsa` 均无项目根包含 → 拒绝）。
   * 返回包含目标的项目根（baseDir），找不到返回 null。
   */
  const projectRootContaining = (target: string | undefined): string | null => {
    const t = target || "";
    const abs = p.resolve(resolveHome(t));
    for (const proj of projectService.list()) {
      const base = p.resolve(resolveHome(proj.path));
      if (abs === base || abs.startsWith(base + p.sep)) return base;
    }
    return null;
  };

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
  ipcMain.handle("project:check-dir", (_e, { dir, name }: { dir: string; name: string }) => projectService.checkTargetDir(dir, name));
  // 所有窗口当前打开的项目 id（hash 路由 #/project/{id}）——正被任何窗口打开的项目禁止删除
  ipcMain.handle("project:opened-in-windows", () => {
    const ids = new Set<string>();
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      const m = win.webContents.getURL().match(/#\/project\/([^/?]+)/);
      if (m) ids.add(m[1]);
    }
    return [...ids];
  });
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

  // file:*（目标路径必须在项目根内——见 projectRootContaining；FileService 内部再做一次 baseDir 包含校验）
  // 1.7：参数经 zod 运行时校验——畸形 payload（非字符串路径/缺字段）返回明确错误而非静默失败
  ipcMain.handle("file:readTree", guard(z.object({ dirPath: pathString }).loose(), (data) =>
    fileService.readTree(projectRootContaining(data.dirPath) ?? "", data.dirPath)));
  ipcMain.handle("file:readContent", guard(z.object({ filePath: pathString }).loose(), (data) =>
    fileService.readContent(projectRootContaining(data.filePath) ?? "", data.filePath)));
  ipcMain.handle("file:writeContent", guard(z.object({ filePath: pathString, content: z.string() }).loose(), (data) =>
    fileService.writeContent(projectRootContaining(data.filePath) ?? "", data.filePath, data.content)));
  ipcMain.handle("file:createFile", guard(z.object({ filePath: pathString, content: z.string().optional() }).loose(), (data) =>
    fileService.createFile(projectRootContaining(data.filePath) ?? "", data.filePath, data.content ?? "")));
  ipcMain.handle("file:createFolder", guard(z.object({ dirPath: pathString }).loose(), (data) =>
    fileService.createFolder(projectRootContaining(data.dirPath) ?? "", data.dirPath)));

  // todos:* 用户待办（.easymint/todos.json——见 services/todo-service.ts）
  ipcMain.handle("todos:list", (_e, { projectPath }: { projectPath: string }) => listTodos(projectPath));
  ipcMain.handle("todos:add", (_e, { projectPath, title, note }: { projectPath: string; title: string; note?: string }) =>
    addTodo(projectPath, { title, note }));
  ipcMain.handle("todos:update", (_e, { projectPath, id, title, note }: { projectPath: string; id: number; title?: string; note?: string }) =>
    updateTodo(projectPath, { id, title, note }));
  ipcMain.handle("todos:toggle", (_e, { projectPath, id }: { projectPath: string; id: number }) => toggleTodo(projectPath, id));
  ipcMain.handle("todos:remove", (_e, { projectPath, id }: { projectPath: string; id: number }) => removeTodo(projectPath, id));

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
  ipcMain.handle("agent:getThinkingLevels", (_e, { sessionId }) => agentService.getThinkingInfo(sessionId));
  ipcMain.handle("agent:getModelThinkingSupport", async (_e, { modelId }) => await agentService.getModelThinkingSupport(modelId));
  ipcMain.handle("agent:setModel", (_e, { sessionId, model, provider }) => {
    return agentService.setModel(sessionId, model, provider);
  });
  ipcMain.handle("agent:spawnAgentChat", (_e, { projectPath, templateId, message }) => {
    return agentService.spawnAgentChat(projectPath, templateId, message);
  });
  ipcMain.handle("agent:sendMessage", async (_e, { projectPath, message, sessionId, permissionMode, model, isDesigner, images, thinkingLevel, systemPayload, preferredProvider, tabId }) => {
    try {
      return await agentService.sendMessage(projectPath, message, sessionId ?? null, permissionMode, mainWindow, model, isDesigner, images, thinkingLevel, systemPayload, preferredProvider, tabId);
    } catch (e) {
      console.error("[ipc] sendMessage 失败:", (e as Error).message);
      throw e;
    }
  });
  ipcMain.handle("agent:stop-delegation", (_e, { delegationId, taskIndex }) =>
    agentService.stopDelegationTask(delegationId, taskIndex),
  );
  ipcMain.handle("agent:delegations", (_e, { sessionId }: { sessionId: string }) =>
    agentService.getRunningDelegationsSnapshot(sessionId),
  );
  ipcMain.handle("agent:stop-shell", (_e, { shellId }) => {
    // 渲染层按钮点停止 → 用户 UI 路径:来源记 user,停止通知文案显示「已由用户中止」
    backgroundShellRegistry.stop(String(shellId ?? ""), "user");
  });
  // 运行态快照:渲染层挂载/刷新时主动拉取一次——广播只在状态变化时发，
  // 刷新后不重播（agent:delegation-count / agent:shell-count），不拉取会导致胶囊与状态栏空白
  ipcMain.handle("agent:running-state", () => ({
    delegations: getRunningSummary(),
    shells: backgroundShellRegistry.list().map((s) => ({
      id: s.id, command: s.command, startedAt: s.startedAt, status: s.status, logPath: s.logPath, sessionId: s.sessionId,
    })),
  }));
  ipcMain.handle("agent:steer", (_e, { sessionId, text, images }) => {
    void agentService.steer(sessionId, text, images).catch((err: unknown) => {
      const raw = err instanceof Error ? err.message : String(err);
      console.error(`[ipc] agent:steer 失败 sessionId=${sessionId}:`, raw);
      // 插话投递失败 → 广播 error 让对应会话清 busy 并提示重试,避免前端无响应悬挂
      broadcast("agent:stream", { type: "error", sessionId, message: "插话发送失败，请重试", canRetry: true });
    });
  });
  ipcMain.handle("agent:followUp", (_e, { sessionId, text }) => {
    void agentService.followUp(sessionId, text).catch((err: unknown) => {
      const raw = err instanceof Error ? err.message : String(err);
      console.error(`[ipc] agent:followUp 失败 sessionId=${sessionId}:`, raw);
      broadcast("agent:stream", { type: "error", sessionId, message: "消息发送失败，请重试", canRetry: true });
    });
  });
  ipcMain.handle("agent:compact", async (_e, { sessionId, instructions }) => {
    await agentService.compact(sessionId, instructions);
  });
  // 按需激活会话（重启后未发过消息的会话不在主进程活跃列表，压缩前需先恢复）
  ipcMain.handle("agent:activate", async (_e, { sessionId, projectPath }) => {
    return agentService.activateSession(sessionId, projectPath);
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
  ipcMain.handle("agent:ask-response", (_e, { requestId, answers }) => {
    // ask_user 的回答：answers 为 null/空 = 用户取消（ask-closed 由 respondAsk 广播）
    return respondAsk(requestId, answers);
  });
  ipcMain.handle("agent:learn-response", (_e, { requestId, response }) => {
    // learn 审阅结果：approved=false = 用户取消；编辑过的 memory/skillBody 随 response 回传
    return respondLearn(requestId, response);
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
  ipcMain.handle("agent:killChat", (_e, { chatId }) => {
    agentService.killChat(chatId);
  });
  // 关闭 tab 回收:保留 2 分钟后 kill(重开时 cancel)
  ipcMain.handle("agent:reclaim-chat", (_e, { sessionId }) => {
    agentService.reclaimChat(sessionId);
  });
  ipcMain.handle("agent:cancel-reclaim", (_e, { sessionId }) => {
    agentService.cancelReclaim(sessionId);
  });
  // 会话状态点/结束会话
  ipcMain.handle("agent:active-sessions", () => agentService.listActiveSessions());
  ipcMain.handle("agent:kill-session", (_e, { sessionId }) => {
    agentService.killSession(sessionId);
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
  ipcMain.handle("skill:createManaged", (_e, { name, description, body, projectPath }: { name: string; description: string; body: string; projectPath?: string }) =>
    writeManagedSkill({ action: "create", name, description, body }, projectPath));
  ipcMain.handle("skill:updateManaged", (_e, { name, description, body }: { name: string; description?: string; body?: string }) =>
    writeManagedSkill({ action: "update", name, description, body }));
  ipcMain.handle("skill:deleteManaged", (_e, { name }: { name: string }) =>
    writeManagedSkill({ action: "delete", name }));
  ipcMain.handle("skill:delete", (_e, { skillPath, projectPath }: { skillPath: string; projectPath?: string }) =>
    deleteSkill(skillPath, projectPath));
  ipcMain.handle("skill:getStats", () => getSkillStats());
  ipcMain.handle("skill:import", (_e, { source, name, overwrite }: { source: string; name?: string; overwrite?: boolean }) =>
    /^https:\/\//i.test(source.trim())
      ? importSkillFromUrl(source, { name, overwrite })
      : importSkillFromDir(source, { name, overwrite }));

  // mcp:*
  ipcMain.handle("mcp:list", () => scanMcpServers());
  ipcMain.handle("mcp:toggle", (_e, { name, enabled }: { name: string; enabled: boolean }) => {
    void dropMcpClient(name); // 开关变更丢弃旧连接，按新状态重连
    toggleMcpServer(name, enabled);
    reloadMcpTools(); // 清缓存，新会话生效（进行中会话工具集固定）
  });
  ipcMain.handle("mcp:requiredKeys", () => getMcpRequiredKeys());
  // 配置管理（阶段A）：增删改 + 测试连接 + 状态 + 变更清缓存（新会话生效）
  ipcMain.handle("mcp:save", (_e, { name, cfg, scope, projectPath }: { name: string; cfg: McpServerConfig; scope?: McpScope; projectPath?: string }) => {
    const r = saveMcpServer(name, cfg, { scope, projectPath });
    if (r.ok) {
      void dropMcpClient(name); // 配置变更丢弃旧连接——clients 按名复用，不丢弃会一直用旧配置的连接
      reloadMcpTools();
    }
    return r;
  });
  ipcMain.handle("mcp:delete", (_e, { name, scope, projectPath }: { name: string; scope?: McpScope; projectPath?: string }) => {
    const r = deleteMcpServer(name, { scope, projectPath });
    if (r.ok) {
      void dropMcpClient(name);
      reloadMcpTools();
    }
    return r;
  });
  ipcMain.handle("mcp:get", (_e, { name, scope, projectPath }: { name: string; scope?: McpScope; projectPath?: string }) => getMcpServerConfig(name, { scope, projectPath }));
  ipcMain.handle("mcp:configPath", () => getMcpConfigPath());
  ipcMain.handle("mcp:status", (_e, { projectPath }: { projectPath?: string }) => {
    ensureStatusProbe(projectPath); // 无状态记录的后台探测，避免界面永远「连接中」
    return getMcpStatus(projectPath);
  });
  ipcMain.handle("mcp:test", (_e, { cfg }: { cfg: McpServerConfig }) => testMcpServer(cfg));
  ipcMain.handle("mcp:retry", (_e, { name, projectPath }: { name: string; projectPath?: string }) => retryMcpServer(name, projectPath));
  ipcMain.handle("mcp:importText", (_e, { text }: { text: string }) => {
    const parsed = parseMcpConfig(text);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const results: string[] = [];
    for (const [name, cfg] of Object.entries(parsed.parsed.servers)) {
      void dropMcpClient(name); // 同名重导入按新配置重连
      const r = saveMcpServer(name, cfg);
      results.push(r.ok ? `✅ ${name}（${cfg.type}）已添加` : `❌ ${name}：${r.error}`);
    }
    reloadMcpTools();
    return { ok: results.some((r) => r.startsWith("✅")), message: results.join("\n"), notes: parsed.parsed.notes };
  });
  ipcMain.handle("mcp:approve", (_e, { name, projectPath }: { name: string; projectPath: string }) => {
    approveMcpServer(projectPath, name);
    reloadMcpTools();
  });

  // upload:*
  ipcMain.handle("upload:stats", guard(z.object({ sortBy: z.enum(["time", "size"]).optional() }).loose(), (data) => getUploadStats(data.sortBy)));
  // cleanFiles 内部还有 basename/目录包含双重校验（1.2）——这里先拦非数组/非字符串载荷
  ipcMain.handle("upload:clean", guard(z.object({ filenames: z.array(z.string().min(1)) }).loose(), (data) => cleanFiles(data.filenames)));
  ipcMain.handle("upload:cleanAll", () => cleanAll());
  ipcMain.handle("upload:openDir", () => {
    const dir = p.join(os.homedir(), ".easymint", "uploads");
    shell.openPath(dir);
  });

  // conversation:* — backed by SDK session APIs
  // issue:* - 本地问题记录
  ipcMain.handle("issue:list", (_e, { projectPath }) => listIssues(projectPath));
  ipcMain.handle("issue:add", (_e, { projectPath, title, module }) => addIssue(projectPath, title, module));
  ipcMain.handle("issue:set-status", (_e, { projectPath, id, status }) => setStatus(projectPath, id, status as IssueStatus));
  ipcMain.handle("issue:update", (_e, { projectPath, id, patch }) => updateIssue(projectPath, id, patch));
  ipcMain.handle("issue:delete", (_e, { projectPath, id }) => deleteIssue(projectPath, id));

  // process:* - 项目运行进程管理（按 commandId）
  ipcMain.handle("process:detect", (_e, { projectPath }) => { ensureRunJsonWatch(projectPath); return detectRunnable(projectPath); });
  ipcMain.handle("process:save-run-json", (_e, { projectPath, runnables }) => { saveRunJson(projectPath, runnables); });
  ipcMain.handle("process:ask-repair", (_e, { projectPath, summary }) => agentService.steerProjectRepair(projectPath, summary));
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

  // shell:read-log — 读取后台命令输出日志(尾部 100KB 截断,弹层展示最近输出)。
  // 日志在 <项目>/.easymint/shell-logs/ 内——路径须在项目根内(防任意文件读取)。空串/缺省按无内容处理
  ipcMain.handle("shell:read-log", guard(z.object({ logPath: z.string().max(4096) }).loose(), ({ logPath }) => {
    try {
      if (!logPath || !fs.existsSync(logPath) || !projectRootContaining(logPath)) return { content: "", truncated: false };
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
  }));
  // shell:reveal-in-folder — 在文件夹中显示日志文件(不打开文件);路径须在项目根内
  ipcMain.handle("shell:reveal-in-folder", guard(z.object({ logPath: z.string().max(4096) }).loose(), ({ logPath }) => {
    if (!logPath || !fs.existsSync(logPath) || !projectRootContaining(logPath)) return;
    shell.showItemInFolder(logPath);
  }));
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
  ipcMain.handle("settings:set", async (_e, { key, value }) => {
    const settings = store.getSettings();
    (settings as unknown as Record<string, unknown>)[key] = value;
    store.saveSettings(settings);
    // 供应商配置/激活变更 → 重置模型缓存,切换供应商后新会话立即用新供应商的默认/兜底模型
    if (key === "apiProviders") {
      resetModelRuntime();
      // 已开会话的模型对象在创建时绑定,配置改动默认不生效 → 重建(输出中的会话跳过)
      try {
        await agentService.refreshActiveSessionsModel();
      } catch (e) {
        console.warn("[settings] 重建活跃会话模型失败:", (e as Error).message);
      }
    }
  });
  // 供应商「测试接口」:地址可达 → 双协议模型列表 → 可选 Key 校验。
  // 入参用表单未保存的值(不读 store);apiKey 只进请求头,不进日志(实现见 services/provider-test.ts)。
  ipcMain.handle("settings:testProvider", async (_e, input: unknown) => {
    const data = expectPayload(z.object({
      baseUrl: z.string().min(1, "不能为空"),
      // Key 可空：地址可达/模型列表是 0-token 步骤，与 Key 无关；空 Key 下模型列表收到 401 →
      // 已有「认证被拒绝」文案（Key 校验同样由用户勾选后才发）
      apiKey: z.string().optional(),
      model: z.string().optional(),
      apiType: z.string().optional(),
      verifyKey: z.boolean().optional(),
    }).loose(), input);
    return testProvider({ ...data, apiKey: data.apiKey ?? "" });
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

  // shell:exec — run a shell command in project directory, stream output。
  // 命令内容经 shell-service 禁区检查(1.6);参数这里做类型/空值校验(1.7)
  ipcMain.handle("shell:exec", async (event, payload: unknown) => {
    const { projectPath, command } = expectPayload(
      z.object({ projectPath: pathString, command: z.string().min(1) }).loose(),
      payload,
    );
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
  // 发送端传输进度 → 前端(进度条)
  mig.on("send-progress", (e) => broadcast("migration:send-progress", e));
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
      }).catch((err) => {
        // 迁移结果已由上方 migration:receipt(ok:true) 送达前端;此处注入失败只影响
        // Mint 能否自动衔接下一步,不影响迁移本身——记日志跳过(会话已关闭属正常路径)
        console.error("[ipc] 迁移完成通知注入 Mint 会话失败:", err);
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
      }).catch((err) => {
        // 失败原因已由上方 migration:receipt(ok:false) 送达前端;此处注入失败仅影响
        // Mint 能否看到失败上下文,不影响迁移结果展示——记日志跳过
        console.error("[ipc] 迁移失败通知注入 Mint 会话失败:", err);
      });
    }
  });
  // 迁移完成 → 注入系统消息给本机 Mint(接收端,对齐上下文继续开发)
  // 迁移完成 → 前端展示完成卡片 + 模板文案(用户复制发送给 Mint——迁移会话未打开,
  // 无法直接注入;由用户粘贴到会话即可对齐上下文)
  mig.on("completed", (e: { projectName: string; projectPath: string; originPath: string; fromName: string }) => {
    broadcast("migration:completed", e);
  });
  // 接收端确认/拒绝(弹窗)
  ipcMain.handle("migration:accept", (_e, { transferId, targetPath }) => mig.acceptTransfer(transferId, targetPath));
  ipcMain.handle("migration:reject", (_e, { transferId }) => { mig.rejectTransfer(transferId); return { ok: true }; });
  // 统一入口(纯手动):扫描 + 按选中清单打包 zip + 传输
  ipcMain.handle("migration:start", (_e, { projectPath, deviceId, selection }: { projectPath: string; deviceId: string; selection?: { files: string[]; sessions: string[] } }) =>
    mig.prepareAndTransfer(projectPath, deviceId, selection)
  );
  // 前端预览清单(与传输内部同一扫描实现)
  ipcMain.handle("migration:scan", (_e, { projectPath }) => mig.scanProject(projectPath));
  // 迁移忽略项(全局配置,.easymint/migration-ignore,类似 .gitignore)——读写原始文本(含注释)
  ipcMain.handle("migration:getIgnore", () => readIgnoreFileRaw());
  ipcMain.handle("migration:saveIgnore", (_e, { content }: { content: string }) => {
    saveIgnoreFileRaw(content);
    return { ok: true };
  });
  // 恢复默认:重置为内置模板并返回新内容
  ipcMain.handle("migration:resetIgnore", () => {
    saveIgnoreFileRaw(DEFAULT_IGNORE_CONTENT);
    return DEFAULT_IGNORE_CONTENT;
  });

  // ── device:* — 设备互联（mDNS 发现 + WS 配对连接） ──
  const net = networkService;
  // 事件 → 前端广播（devices-changed 由各前端轮询或推送;配对请求/上下线推送）
  net.on("pair-request", (req) => broadcast("device:pair-request", req));
  net.on("device-online", (d) => broadcast("device:online", d));
  net.on("device-offline", (d) => broadcast("device:offline", d));
  net.on("devices-changed", () => broadcast("device:changed", {}));

  ipcMain.handle("device:getSelf", () => net.getSelf());
  // Windows 防火墙放行提示(设备互联首次启动时,一次)
  net.once("firewall-hint", ({ port }: { port: number }) => {
    broadcast("device:firewall-hint", { port });
  });
  ipcMain.handle("device:listPaired", () => net.listPaired());
  ipcMain.handle("device:listDiscovered", () => net.listDiscovered());
  ipcMain.handle("device:setName", (_e, { name }) => net.setDeviceName(name));
  ipcMain.handle("device:startPair", () => { net.startPairMode(); return { ok: true }; });
  ipcMain.handle("device:stopPair", () => { net.stopPairMode(); return { ok: true }; });
  ipcMain.handle("device:manualScan", () => { net.rescan(); return { ok: true }; });
  ipcMain.handle("device:requestPair", (_e, { peer }) => net.requestPair(peer));
  ipcMain.handle("device:acceptPair", (_e, { peer }) => net.acceptPair(peer));
  ipcMain.handle("device:unpair", (_e, { id }) => { net.unpair(id); return { ok: true }; });
  ipcMain.handle("device:connect", (_e, { id }) => net.connectToDevice(id));
  // 预留:会话/项目迁移通道（网络层就绪,迁移逻辑后续实现）
  ipcMain.handle("device:sendMessage", (_e, { id, message }) => ({ ok: net.sendToDevice(id, message) }));

  // 启动时:已配对设备自动连接（保持常驻心跳）
  net.startKeepalive();

}
