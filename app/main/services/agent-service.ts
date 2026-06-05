import os from "os";
import path from "path";
import fs from "fs";
import { BrowserWindow } from "electron";
import type { SDKMessage, Options as QueryOptions, PermissionMode } from "@anthropic-ai/claude-agent-sdk";

const LOG = path.join(os.homedir(), ".easymint", "easymint.log");
function log(msg: string) { try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch { /* ignore */ } }
import { Store } from "./store";
import { resolveEffectivePrompt } from "./system-prompt-manager";
import { listTemplates, getTemplate } from "./agent-templates";
import { buildSkillsPrompt } from "./skill-service";
import { buildMcpServersOption } from "./mcp-service";
import { archiveSession } from "./session-service";
import { CONTEXT_SUMMARY_INSTRUCTION } from "../../shared/prompts";

// Use createRequire for CJS/ESM compatibility in packaged Electron
type QueryFn = typeof import("@anthropic-ai/claude-agent-sdk").query;
let _query: QueryFn | null = null;
async function getQuery(): Promise<QueryFn> {
  if (!_query) {
    _query = (await import("@anthropic-ai/claude-agent-sdk")).query;
  }
  return _query;
}

type QueryObj = Awaited<ReturnType<QueryFn>>;
type SDKUserMessage = import("@anthropic-ai/claude-agent-sdk").SDKUserMessage;

// ═══════════════════════════════════════════════════════════════════════════════
// Long-lived message channel — one process per session, messages flow through a
// persistent AsyncGenerator that SDK's query() consumes.  Enqueue a new message
// to start the next turn without spawning a fresh process.
// ═══════════════════════════════════════════════════════════════════════════════

interface MessageChannel {
  /** Push a user message into the queue (non-blocking) */
  enqueue: (msg: SDKUserMessage) => void;
  /** Persistent generator consumed by SDK query() — stays alive across turns */
  generator: AsyncGenerator<SDKUserMessage>;
  /** Graceful close: mark done, drain remaining queue, let SDK wind down */
  close: () => void;
}

