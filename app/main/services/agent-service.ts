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
import { Store } from "./store";
import { resolveEffectivePrompt } from "./system-prompt-manager";
import { getTemplate } from "./agent-templates";
import { buildSkillsPrompt } from "./skill-service";
import { getActiveModel, resetModelRuntime } from "./pi-init";
import { createPiSession, resumePiSession, listPiSessions } from "./pi-session";
import {
  bridgeSessionEvents,
  createPartialCoalescer,
  convertPiAssistantMessage,
  type PiChatEvent,
} from "./event-bridge";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai/compat";
import { randomUUID } from "node:crypto";

// ── 类型 ────────────────────────────────────────────

interface ActiveRun {
  runId: string;
  session: AgentSession | null;
  abortController: AbortController;
}

interface ActiveChat {
  chatId: string;
  sessionId: string;
  session: AgentSession | null;
  abortController: AbortController;
  projectPath: string;
  currentModel?: string;
  agentType?: "mint" | "builder" | "evaluator" | "designer";
  status: string;
  firstUserMessage: string;
  /** 当前 assistant 消息的 uuid */
  assistantUuid: string;
  /** PiChatEvent buffer（供 late-connecting 前端获取） */
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
  } catch { /* ignore */ }
  return new Map();
}

function saveSessionTypes(map: Map<string, string>): void {
  try {
    const dir = path.dirname(SESSION_TYPES_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SESSION_TYPES_PATH, JSON.stringify(Object.fromEntries(map), null, 2));
  } catch { /* ignore */ }
}

// 初始化时加载已有记录
const loaded = loadSessionTypes();
for (const [k, v] of loaded) sessionAgentTypes.set(k, v);

export function getSessionAgentType(sessionId: string): string | undefined {
  return sessionAgentTypes.get(sessionId);
}

export function getDesignSessionIds(): string[] {
  const ids: string[] = [];
  for (const [id, type] of sessionAgentTypes) {
    if (type === "designer") ids.push(id);
  }
  return ids;
}

// ── 上下文压缩 ──────────────────────────────────────

/** 触发 compact 的上下文使用率默认阈值（百分比） */
const DEFAULT_COMPACT_THRESHOLD = 65;

// ── AgentService ────────────────────────────────────

export class AgentService {
  constructor(private store: Store) {}
  private activeRuns: Map<string, ActiveRun> = new Map();
  private activeChats: Map<string, ActiveChat> = new Map();
  private runCounter = 0;
  private chatCounter = 0;
  onWorkerComplete: ((projectPath: string) => void) | null = null;
  private streamBuffer: Map<string, PiChatEvent[]> = new Map();

  // ── 内部辅助 ──────────────────────────────────────

  private getAgentDir(): string {
    return path.join(os.homedir(), ".easymint", "pi");
  }

  private async getModel(store: Store): Promise<Model<any> | null> {
    const m = await getActiveModel(store);
    return m ?? null;
  }

  private buildSystemPrompt(projectPath: string, agentTemplate?: string): string {
    const parts: string[] = [];

    if (agentTemplate) {
      const tpl = getTemplate(agentTemplate);
      if (tpl) parts.push(tpl.prompt);
    }

    const effective = resolveEffectivePrompt();
    if (effective) parts.push(effective);

    const skills = buildSkillsPrompt(projectPath);
    if (skills) parts.push(skills);

    return parts.join("\n\n");
  }

