/**
 * Agent Service — Pi SDK 驱动
 *
 * 步骤三重写：Claude SDK 的 query/channel/for-await 全部替换为 Pi 的
 * createAgentSession + session.prompt + session.subscribe。
 *
 * 对外接口（IPC handlers 调用）完全不变。
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { BrowserWindow } from "electron";
import { resolveHome } from "../utils/paths";
import { broadcast } from "./ipc-broadcast";
import { Store } from "./store";
import { resolveEffectivePrompt } from "./system-prompt-manager";
import { buildSkillsPrompt } from "./skill-service";
import { getActiveModel, resetModelRuntime } from "./pi-init";
import { createPiSession, resumePiSession, listPiSessions } from "./pi-session";
import { createTaskTool } from "./task/tool";
import { registerSessionIdMapping, abortTask, getRunningSummary, resolveParentSessionId } from "./task/registry";
import { formatShellResult } from "./background-shell/tool";
import { backgroundShellRegistry, type BackgroundShell } from "./background-shell/registry";
import { systemMessage, type SystemMessageKind, type SystemMessagePayload } from "../../shared/prompts";
import { createProductTools } from "./builtin-mcp";
import { loadMcpTools } from "./permission/mcp-adapter";
import { permissionService } from "./permission/agent-permission-service";
import type { CanUseToolOptions, PermissionResult } from "./permission/agent-permission-service";
import {
  bridgeSessionEvents,
  type PiChatEvent,
} from "./event-bridge";
import type { AgentSession, AgentSessionEvent, ToolDefinition } from "./pi-sdk";
import type { Model } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import { renameSession, hasCustomTitle } from "./session-service";
import { MAX_COMPACT, finishRotation, type RotationState } from "./rotation";
import { DESIGNER_AGENT_PROMPT } from "../../shared/prompts";

// ── 类型 ────────────────────────────────────────────

/** 权限回调签名（与 permissionService.createCanUseTool 返回一致） */
export type CanUseToolFn = (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions) => Promise<PermissionResult>;

/** 系统消息 kind → 首条会话标题(SDK 列表优先读 session_info.name,custom 首条时兜底) */
const SYSTEM_KIND_TITLES: Record<string, string> = {
  "project-created": "项目初始化",
  flow: "流程指令",
  handoff: "会话交接",
  summary: "上下文摘要",
  delegation: "子 Agent 委派",
  shell: "后台命令",
};

interface ActiveRun {
  runId: string;
  session: AgentSession | null;
  abortController: AbortController;
}

export interface ActiveChat extends RotationState {
  chatId: string;
  /** 对外 sessionId（Pi 真实 ID；前端迁移/权限/统计都用它） */
  sessionId: string;
  /** 新建会话时的 EM 临时 ID（task 工具绑定此 ID，findActiveChat 双键匹配） */
  tempSessionId?: string;
  session: AgentSession | null;
  abortController: AbortController;
  projectPath: string;
  currentModel?: string;
  agentType?: "mint" | "builder" | "evaluator" | "designer";
  status: string;
  firstUserMessage: string;
  assistantUuid: string;
  eventBuffer: PiChatEvent[];
}

/** 记录各 session 的 agent 类型 */
const sessionAgentTypes = new Map<string, string>();
const SESSION_TYPES_PATH = path.join(os.homedir(), ".easymint", "session-types.json");

function loadSessionTypes(): Map<string, string> {
  try {
    if (fs.existsSync(SESSION_TYPES_PATH)) {
      const data = JSON.parse(fs.readFileSync(SESSION_TYPES_PATH, "utf-8"));
      const map = new Map<string, string>();
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === "string") map.set(k, v);
      }
      return map;
    }
  } catch (e) { console.warn("[agent] 读取 session-types.json 失败:", (e as Error).message); }
  return new Map();
}

function saveSessionTypes(map: Map<string, string>): void {
  try {
    const dir = path.dirname(SESSION_TYPES_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SESSION_TYPES_PATH, JSON.stringify(Object.fromEntries(map), null, 2));
  } catch (e) { console.warn("[agent] 保存 session-types.json 失败:", (e as Error).message); }
}