function createMessageChannel(signal: AbortSignal): MessageChannel {
  const queue: SDKUserMessage[] = [];
  let resolver: ((value: void) => void) | null = null;
  let done = signal.aborted;

  if (!done) {
    signal.addEventListener("abort", () => {
      done = true;
      if (resolver) { const r = resolver; resolver = null; r(); }
    }, { once: true });
  }

  async function* generator(): AsyncGenerator<SDKUserMessage> {
    while (!done) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else {
        await new Promise<void>((resolve) => { resolver = resolve; });
      }
    }
    while (queue.length > 0) {
      yield queue.shift()!;
    }
  }

  return {
    enqueue: (msg: SDKUserMessage) => {
      queue.push(msg);
      if (resolver) { const r = resolver; resolver = null; r(); }
    },
    generator: generator(),
    close: () => {
      done = true;
      if (resolver) { const r = resolver; resolver = null; r(); }
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Active sessions
// ═══════════════════════════════════════════════════════════════════════════════

interface ActiveRun {
  runId: string;
  query: QueryObj | null;
}

interface ActiveChat {
  chatId: string;
  sessionId: string;
  channel: MessageChannel;
  abortController: AbortController;
  query: QueryObj | null;
  projectPath: string;
  currentModel?: string;
  agentType?: "mint" | "builder" | "evaluator";
  /** SDK status: "requesting" | "compacting" | "idle" — tracks if agent is actively processing */
  status: string;
  /** Context rotation state: normal | summarizing | rotated */
  contextStatus: "normal" | "summarizing" | "rotated";
  /** Accumulated summary text during context rotation */
  summaryBuffer: string;
}

/** Build a query options block, reading API config from the Store. */
function buildQueryOptions(projectPath: string, store: Store, isResume: boolean, permissionMode: PermissionMode = "auto", overrides?: Partial<QueryOptions>): QueryOptions {
  const defaultDir = store.getSettings().defaultProjectDir || path.join(os.homedir(), "EasyMintProject");
  const baseDir = defaultDir.startsWith("~") ? path.join(os.homedir(), defaultDir.slice(1)) : defaultDir;
  const resolvedPath = projectPath || path.join(baseDir, "workspace");
  const cwd = path.resolve(resolvedPath.startsWith("~") ? path.join(os.homedir(), resolvedPath.slice(1)) : resolvedPath);
  if (!fs.existsSync(cwd)) fs.mkdirSync(cwd, { recursive: true });
  console.log("[buildQueryOptions] projectPath=%s → cwd=%s", projectPath || "(empty)", cwd);

  const settings = store.getSettings();
  const configDir = path.join(os.homedir(), ".easymint");
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => typeof v === "string")) as Record<string, string>,
    CLAUDE_CONFIG_DIR: configDir,
  };
  console.log("[buildQueryOptions] CLAUDE_CONFIG_DIR=%s", configDir);
  if (settings.apiBaseUrl) env.ANTHROPIC_BASE_URL = settings.apiBaseUrl;
  if (settings.apiKey) env.ANTHROPIC_AUTH_TOKEN = settings.apiKey;
  const customPrompt = isResume ? "" : (resolveEffectivePrompt() + buildSkillsPrompt(projectPath));
  // Load Agent templates into SDK's options.agents
  const agents: Record<string, { description: string; prompt: string; tools: string[]; model?: string }> = {};
  for (const t of listTemplates()) {
    agents[t.name.toLowerCase().replace(/\s+/g, "-")] = {
      description: t.description,
      prompt: t.prompt,
      tools: t.tools,
      ...(t.model ? { model: t.model } : {}),
    };
  }

  // Resolve SDK native binary path — asarUnpack puts it outside the asar
  let pathToClaudeCodeExecutable: string | undefined;
  const binaryName = process.platform === "win32" ? "claude.exe" : "claude";
  const pkgName = `claude-agent-sdk-${process.platform}-${process.arch}`;
  const possiblePaths = [
    path.join(process.resourcesPath || "", "app.asar.unpacked", "node_modules", "@anthropic-ai", pkgName, binaryName),
    path.join(process.resourcesPath || "", "..", "app.asar.unpacked", "node_modules", "@anthropic-ai", pkgName, binaryName),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) { pathToClaudeCodeExecutable = p; break; }
  }
  log("[buildQueryOptions] binary path: " + (pathToClaudeCodeExecutable || "NOT FOUND"));

  return {
    cwd,
    permissionMode,
    model: overrides?.model || settings.model || process.env.ANTHROPIC_MODEL || undefined,
    env,
    systemPrompt: customPrompt ? { type: "preset" as const, preset: "claude_code" as const, append: customPrompt } : undefined,
    agents: Object.keys(agents).length > 0 ? agents : undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mcpServers: buildMcpServersOption() as any,
    pathToClaudeCodeExecutable,
    ...overrides,
  };
}

/** Build an SDKUserMessage for enqueuing into a channel */
function buildUserMessage(message: string, sessionId: string): SDKUserMessage {
  return {
    type: "user" as const,
    session_id: sessionId,
    message: { role: "user" as const, content: message },
    parent_tool_use_id: null,
  } as SDKUserMessage;
}

export class AgentService {
  constructor(private store: Store) {}
  private activeRuns: Map<string, ActiveRun> = new Map();
  private activeChats: Map<string, ActiveChat> = new Map();
  private runCounter = 0;
  private chatCounter = 0;
  onWorkerComplete: ((projectPath: string) => void) | null = null;
  /** Buffer stream events per sessionId — flushed when a late-connecting window requests them */
  private streamBuffer: Map<string, unknown[]> = new Map();

  // ── Worker (one-shot, unchanged) ──────────────────────────────────────

  async runWorker(projectPath: string, prompt: string, mainWindow: BrowserWindow): Promise<{ runId: string }> {
    const runId = `run-${++this.runCounter}`;
    const run: ActiveRun = { runId, query: null };
    this.activeRuns.set(runId, run);

    (async () => {
      try {
        const q = await getQuery();
        const queryObj = await q({ prompt, options: buildQueryOptions(projectPath, this.store, false) });
        run.query = queryObj;
        for await (const msg of queryObj) {
          if (!this.activeRuns.has(runId)) break;
          const event = toStreamEvent(msg, runId, "", "worker");
          if (event) broadcast("agent:stream", event);
          if (msg.type === "result") {
            const code = msg.subtype === "success" ? 0 : 1;
            broadcast("agent:exit", { runId, code });
            this.activeRuns.delete(runId);
            if (code === 0 && this.onWorkerComplete) this.onWorkerComplete(projectPath);
          }
        }
      } catch (err: unknown) {
        if (this.activeRuns.has(runId)) {
          const msg = err instanceof Error ? err.message : String(err);
          broadcast("agent:stderr", { runId, data: msg, timestamp: Date.now() });
          broadcast("agent:exit", { runId, code: -1 });
          this.activeRuns.delete(runId);
        }
      }
    })();

    return { runId };
  }