  /** 处理 prompt → 广播错误到前端 */
  private async promptAndBridge(
    session: AgentSession,
    sessionId: string,
    chatId: string,
    text: string,
  ): Promise<void> {
    const coalescer = createPartialCoalescer(({ message, uuid }) => {
      const ev = convertPiAssistantMessage(message, sessionId, {
        final: false,
        uuid,
      });
      if (ev) {
        ev.chatId = chatId;
        broadcast("agent:stream", ev);
        this.bufferEvent(sessionId, ev);
      }
    });

    let lastPartialAssistant: AssistantMessage | null = null;
    let assistantUuid = randomUUID();
    let pendingResult: PiChatEvent | null = null;

    const unsub = session.subscribe((event: AgentSessionEvent) => {
      try {
        bridgeSessionEvents(
          event,
          {
            onEvent: (ev) => {
              ev.sessionId = sessionId;
              ev.chatId = chatId;
              broadcast("agent:stream", ev);
              this.bufferEvent(sessionId, ev);
            },
            getAssistantUuid: () => assistantUuid,
            setPendingResult: (ev: PiChatEvent) => { pendingResult = ev as PiChatEvent; },
          },
          {
            coalescer,
            lastPartialAssistant: lastPartialAssistant as any,
          },
        );

        // 跟踪 partial 状态
        if (event.type === "message_update") {
          const msg = event.message as any;
          if (msg.role === "assistant") lastPartialAssistant = msg;
        }
        if (event.type === "message_end") {
          lastPartialAssistant = null;
          assistantUuid = randomUUID();
        }
      } catch (e) {
        console.error("[agent] bridge error:", e);
      }
    });

    try {
      await session.prompt(text);

      // agent_end 后的 pending result
      const pr = pendingResult as PiChatEvent | null;
      if (pr) {
        pr.sessionId = sessionId;
        pr.chatId = chatId;
        broadcast("agent:stream", pr);
        this.bufferEvent(sessionId, pr);
        broadcast("agent:exit", { runId: chatId, code: 0 });

        // 上下文检测（简化版 — 步骤五用 Pi 原生 compact 替代）
        setTimeout(() => {
          broadcast("agent:context-usage", {
            chatId,
            percentage: 0,
            totalTokens: 0,
            maxTokens: 200000,
          });
        }, 500);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      broadcast("agent:stream", {
        type: "error",
        sessionId,
        chatId,
        message: msg,
        canRetry: false,
      });
      broadcast("agent:exit", { runId: chatId, code: -1 });
    } finally {
      coalescer.flush();
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

        const session = await createPiSession({
          cwd: resolvedPath,
          agentDir: this.getAgentDir(),
          model,
          thinkingLevel: "medium",
          store: this.store,
          systemPrompt: this.buildSystemPrompt(resolvedPath),
        });
        run.session = session;

        await this.promptAndBridge(session, "", runId, prompt);

        broadcast("agent:exit", { runId, code: 0 });
        if (this.onWorkerComplete) this.onWorkerComplete(projectPath);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        broadcast("agent:stderr", { runId, data: msg, timestamp: Date.now() });
        broadcast("agent:exit", { runId, code: -1 });
      } finally {
        this.activeRuns.delete(runId);
      }
    })();