// 初始化时加载已有记录
const loaded = loadSessionTypes();
for (const [k, v] of loaded) sessionAgentTypes.set(k, v);

export function getDesignSessionIds(): string[] {
  const ids: string[] = [];
  for (const [id, type] of sessionAgentTypes) {
    if (type === "designer") ids.push(id);
  }
  return ids;
}

// ── 上下文压缩 ──────────────────────────────────────

// ── AgentService ────────────────────────────────────

export class AgentService {
  constructor(private store: Store) {}
  private activeRuns: Map<string, ActiveRun> = new Map();
  private activeChats: Map<string, ActiveChat> = new Map();
  private runCounter = 0;
  private chatCounter = 0;
  onWorkerComplete: ((projectPath: string) => void) | null = null;
  private streamBuffer: Map<string, PiChatEvent[]> = new Map();
  /** 委派完成通知积压：Mint 忙碌时记下,回合结束后以新回合发送 */
  private pendingSystemMessages: Map<string, SystemMessagePayload> = new Map();

  // ── 内部辅助 ──────────────────────────────────────

  private getAgentDir(): string {
    return path.join(os.homedir(), ".easymint", "pi");
  }

  private async getModel(store: Store): Promise<Model<any> | null> {
    const m = await getActiveModel(store);
    return m ?? null;
  }

  private async buildExtraTools(projectPath: string, sessionId: string, chatId?: string): Promise<{
    tools: ToolDefinition[];
    canUseTool: CanUseToolFn;
  }> {
    // 权限回调：按 sessionId 隔离白名单，由 createPiSession 统一包装所有工具（含基础 coding 工具）
    // 放在 try 外——工具创建失败时同样返回回调，避免调用方 undefined（plan 只读仍生效）
    const canUseTool = permissionService.createCanUseTool(
      sessionId,
      (request) => { broadcast("agent:permission-request", request); },
      undefined,
      (askRequest) => { broadcast("agent:permission-request", { ...askRequest, type: "ask" }); },
    );

    try {
      const taskTool = await createTaskTool({
        cwd: projectPath,
        agentDir: this.getAgentDir(),
        store: this.store,
        parentSessionId: sessionId,
        chatId,
        onComplete: (sid, text) => this.injectSystemMessage(sid, text),
        // 单任务被用户停止 → 立即注入中止通知(kind: delegation,绿色气泡 ● 行)
        onTaskAborted: (sid, text) => this.injectSystemMessage(sid, text, "delegation"),
        // 单任务提前完成 → 立即注入完成通知,Mint 输出判断继续等待(对齐 cc)
        onTaskCompleted: (sid, text) => this.injectSystemMessage(sid, text, "delegation"),
      });
      const productTools = await createProductTools(projectPath);
      const mcpTools = await loadMcpTools();
      const allTools = [taskTool, ...productTools, ...mcpTools];

      console.log(`[agent] tools: 1 task + ${productTools.length} product + ${mcpTools.length} mcp (permission: enabled)`);
      return { tools: allTools, canUseTool };
    } catch (e) {
      console.error("[agent] tool creation failed:", e);
      return { tools: [], canUseTool };
    }
  }

  private buildSystemPrompt(projectPath: string, isDesigner?: boolean): string {
    const parts: string[] = [];

    if (isDesigner) {
      parts.push(DESIGNER_AGENT_PROMPT);
    } else {
      const effective = resolveEffectivePrompt();
      if (effective) parts.push(effective);
    }

    const skills = buildSkillsPrompt(projectPath);
    if (skills) parts.push(skills);

    return parts.join("\n\n");
  }