  abort(runId: string): void {
    const run = this.activeRuns.get(runId);
    if (run?.query) {
      run.query.interrupt().catch(() => {});
      this.activeRuns.delete(runId);
    }
  }

  // ── Chat (long-lived process + message channel) ───────────────────────

  /**
   * Send a chat message.  If a session with this sessionId is already active
   * the message is enqueued into the live channel; otherwise a new long-lived
   * query is started.
   */
  sendMessage(projectPath: string, message: string, resumeSessionId: string | null, permissionMode: string | undefined, mainWindow: BrowserWindow, model?: string): { chatId: string } {
    // Existing session → enqueue into live channel
    if (resumeSessionId) {
      const existing = this.findActiveChat(resumeSessionId);
      if (existing) {
        console.log("[sendMessage] enqueue to existing session: sessionId=%s chatId=%s", resumeSessionId, existing.chatId);
        existing.channel.enqueue(buildUserMessage(message, resumeSessionId));
        return { chatId: existing.chatId };
      }
    }

    // New session
    const chatId = `chat-${++this.chatCounter}`;
    const isResume = !!resumeSessionId;
    const overrides: Partial<QueryOptions> = isResume ? { resume: resumeSessionId } : {};
    if (model) overrides.model = model;
    const mode = (permissionMode as PermissionMode) || "auto";
    const options = buildQueryOptions(projectPath, this.store, isResume, mode, overrides);

    const abortController = new AbortController();
    const channel = createMessageChannel(abortController.signal);

    const chat: ActiveChat = {
      chatId,
      sessionId: resumeSessionId ?? "",
      channel,
      abortController,
      query: null,
      projectPath,
      status: "idle",
      contextStatus: "normal",
      summaryBuffer: "",
    };
    this.activeChats.set(chatId, chat);

    // For resume: inject session identity into the first turn
    if (resumeSessionId) {
      if (!options.systemPrompt) {
        options.systemPrompt = { type: "preset" as const, preset: "claude_code" as const, append: `<session_info>\n当前会话 ID: ${resumeSessionId}\n</session_info>` };
      } else if (typeof options.systemPrompt === "object" && "append" in options.systemPrompt) {
        const sp = options.systemPrompt as { append?: string };
        sp.append = (sp.append || "") + `\n\n<session_info>\n当前会话 ID: ${resumeSessionId}\n</session_info>`;
      }
    }

    // Enqueue the first message BEFORE starting query (SDK pulls immediately)
    channel.enqueue(buildUserMessage(message, resumeSessionId ?? ""));

    // Start the long-lived query loop (fire-and-forget)
    this.startChatLoop(chat, options);

    return { chatId };
  }