    return { runId };
  }

  abort(runId: string): void {
    const run = this.activeRuns.get(runId);
    if (run) {
      run.abortController.abort();
      run.session?.abort().catch(() => {});
      this.activeRuns.delete(runId);
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
    agentTemplate?: string,
  ): Promise<{ chatId: string }> {
    const resolvedPath = path.resolve(resolveHome(projectPath));

    // 已有活跃会话 → 直接用
    if (resumeSessionId) {
      const existing = this.findActiveChat(resumeSessionId);
      if (existing && existing.session) {
        this.promptAndBridge(existing.session, resumeSessionId, existing.chatId, message);
        return { chatId: existing.chatId };
      }
    }

    // 新会话
    const chatId = `chat-${++this.chatCounter}`;
    const piModel = await this.getModel(this.store);
    if (!piModel) {
      throw new Error("未配置 AI 模型，请在设置中配置 API");
    }

    const session: AgentSession = await (async () => {
      if (resumeSessionId) {
        const sessionDir = path.join(resolvedPath, ".easymint", "pi-sessions");
        const sessions = await listPiSessions(resolvedPath);
        const info = sessions.find((s) => s.id === resumeSessionId);
        if (info) {
          return resumePiSession({
            cwd: resolvedPath,
            agentDir: this.getAgentDir(),
            model: piModel,
            store: this.store,
            resumeSessionFile: info.path,
            systemPrompt: this.buildSystemPrompt(resolvedPath, agentTemplate),
          });
        }
      }
      return createPiSession({
        cwd: resolvedPath,
        agentDir: this.getAgentDir(),
        model: piModel,
        store: this.store,
        systemPrompt: this.buildSystemPrompt(resolvedPath, agentTemplate),
      });
    })();

    const chat: ActiveChat = {
      chatId,
      sessionId: resumeSessionId ?? session.sessionId,
      session,
      abortController: new AbortController(),
      projectPath: resolvedPath,
      agentType: undefined,
      status: "idle",
      firstUserMessage: message,
      assistantUuid: randomUUID(),
      eventBuffer: [],
    };

    if (agentTemplate) {
      const tpl = getTemplate(agentTemplate);
      if (tpl) {
        chat.agentType = tpl.agentType;
        if (tpl.agentType === "designer" && resolvedPath) {
          const srcDir = path.join(__dirname, "..", "..", "..", "resources", "em-html-editor");
          const destDir = path.join(resolveHome(resolvedPath), ".easymint", "templates");
          const templateFiles = [
            "template-landing.html", "template-dashboard.html",
            "template-form.html", "template-detail.html",
          ];
          try {
            fs.mkdirSync(destDir, { recursive: true });
            for (const f of templateFiles) {
              const src = path.join(srcDir, f);
              if (fs.existsSync(src)) fs.copyFileSync(src, path.join(destDir, f));
            }
          } catch { /* 非关键路径 */ }
        }
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

    // 发起第一轮对话
    this.promptAndBridge(session, chat.sessionId, chatId, message);

    return { chatId };
  }

  findActiveChat(sessionId: string): ActiveChat | undefined {
    for (const [, chat] of this.activeChats) {
      if (chat.sessionId === sessionId) return chat;
    }
    return undefined;
  }

  stopChat(runId: string): void {
    this.abort(runId);
    const chat = this.findActiveChat(runId);
    if (chat) {
      chat.abortController.abort();
      chat.session?.abort().catch(() => {});
      this.activeChats.delete(chat.chatId);
    }
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

  listCommands(): Array<{ name: string; description: string; argumentHint: string; aliases?: string[] }> {
    return this.store.getCommandsCache();
  }

  async setModel(sessionId: string, model: string): Promise<void> {
    const chat = this.findActiveChat(sessionId);
    if (chat?.session) {
      chat.currentModel = model;
      resetModelRuntime();
    }
  }

  notifySession(sessionId: string, message: string): void {
    const chat = this.findActiveChat(sessionId);
    if (chat?.session) {
      broadcast("agent:stream", {
        type: "message",
        sessionId,
        chatId: chat.chatId,
        blocks: [{ type: "text", text: message }],
        partial: false,
      });
    }
  }

  async spawnAgentChat(
    projectPath: string,
    templateId: string,
    message: string,
  ): Promise<{ chatId: string }> {
    return this.sendMessage(projectPath, message, null, "auto",
      BrowserWindow.getAllWindows()[0]!,
      undefined, templateId);
  }

  killChat(chatId: string): void {
    const chat = this.activeChats.get(chatId);
    if (chat) {
      chat.abortController.abort();
      chat.session?.abort().catch(() => {});
      chat.session?.dispose();
      this.activeChats.delete(chatId);
    }
  }

  scheduleIdleTimeout(sessionId: string, _delayMs: number): void {
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

  async peekUsage(_projectPath: string, sessionId: string): Promise<void> {
    broadcast("agent:context-usage", {
      chatId: sessionId,
      percentage: 0,
      totalTokens: 0,
      maxTokens: 200000,
    });
  }

  shutdown(): void {
    for (const [id, chat] of this.activeChats) {
      chat.abortController.abort();
      chat.session?.abort().catch(() => {});
      chat.session?.dispose();
      broadcast("agent:exit", { runId: id, code: -1 });
    }
    this.activeChats.clear();
    for (const [id, run] of this.activeRuns) {
      run.abortController.abort();
      run.session?.abort().catch(() => {});
      broadcast("agent:exit", { runId: id, code: -1 });
    }
    this.activeRuns.clear();
  }
}

// ── setMainWindow ────────────────────────────────────

let _mainWindow: BrowserWindow | null = null;
export function setMainWindow(win?: BrowserWindow): void {
  if (win) _mainWindow = win;
}

// ── broadcast helper ───────────────────────────────

function broadcast(channel: string, data: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  });
}