  /** 处理 prompt → 广播流事件到前端，含压缩追踪和轮转 */
  private async promptAndBridge(
    session: AgentSession,
    sessionId: string,
    chatId: string,
    text: string,
    chat?: ActiveChat,
    images?: Array<{ type: "image"; data: string; mimeType: string }>,
    systemPayload?: SystemMessagePayload,
  ): Promise<void> {
    let pendingResult: PiChatEvent | null = null;

    const unsub = session.subscribe((event: AgentSessionEvent) => {
      try {
        bridgeSessionEvents(event, {
          onEvent: (ev) => {
            ev.sessionId = sessionId;
            ev.chatId = chatId;
            broadcast("agent:stream", ev);
            this.bufferEvent(sessionId, ev);
          },
          getSession: () => session,
          setPendingResult: (ev: PiChatEvent) => { pendingResult = ev; },
        });

        // ── 压缩追踪 ──
        if (chat && event.type === "compaction_end") {
          if (!event.aborted && !event.willRetry) {
            chat.compactCount++;
            console.log(`[agent] compact #${chat.compactCount}: chatId=${chatId}`);

            // Pi 原生 compact 自带摘要（result.summary），保存供轮转交接。
            // 迁移时遗漏的填充逻辑——此前 summaryBuffer 恒为空，轮转从未真正执行。
            const nativeSummary = (event as { result?: { summary?: string } }).result?.summary;
            if (nativeSummary) chat.summaryBuffer = nativeSummary;

            if (chat.compactCount >= MAX_COMPACT && chat.contextStatus === "normal") {
              // 达到阈值 → 触发轮转（用 Pi 原生摘要交接）
              chat.contextStatus = "summarizing";
              console.log(`[agent] rotation triggered: chatId=${chatId}`);
            }
          }
        }
      } catch (e) {
        console.error("[agent] bridge error:", e);
      }
    });

    try {
      // 10 分钟超时保护，防止网络挂起无限阻塞
      const send = systemPayload
        ? session.sendCustomMessage(systemPayload, { triggerTurn: true })
        : session.prompt(text, images ? { images } : undefined);
      await Promise.race([
        send,
        new Promise((_, reject) => setTimeout(() => reject(new Error("请求超时（10分钟）")), 600_000)),
      ]);

      // 系统消息积压：回合已结束,立即开新回合发送(custom 消息结构化)
      const pendingSys = this.pendingSystemMessages.get(sessionId);
      if (pendingSys) {
        this.pendingSystemMessages.delete(sessionId);
        await session.sendCustomMessage(pendingSys, { triggerTurn: true }).catch(() => {});
      }

      const pr = pendingResult as PiChatEvent | null;
      if (pr) {
        pr.sessionId = sessionId;
        pr.chatId = chatId;
        broadcast("agent:stream", pr);
        this.bufferEvent(sessionId, pr);
        broadcast("agent:exit", { runId: chatId, code: 0 });

        // 上报真实上下文使用率
        setTimeout(() => {
          const usage = session.getContextUsage();
          if (usage) {
            broadcast("agent:context-usage", {
              chatId,
              percentage: usage.percent ?? 0,
              totalTokens: usage.tokens ?? 0,
              maxTokens: usage.contextWindow,
            });
          }
        }, 500);

        // ── 自动标题：新会话首轮完成后生成中文标题 ──
        // (系统消息作为首条时 firstUserMessage 已置空,不生成标题)
        if (chat && chat.firstUserMessage) {
          const firstMsg = chat.firstUserMessage;
          chat.firstUserMessage = "";
          const isNamed = await hasCustomTitle(sessionId, chat.projectPath);
          if (!isNamed) {
            const title = firstMsg.length > 15 ? firstMsg.slice(0, 15) + "…" : firstMsg;
            renameSession(sessionId, title, chat.projectPath).catch(() => {});
            broadcast("agent:session-renamed", { sessionId, title });
          }
        }

        // ── 轮转收尾：summarizing 完成 → 归档 + 新会话 ──
        if (chat && chat.contextStatus === "summarizing") {
          await finishRotation(chat, session, sessionId, {
            store: this.store,
            getModel: () => this.getModel(this.store),
            getAgentDir: () => this.getAgentDir(),
            buildSystemPrompt: (p, d) => this.buildSystemPrompt(p, d),
            buildExtraTools: (p, s) => this.buildExtraTools(p, s),
            promptAndBridge: (sess, sid, cid, text, c, images, payload) => this.promptAndBridge(sess, sid, cid, text, c, images, payload),
          });
          return; // 轮转完成，不继续
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      broadcast("agent:stream", { type: "error", sessionId, chatId, message: msg, canRetry: false });
      broadcast("agent:exit", { runId: chatId, code: -1 });
    } finally {
      unsub();
    }
  }

  // ── Worker（one-shot，接口保持） ──────────────────

  async runWorker(
    projectPath: string,
    prompt: string,
    _mainWindow: BrowserWindow,
  ): Promise<{ runId: string }> {
    const runId = `run-${++this.runCounter}`;
    const abortController = new AbortController();
    const run: ActiveRun = { runId, session: null, abortController };
    this.activeRuns.set(runId, run);

    (async () => {
      try {
        const resolvedPath = path.resolve(resolveHome(projectPath));
        const model = await this.getModel(this.store);
        if (!model) {
          broadcast("agent:stderr", { runId, data: "未配置 AI 模型，请在设置中配置 API", timestamp: Date.now() });
          broadcast("agent:exit", { runId, code: -1 });
          this.activeRuns.delete(runId);
          return;
        }

        const { tools: extraTools, canUseTool } = await this.buildExtraTools(resolvedPath, runId);
        const session = await createPiSession({
          cwd: resolvedPath,
          agentDir: this.getAgentDir(),
          model,
          thinkingLevel: "medium",
          store: this.store,
          systemPrompt: this.buildSystemPrompt(resolvedPath),
          extraTools,
          canUseTool,
        });
        run.session = session;

        await this.promptAndBridge(session, "", runId, prompt); // worker 无 chat

        broadcast("agent:exit", { runId, code: 0 });
        if (this.onWorkerComplete) this.onWorkerComplete(projectPath);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        broadcast("agent:stderr", { runId, data: msg, timestamp: Date.now() });
        broadcast("agent:exit", { runId, code: -1 });
      } finally {
        this.activeRuns.delete(runId);
      }
    })().catch((e) => {
      console.error("[agent] runWorker 未预期错误:", (e as Error).message);
    });

    return { runId };
  }

  abort(runId: string): void {
    const run = this.activeRuns.get(runId);
    if (run) {
      run.abortController.abort();
      run.session?.abort().catch(() => {});
      this.activeRuns.delete(runId);
    }
    // chat 会话：打断按钮只停主会话回合,子 Agent 继续后台执行(用户通过 ProcessBar 单独停止)
    // runId 可能是 chatId（前端打断按钮）或 sessionId（steer/其他）——先按 sessionId 查，再按 chatId 兜底
    let chat = this.findActiveChat(runId);
    if (!chat) {
      for (const [, c] of this.activeChats) {
        if (c.chatId === runId) { chat = c; break; }
      }
    }
    if (chat) {
      chat.abortController.abort();
      chat.session?.abort().catch(() => {});
    }
  }

  // ── Chat（长生命周期会话） ─────────────────────────

  /**
   * 发送聊天消息。如果 resumeSessionId 对应的会话已活跃 → 继续在该 session 上 prompt；
   * 否则创建新会话。
   */
  async sendMessage(
    projectPath: string,
    message: string,
    resumeSessionId: string | null,
    permissionMode: string | undefined,
    mainWindow: BrowserWindow,
    model?: string,
    isDesigner?: boolean,
    images?: Array<{ type: "image"; data: string; mimeType: string }>,
    thinkingLevel?: string,
    systemPayload?: SystemMessagePayload,
  ): Promise<{ chatId: string }> {
    const resolvedPath = path.resolve(resolveHome(projectPath));

    // 已有活跃会话 → 直接用
    if (resumeSessionId) {
      const existing = this.findActiveChat(resumeSessionId);
      if (existing && existing.session) {
        this.promptAndBridge(existing.session, resumeSessionId, existing.chatId, message, existing, images, systemPayload);
        return { chatId: existing.chatId };
      }
    }

    // 新会话
    const chatId = `chat-${++this.chatCounter}`;
    const piModel = await this.getModel(this.store);
    if (!piModel) {
      throw new Error("未配置 AI 模型，请在设置中配置 API");
    }

    // 验证 API Key 已配置
    if (!this.store.getActiveApiKey()) {
      console.warn("[agent] 未检测到有效的 API Key，请求可能失败");
    }

    // 恢复会话时补全 isDesigner：tab 恢复不会带此标记，从持久化的 session 类型中读取
    const designer = isDesigner || sessionAgentTypes.get(resumeSessionId ?? "") === "designer";

    // 新会话用临时 ID（task 工具绑定它），真实 sessionId 在 createPiSession 返回后更新
    const newSessionId = randomUUID();

    // 新建与恢复会话统一注入工具（历史实现恢复分支留空 → 恢复会话无 task/产品工具、无权限控制）
    const { tools: extraTools, canUseTool } = await this.buildExtraTools(
      resolvedPath,
      resumeSessionId ?? newSessionId,
      chatId,
    );

    // 后台 shell 退出 → 结果注入主会话(临时 ID 解析为真实 ID,同 task 委派)
    const shellExitInject = (shell: BackgroundShell): void => {
      const sid = resolveParentSessionId(resumeSessionId ?? newSessionId);
      this.injectSystemMessage(sid, formatShellResult(shell), "shell");
    };

    const session: AgentSession = await (async () => {
      if (resumeSessionId) {
        const sessions = await listPiSessions(resolvedPath);
        const info = sessions.find((s) => s.id === resumeSessionId);
        if (info) {
          return resumePiSession({
            cwd: resolvedPath,
            agentDir: this.getAgentDir(),
            model: piModel,
            store: this.store,
            resumeSessionFile: info.path,
            systemPrompt: this.buildSystemPrompt(resolvedPath, designer),
            extraTools,
            canUseTool,
            onShellExit: shellExitInject,
          });
        }
      }
      return createPiSession({
        cwd: resolvedPath,
        agentDir: this.getAgentDir(),
        model: piModel,
        store: this.store,
        systemPrompt: this.buildSystemPrompt(resolvedPath, designer),
        extraTools,
        canUseTool,
        onShellExit: shellExitInject,
      });
    })();

    // 注册临时 ID → 真实 ID 映射：task 委派创建时解析,按真实 ID 建子会话目录
    if (!resumeSessionId) {
      registerSessionIdMapping(newSessionId, session.sessionId);
    }

    const chat: ActiveChat = {
      chatId,
      sessionId: resumeSessionId ?? session.sessionId,
      tempSessionId: resumeSessionId ? undefined : newSessionId,
      session,
      abortController: new AbortController(),
      projectPath: resolvedPath,
      agentType: undefined,
      status: "idle",
      // 系统消息(custom payload)作为首条时,用 kind 中文标签作标题——
      // SDK 的 buildSessionInfo 过滤 custom 角色消息,不兜底会显示 "(no messages)"
      firstUserMessage: systemPayload
        ? (SYSTEM_KIND_TITLES[systemPayload.details.kind as string] ?? "系统消息")
        : message,
      assistantUuid: randomUUID(),
      eventBuffer: [],
      compactCount: 0,
      contextStatus: "normal",
      summaryBuffer: "",
      rotationContinuation: "",
    };

    if (isDesigner) {
      chat.agentType = "designer";
      if (resolvedPath) {
        const resourcesDir = path.join(__dirname, "..", "..", "..", "resources");
        const templateDir = path.join(resourcesDir, "em-html-editor");
        const brandDir = path.join(resourcesDir, "brand-tokens");
        const destTemplateDir = path.join(resolveHome(resolvedPath), ".easymint", "templates");
        const destBrandDir = path.join(resolveHome(resolvedPath), ".easymint", "brand-tokens");
        const templateFiles = [
          "template-landing.html", "template-dashboard.html",
          "template-form.html", "template-detail.html",
        ];
        try {
          fs.mkdirSync(destTemplateDir, { recursive: true });
          for (const f of templateFiles) {
            const src = path.join(templateDir, f);
            if (fs.existsSync(src)) fs.copyFileSync(src, path.join(destTemplateDir, f));
          }
          if (fs.existsSync(brandDir)) {
            fs.cpSync(brandDir, destBrandDir, { recursive: true });
          }
        } catch (e) { console.warn("[agent] 复制模板/品牌文件失败:", (e as Error).message); }
      }
    }

    this.activeChats.set(chatId, chat);

    // 记录 agent 类型
    if (chat.agentType && chat.sessionId) {
      sessionAgentTypes.set(chat.sessionId, chat.agentType);
      saveSessionTypes(sessionAgentTypes);
    }

    // 广播 session_id（前端需要）
    if (chat.sessionId) {
      broadcast("agent:chat-session", { chatId, sessionId: chat.sessionId });
    }

    // 设置思考级别（在 prompt 前同步设置，避免竞态）
    if (thinkingLevel) {
      try { session.setThinkingLevel(thinkingLevel as any); }
      catch (e) { console.warn("[agent] setThinkingLevel 失败:", (e as Error).message); }
    }

    // 发起第一轮对话
    this.promptAndBridge(session, chat.sessionId, chatId, message, chat, images, systemPayload);

    return { chatId };
  }

  findActiveChat(sessionId: string): ActiveChat | undefined {
    for (const [, chat] of this.activeChats) {
      // 双键匹配：task 工具绑定的 EM 临时 ID（tempSessionId）与对外 Pi 真实 ID（sessionId）
      if (chat.sessionId === sessionId || chat.tempSessionId === sessionId) return chat;
    }
    return undefined;
  }

  getChatStatus(sessionId: string): string {
    const chat = this.findActiveChat(sessionId);
    return chat?.status ?? "idle";
  }

  private bufferEvent(key: string, event: PiChatEvent): void {
    let buf = this.streamBuffer.get(key);
    if (!buf) {
      buf = [];
      this.streamBuffer.set(key, buf);
    }
    buf.push(event);
    if (buf.length > 500) buf.splice(0, buf.length - 500);
  }

  getBufferedStream(sessionId: string): unknown[] {
    const events: unknown[] = this.streamBuffer.get(sessionId) ?? [];
    this.streamBuffer.delete(sessionId);
    const chat = this.findActiveChat(sessionId);
    if (chat) {
      const chatEvents = this.streamBuffer.get(chat.chatId) ?? [];
      this.streamBuffer.delete(chat.chatId);
      events.push(...chatEvents);
    }
    return events;
  }

  async setModel(sessionId: string, modelName: string): Promise<void> {
    const chat = this.findActiveChat(sessionId);
    if (!chat?.session) return;
    // Pi 原生热切换模型
    const model = await getActiveModel(this.store);
    if (model && model.id === modelName) {
      await chat.session.setModel(model);
      chat.currentModel = modelName;
    } else {
      // 模型在 Pi 运行时中不存在，需要重建
      resetModelRuntime();
    }
  }


  async spawnAgentChat(
    projectPath: string,
    templateId: string,
    message: string,
  ): Promise<{ chatId: string }> {
    return this.sendMessage(projectPath, message, null, "auto",
      _mainWindow!,
      undefined, false);
  }

  killChat(chatId: string): void {
    const chat = this.activeChats.get(chatId);
    if (chat) {
      chat.abortController.abort();
      chat.session?.abort().catch(() => {});
      chat.session?.dispose();
      permissionService.clearSessionWhitelist(chat.sessionId);
      permissionService.clearSessionPending(chat.sessionId);
      this.activeChats.delete(chatId);
    }
  }

  scheduleIdleTimeout(_sessionId: string, _delayMs: number): void {
    // Pi 会话不同于 Claude SDK 的 query 进程，无需 idle timeout
    // 保留接口兼容性
  }

  private cancelIdleTimeout(_sessionId: string): void {
    // Pi 无需
  }

  onSessionRenamed(sessionId: string): void {
    const chat = this.findActiveChat(sessionId);
    if (chat) chat.firstUserMessage = "";
  }

  /** 查询 session 真实流状态——前端 busy 卡住时的兜底 */
  isStreaming(sessionId: string): boolean {
    const chat = this.findActiveChat(sessionId);
    return chat?.session?.isStreaming ?? false;
  }

  /** 获取会话统计（token 消耗、费用等）——活跃会话走内存，磁盘会话直接读 JSONL */
  async getSessionStats(sessionId: string, projectPath?: string): Promise<Record<string, unknown> | null> {
    // 1. 活跃会话：直接用 Pi 的 getSessionStats
    const chat = this.findActiveChat(sessionId);
    if (chat?.session) {
      try {
        const stats = chat.session.getSessionStats();
        return {
          sessionId: stats.sessionId, sessionFile: stats.sessionFile,
          userMessages: stats.userMessages, assistantMessages: stats.assistantMessages,
          toolCalls: stats.toolCalls, totalMessages: stats.totalMessages,
          tokens: stats.tokens, cost: stats.cost, contextUsage: stats.contextUsage,
        };
      } catch { /* fall through to disk read */ }
    }

    // 2. 磁盘会话：直接读 JSONL 统计
    if (!projectPath) return null;
    try {
      const { listPiSessions, getPiSessionDir } = await import("./pi-session");
      const { getSessionManagerClass } = await import("./pi-sdk");
      const resolved = path.resolve(resolveHome(projectPath));
      const sessions = await listPiSessions(resolved);
      const info = sessions.find((s) => s.id === sessionId);
      if (!info) return null;

      const SM = await getSessionManagerClass();
      const mgr = SM.open(info.path, getPiSessionDir(resolved), resolved);
      const entries = mgr.getEntries();

      let userMessages = 0, assistantMessages = 0, toolCalls = 0, totalMessages = 0;
      let inputTokens = 0, outputTokens = 0, cacheRead = 0, cacheWrite = 0;

      for (const entry of entries) {
        if (entry.type !== "message") continue;
        totalMessages++;
        const msg = entry.message as unknown as Record<string, unknown>;
        if (msg.role === "user") userMessages++;
        else if (msg.role === "assistant") {
          assistantMessages++;
          const usage = (msg as any).usage;
          if (usage) {
            inputTokens += usage.input ?? 0;
            outputTokens += usage.output ?? 0;
            cacheRead += usage.cacheRead ?? usage.cacheCreation?.[""] ?? 0;
            cacheWrite += usage.cacheWrite ?? 0;
          }
          const content = msg.content as Array<{ type: string }> | undefined;
          if (content) {
            for (const block of content) {
              if (block.type === "toolCall") toolCalls++;
            }
          }
        }
      }

      return {
        sessionId, sessionFile: info.path,
        userMessages, assistantMessages, toolCalls, totalMessages,
        tokens: { input: inputTokens, output: outputTokens, cacheRead, cacheWrite, total: inputTokens + outputTokens + cacheRead + cacheWrite },
        cost: 0, // 磁盘统计不计算费用（需模型定价信息）
      };
    } catch (e) {
      console.error("[agent] getSessionStats disk read failed:", e);
      return null;
    }
  }

  async peekUsage(_projectPath: string, sessionId: string): Promise<void> {
    const chat = this.findActiveChat(sessionId);
    if (chat?.session) {
      const usage = chat.session.getContextUsage();
      if (usage) {
        broadcast("agent:context-usage", {
          chatId: sessionId,
          percentage: usage.percent ?? 0,
          totalTokens: usage.tokens ?? 0,
          maxTokens: usage.contextWindow,
        });
        return;
      }
    }
    broadcast("agent:context-usage", { chatId: sessionId, percentage: 0, totalTokens: 0, maxTokens: 0 });
  }

  // ── Pi 原生支持的操作 ─────────────────────────────

  /** 注入引导消息（中断当前回合并插话） */
  /** 停止委派中的单个任务(ProcessBar 点击停止) */
  async stopDelegationTask(delegationId: string, taskIndex: number): Promise<void> {
    abortTask(delegationId, taskIndex);
    broadcast("agent:delegation-count", getRunningSummary());
  }

  async steer(sessionId: string, text: string): Promise<void> {
    // 插话 = 软打断：Mint 响应新消息,运行中的子 Agent 继续后台执行（对齐 cc 实测行为）
    const chat = this.findActiveChat(sessionId);
    await chat?.session?.steer(text);
  }

  /** 注入系统消息（委派完成/后台 shell 通知）:Mint 空闲 → 自动开新回合;忙碌 → 记 pending 回合结束 flush */
  injectSystemMessage(sessionId: string, text: string, kind: SystemMessageKind = "delegation"): void {
    const chat = this.findActiveChat(sessionId);
    if (!chat?.session) return;
    // content 保留 [系统消息] 前缀(模型侧识别);结构身份走 customType/kind(JSONL/事件/前端)
    const payload = systemMessage(kind, `[系统消息]-[Agent执行结果]\n${text}`);
    if (chat.status === "idle") {
      this.promptAndBridge(chat.session, sessionId, chat.chatId, "", chat, undefined, payload);
    } else {
      this.pendingSystemMessages.set(sessionId, payload);
    }
  }

  /** 注入跟进消息（当前回合结束后发送） */
  async followUp(sessionId: string, text: string): Promise<void> {
    const chat = this.findActiveChat(sessionId);
    await chat?.session?.followUp(text);
  }

  /** 手动压缩上下文 */
  async compact(sessionId: string, instructions?: string): Promise<void> {
    const chat = this.findActiveChat(sessionId);
    if (chat?.session) {
      broadcast("agent:context-summarizing", { chatId: chat.chatId, type: "compact" });
      await chat.session.compact(instructions);
    }
  }

  /** 切换思考级别 */
  setThinkingLevel(sessionId: string, level: string): void {
    const chat = this.findActiveChat(sessionId);
    chat?.session?.setThinkingLevel(level as any);
  }

  /** 循环切换模型 */
  async cycleModel(sessionId: string, direction: "forward" | "backward" = "forward"): Promise<void> {
    const chat = this.findActiveChat(sessionId);
    if (!chat?.session) return;
    const result = await chat.session.cycleModel(direction);
    if (result) {
      chat.currentModel = result.model.id;
      broadcast("agent:model-changed", { sessionId, model: result.model.id });
    }
  }

  /** 运行时切换活跃工具集 */
  setActiveTools(sessionId: string, toolNames: string[]): void {
    const chat = this.findActiveChat(sessionId);
    chat?.session?.setActiveToolsByName(toolNames);
  }

  shutdown(): void {
    for (const [id, chat] of this.activeChats) {
      chat.abortController.abort();
      chat.session?.abort().catch(() => {});
      chat.session?.dispose();
      permissionService.clearSessionWhitelist(chat.sessionId);
      permissionService.clearSessionPending(chat.sessionId);
      broadcast("agent:exit", { runId: id, code: -1 });
    }
    this.activeChats.clear();
    for (const [id, run] of this.activeRuns) {
      run.abortController.abort();
      run.session?.abort().catch(() => {});
      broadcast("agent:exit", { runId: id, code: -1 });
    }
    this.activeRuns.clear();
    // 清理全部后台 shell 进程(杀进程树,防孤儿进程)
    backgroundShellRegistry.stopAll();
  }
}

// ── setMainWindow ────────────────────────────────────

let _mainWindow: BrowserWindow | null = null;
export function setMainWindow(win?: BrowserWindow): void {
  if (win) _mainWindow = win;
}