  /** Background async loop that drives the long-lived query for a chat session */
  private startChatLoop(chat: ActiveChat, options: QueryOptions): void {
    (async () => {
      try {
        const q = await getQuery();
        log("[chat-loop] query cwd=" + (options.cwd || "?") + " token=" + (options.env?.ANTHROPIC_AUTH_TOKEN ? "SET" : "MISSING"));
        const queryObj = await q({ prompt: chat.channel.generator, options });
        log("[chat-loop] query OK");
        chat.query = queryObj;

        let capturedSid = chat.sessionId;

        // Initial context usage — show immediately for both new and resume sessions
        setTimeout(async () => {
          try {
            const usage = await chat.query!.getContextUsage();
            broadcast("agent:context-usage", { chatId: chat.chatId, percentage: usage.percentage, totalTokens: usage.totalTokens, maxTokens: usage.maxTokens });
          } catch { /* ignore */ }
        }, 500);

        for await (const msg of queryObj) {
          if (chat.abortController.signal.aborted) break;

          // Capture session_id from SDK (first message carries it for new sessions)
          const sdkSid = (msg as { session_id?: string }).session_id;
          if (!capturedSid && sdkSid) {
            capturedSid = sdkSid;
            chat.sessionId = sdkSid;
            broadcast("agent:chat-session", { chatId: chat.chatId, sessionId: sdkSid });
          }

          // Accumulate assistant text during summarization
          if (chat.contextStatus === "summarizing" && msg.type === "assistant") {
            const content = (msg as { message?: { content?: unknown[] } }).message?.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                const b = block as { type?: string; text?: string };
                if (b.type === "text" && b.text) chat.summaryBuffer += b.text;
              }
            }
          }

          // Stream event → renderer + buffer for late-connecting windows
          const event = toStreamEvent(msg, chat.chatId, capturedSid, "chat");
          if (event) {
            broadcast("agent:stream", event);
            this.bufferEvent(chat.sessionId || chat.chatId, event);
          }

          // result = turn completed
          if (msg.type === "result") {
            chat.status = "idle";
            broadcast("agent:exit", { runId: chat.chatId, code: msg.subtype === "success" ? 0 : 1 });

            // ── Context rotation ──
            if (chat.contextStatus === "summarizing" && msg.subtype === "success") {
              chat.contextStatus = "rotated";
              // Send summary to renderer before rotating
              if (chat.summaryBuffer) {
                broadcast("agent:context-summary", { chatId: chat.chatId, summary: chat.summaryBuffer });
              }
              break; // exit loop → triggers rotation in finally-like handler
            }

            if (chat.contextStatus === "normal") {
              try {
                const usage = await chat.query!.getContextUsage();
                broadcast("agent:context-usage", { chatId: chat.chatId, percentage: usage.percentage, totalTokens: usage.totalTokens, maxTokens: usage.maxTokens });
                const threshold = this.store.getSettings().contextThreshold ?? 60;
                if (usage.percentage >= threshold) {
                  chat.contextStatus = "summarizing";
                  chat.summaryBuffer = "";
                  chat.channel.enqueue(buildUserMessage(CONTEXT_SUMMARY_INSTRUCTION, capturedSid));
                  broadcast("agent:context-summarizing", { chatId: chat.chatId });
                  log(`[chat-loop] context ${usage.percentage}% >= ${threshold}%, starting summarization`);
                }
              } catch (err) {
                log(`[chat-loop] getContextUsage failed: ${String(err)}`);
              }
            }
          }
        }

        // ── Rotate: create new session with summary ──
        if (chat.contextStatus === "rotated" && chat.summaryBuffer) {
          try {
            this.rotateSession(chat);
          } catch (err) {
            log("[chat-loop] rotate ERROR: " + String(err));
          }
        }
      } catch (err: unknown) {
        log("[chat-loop] ERROR: " + String(err));
        if (this.activeChats.has(chat.chatId)) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[chat-loop] error: chatId=%s %s", chat.chatId, msg);
          broadcast("agent:stderr", { runId: chat.chatId, data: msg, timestamp: Date.now() });
          broadcast("agent:exit", { runId: chat.chatId, code: -1 });
        }
      }
      console.log("[chat-loop] ended: chatId=%s", chat.chatId);
      this.activeChats.delete(chat.chatId);
    })();
  }

  /** Peek context usage for a session without modifying it. One-shot — no persistent chat loop. */
  async peekUsage(projectPath: string, sessionId: string): Promise<void> {
    try {
      const q = await getQuery();
      const overrides: Partial<QueryOptions> = { resume: sessionId, maxBypassTurns: 0 };
      const options = buildQueryOptions(projectPath, this.store, true, "auto", overrides);
      const queryObj = await q({ prompt: "", options });
      const usage = await queryObj.getContextUsage();
      broadcast("agent:context-usage", { chatId: `peek-${sessionId}`, percentage: usage.percentage, totalTokens: usage.totalTokens, maxTokens: usage.maxTokens });
      queryObj.interrupt().catch(() => {});
    } catch (err) {
      console.error("[peekUsage] failed:", String(err));
    }
  }

  /** Find an active chat by SDK session ID */
  private findActiveChat(sessionId: string): ActiveChat | undefined {
    for (const chat of this.activeChats.values()) {
      if (chat.sessionId === sessionId) return chat;
    }
    return undefined;
  }

  /**
   * Stop generating (soft interrupt).  Interrupts the current turn without
   * killing the process — the channel stays open for the next message.
   */
  stopChat(chatId: string): void {
    const chat = this.activeChats.get(chatId);
    if (chat?.query) {
      chat.query.interrupt().catch(() => {});
      console.log("[stopChat] soft interrupt: chatId=%s", chatId);
    }
  }

  /** Context rotation: archive old session and create a new chat tab with summary */
  private rotateSession(chat: ActiveChat): void {
    const summary = chat.summaryBuffer;
    log(`[rotateSession] rotating chatId=${chat.chatId} sessionId=${chat.sessionId}`);

    // Determine the next step hint from the last line of the summary
    const continuationMatch = summary.match(/我们继续.*吧/);
    const continuation = continuationMatch ? continuationMatch[0] : "我们继续推进吧";

    // Build handoff message: project context + summary + documents list
    const projectPath = chat.projectPath;
    const handoffPrompt = `[系统消息] 这是从上一轮会话迁移过来的项目上下文。请从这个断点继续工作。

<project_context>
项目路径: ${projectPath}
请阅读项目中的 CLAUDE.md、docs/需求规格.md、docs/架构设计.md 了解项目背景和技术栈。
</project_context>

<previous_session_summary>
${summary}
</previous_session_summary>

请检查项目当前状态，然后用自然的语气对用户说一句话作为开场，告诉用户会话已整理完毕，接下来继续做什么。开场白以"${continuation}"结尾。`;

    // Archive old session
    if (chat.sessionId) {
      try { archiveSession(chat.sessionId); } catch { /* best effort */ }
    }

    // Broadcast to renderer: create new chat tab with the handoff
    broadcast("agent:rotate-create", {
      oldChatId: chat.chatId,
      oldSessionId: chat.sessionId,
      projectPath,
      handoffPrompt,
    });
  }

  /** Switch model in an active chat session */
  async setModel(sessionId: string, model: string): Promise<void> {
    const chat = this.findActiveChat(sessionId);
    if (!chat?.query) return; // not active yet, model will apply on next sendMessage
    try {
      await (chat.query as { setModel?: (m: string) => Promise<void> }).setModel?.(model);
      chat.currentModel = model;
      console.log("[setModel] switched to %s for sessionId=%s", model, sessionId);
    } catch (err) {
      console.error("[setModel] error:", err);
      throw err;
    }
  }

  /** Create an independent Agent session from a template */
  spawnAgentChat(projectPath: string, templateId: string, initialMessage: string): { chatId: string } {
    const template = getTemplate(templateId);
    if (!template) throw new Error(`模板不存在: ${templateId}`);

    const chatId = `agent-${++this.chatCounter}`;
    const mode: PermissionMode = "bypassPermissions";
    const options = buildQueryOptions(projectPath, this.store, false, mode);

    // Replace the system prompt with the template's prompt
    options.systemPrompt = {
      type: "preset" as const,
      preset: "claude_code" as const,
      append: template.prompt,
    };
    if (template.model) options.model = template.model;

    const abortController = new AbortController();
    const channel = createMessageChannel(abortController.signal);

    const chat: ActiveChat = {
      chatId, sessionId: "", channel, abortController, query: null, projectPath,
      agentType: template.agentType, status: "idle", contextStatus: "normal", summaryBuffer: "",
    };
    this.activeChats.set(chatId, chat);

    channel.enqueue(buildUserMessage(initialMessage, ""));
    this.startChatLoop(chat, options);

    console.log("[spawnAgentChat] %s (%s) → chatId=%s", template.name, template.agentType, chatId);
    return { chatId };
  }

  /** Push a system message into another active chat's channel (cross-Agent communication) */
  notifySession(targetSessionId: string, message: string): void {
    const target = this.findActiveChat(targetSessionId);
    if (!target) {
      console.warn("[notifySession] target session not active: %s", targetSessionId);
      return;
    }
    target.channel.enqueue(buildUserMessage(message, targetSessionId));
    console.log("[notifySession] → sessionId=%s", targetSessionId);
  }

  /** Hard kill a chat session — close channel, abort process, remove */
  killChat(chatId: string): void {
    const chat = this.activeChats.get(chatId);
    if (!chat) return;
    chat.channel.close();
    chat.abortController.abort();
    if (chat.query) {
      try { chat.query.close?.(); } catch { /* ignore */ }
    }
    this.activeChats.delete(chatId);
    broadcast("agent:exit", { runId: chatId, code: -1 });
    console.log("[killChat] hard killed: chatId=%s", chatId);
  }

  /** Get the current SDK status for a session: "requesting" | "compacting" | "idle" | null (unknown/not alive) */
  getChatStatus(sessionId: string): string | null {
    const chat = this.findActiveChat(sessionId);
    return chat ? chat.status : null;
  }

  /** Interrupt all active sessions — call on app quit or project switch */
  /** Buffer a stream event for a session. Late-connecting windows can replay via getBufferedStream. */
  private bufferEvent(key: string, event: unknown): void {
    if (!this.streamBuffer.has(key)) this.streamBuffer.set(key, []);
    this.streamBuffer.get(key)!.push(event);
  }

  /** Return buffered stream events for a session and clear them. Called by new windows on mount. */
  getBufferedStream(sessionId: string): unknown[] {
    const events = this.streamBuffer.get(sessionId) || [];
    this.streamBuffer.delete(sessionId);
    // Also check by chatId (used as key for brand-new sessions before sessionId is known)
    const chat = this.findActiveChat(sessionId);
    if (chat) {
      const chatEvents = this.streamBuffer.get(chat.chatId) || [];
      this.streamBuffer.delete(chat.chatId);
      events.push(...chatEvents);
    }
    return events;
  }

  shutdown(): void {
    for (const [id, chat] of this.activeChats) {
      chat.channel.close();
      chat.abortController.abort();
      if (chat.query) {
        try { chat.query.close?.(); } catch { /* ignore */ }
      }
      broadcast("agent:exit", { runId: id, code: -1 });
    }
    this.activeChats.clear();
    for (const [id, run] of this.activeRuns) {
      run.query?.interrupt().catch(() => {});
      broadcast("agent:exit", { runId: id, code: -1 });
    }
    this.activeRuns.clear();
  }
}

// ── Multi-window broadcast ──
function broadcast(channel: string, data: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  });
}

// ── Shared mutable reference for IPC window access ──
let _mainWindow: BrowserWindow | null = null;
export function setMainWindow(win?: BrowserWindow) { if (win) _mainWindow = win; }

// ── SDK message → StreamEvent mapping ──
function toStreamEvent(msg: SDKMessage, runId: string, sessionId: string, source: "worker" | "chat"): {
  runId: string; sessionId: string; type: string; data: Record<string, unknown>; timestamp: number; source: string;
} | null {
  const ts = Date.now();
  const t = msg.type;
  // Filtering key: ChatPanel only processes events matching its own sessionId
  const base = { runId, sessionId, timestamp: ts, source };

  if (t === "assistant") {
    const content = (msg as { message?: { content?: unknown[] } }).message?.content;
    if (Array.isArray(content) && content.length > 0) {
      const block = content[0] as Record<string, unknown>;
      const blockType = typeof block.type === "string" ? block.type : "text";
      if (blockType === "text") {
        return { ...base, type: "assistant", data: { text: block.text } };
      }
      if (blockType === "tool_use") {
        return { ...base, type: "tool_use", data: { id: block.id, name: block.name, input: block.input } };
      }
      if (blockType === "thinking") {
        return { ...base, type: "assistant", data: { delta: block.thinking } };
      }
    }
    return null;
  }

  if (t === "user") {
    const content = (msg as { message?: { content?: unknown[] } }).message?.content;
    if (Array.isArray(content) && content.length > 0) {
      const block = content[0] as Record<string, unknown>;
      if (block.type === "tool_result") {
        return { ...base, type: "tool_result", data: { tool_use_id: block.tool_use_id, content: block.content, isError: !!block.is_error } };
      }
    }
    return null;
  }

  if (t === "result") {
    const rm = msg as { subtype: string; result?: string; is_error?: boolean; session_id?: string };
    return { ...base, type: "system", data: { subtype: rm.subtype, result: rm.result ?? "", is_error: rm.is_error } };
  }

  if (t === "system") {
    const subtype = (msg as { subtype?: string }).subtype ?? "";
    if (subtype === "status") {
      const status = (msg as { status?: string | null }).status;
      const text = status ? STATUS_LABELS[status] ?? status : null;
      if (text) return { ...base, type: "status", data: { text } };
      return null;
    }
    const skip = new Set(["init", "hook_started", "hook_response", "hook_progress", "memory_recall", "api_retry", "requesting", "compacting", "session_state_changed", "notification", "permission_denied", "files_persisted", "rate_limit"]);
    if (skip.has(subtype)) return null;
    return { ...base, type: "system", data: { message: subtype || "System event" } };
  }

  return null;
}

const STATUS_LABELS: Record<string, string> = {
  requesting: "正在思考...",
  compacting: "整理上下文中...",
  idle: "",
};
