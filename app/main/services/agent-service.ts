import os from "os";
import path from "path";
import fs from "fs";
import { BrowserWindow } from "electron";
import type { SDKMessage, Options as QueryOptions, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { Store } from "./store";
import { resolveEffectivePrompt } from "./system-prompt-manager";

// Dynamic import — ESM SDK in CJS context (matching Proma pattern)
type QueryFn = typeof import("@anthropic-ai/claude-agent-sdk").query;
let _query: QueryFn | null = null;
async function getQuery(): Promise<QueryFn> {
  if (!_query) {
    _query = (await import("@anthropic-ai/claude-agent-sdk")).query;
  }
  return _query;
}

type QueryObj = Awaited<ReturnType<QueryFn>>;

interface ActiveRun {
  runId: string;
  query: QueryObj | null;
}

interface ActiveChat {
  chatId: string;
  sessionId: string;
  query: QueryObj | null;
  projectPath: string;
}

/** Build a query options block, reading API config from the Store. */
function buildQueryOptions(projectPath: string, store: Store, isResume: boolean, permissionMode: PermissionMode = "auto", overrides?: Partial<QueryOptions>): QueryOptions {
  // Ensure the working directory exists (important for default workspace)
  const resolvedPath = projectPath || path.join(os.homedir(), "EasyMintProject", "workspace");
  const cwd = resolvedPath.startsWith("~") ? path.join(os.homedir(), resolvedPath.slice(1)) : resolvedPath;
  if (!fs.existsSync(cwd)) fs.mkdirSync(cwd, { recursive: true });

  const settings = store.getSettings();
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => typeof v === "string")) as Record<string, string>,
    CLAUDE_CONFIG_DIR: path.join(os.homedir(), ".easymint", "sdk-config"),
  };
  if (settings.apiBaseUrl) env.ANTHROPIC_BASE_URL = settings.apiBaseUrl;
  if (settings.apiKey) env.ANTHROPIC_API_KEY = settings.apiKey;
  // Inject system prompt only for new sessions. Resume uses the session's stored prompt.
  const customPrompt = isResume ? "" : resolveEffectivePrompt();
  return {
    cwd,
    permissionMode,
    model: process.env.ANTHROPIC_MODEL || undefined,
    env,
    systemPrompt: customPrompt ? { type: "preset" as const, preset: "claude_code" as const, append: customPrompt } : undefined,
    ...overrides,
  };
}

export class AgentService {
  constructor(private store: Store) {}
  private activeRuns: Map<string, ActiveRun> = new Map();
  private activeChats: Map<string, ActiveChat> = new Map();
  private runCounter = 0;
  private chatCounter = 0;
  onWorkerComplete: ((projectPath: string) => void) | null = null;

  /** Worker — sdk.query one-shot, streaming */
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

          const event = toStreamEvent(msg, runId, "worker");
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

  /** Send message — SDK manages session lifecycle, we just capture & pass session_id */
  sendMessage(projectPath: string, message: string, resumeSessionId: string | null, permissionMode: string | undefined, mainWindow: BrowserWindow): { chatId: string } {
    const chatId = `chat-${++this.chatCounter}`;
    const isResume = !!resumeSessionId;
    const overrides = isResume ? { resume: resumeSessionId } : {};
    const mode = (permissionMode as PermissionMode) || "auto";
    const options = buildQueryOptions(projectPath, this.store, isResume, mode, overrides);

    const chat: ActiveChat = { chatId, sessionId: resumeSessionId ?? "", query: null, projectPath };
    this.activeChats.set(chatId, chat);

    // For resume: inject session ID so the model knows its identity
    if (resumeSessionId) {
      if (!options.systemPrompt) {
        options.systemPrompt = { type: "preset" as const, preset: "claude_code" as const, append: `<session_info>\n当前会话 ID: ${resumeSessionId}\n</session_info>` };
      } else if (typeof options.systemPrompt === "object" && "append" in options.systemPrompt) {
        const sp = options.systemPrompt as { append?: string };
        sp.append = (sp.append || "") + `\n\n<session_info>\n当前会话 ID: ${resumeSessionId}\n</session_info>`;
      }
    }

    (async () => {
      try {
        const q = await getQuery();
        const queryObj = await q({ prompt: message, options });
        chat.query = queryObj;
        let capturedSid = resumeSessionId ?? "";
        for await (const msg of queryObj) {
          // Capture session_id from first message (SDK auto-generates for new sessions)
          const sdkSid = (msg as { session_id?: string }).session_id;
          if (!capturedSid && sdkSid) {
            capturedSid = sdkSid;
            chat.sessionId = sdkSid;
            broadcast("agent:chat-session", { chatId, sessionId: sdkSid });
          }
          const event = toStreamEvent(msg, chatId, "chat");
          if (event) broadcast("agent:stream", event);
          if (msg.type === "result") {
            broadcast("agent:exit", { runId: chatId, code: msg.subtype === "success" ? 0 : 1 });
          }
        }
      } catch (err: unknown) {
        if (this.activeChats.has(chatId)) {
          const msg = err instanceof Error ? err.message : String(err);
          broadcast("agent:stderr", { runId: chatId, data: msg, timestamp: Date.now() });
          broadcast("agent:exit", { runId: chatId, code: -1 });
        }
      }
      this.activeChats.delete(chatId);
    })();

    return { chatId };
  }

  stopChat(chatId: string): void {
    const chat = this.activeChats.get(chatId);
    if (chat?.query) {
      chat.query.interrupt().catch(() => {});
      this.activeChats.delete(chatId);
      broadcast("agent:exit", { runId: chatId, code: -1 });
    }
  }

  /** Check if a session has an active query running, return chatId if so */
  getActiveChatId(sessionId: string): string | null {
    for (const chat of this.activeChats.values()) {
      if (chat.sessionId === sessionId) return chat.chatId;
    }
    return null;
  }

  /** Interrupt all active queries — call on app quit or project switch */
  shutdown(): void {
    for (const [id, chat] of this.activeChats) {
      chat.query?.interrupt().catch(() => {});
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
function toStreamEvent(msg: SDKMessage, runId: string, source: "worker" | "chat"): {
  runId: string; type: string; data: Record<string, unknown>; timestamp: number; source: string;
} | null {
  const ts = Date.now();
  const t = msg.type;

  if (t === "assistant") {
    const content = (msg as { message?: { content?: unknown[] } }).message?.content;
    if (Array.isArray(content) && content.length > 0) {
      const block = content[0] as Record<string, unknown>;
      const blockType = typeof block.type === "string" ? block.type : "text";
      if (blockType === "text") {
        return { runId, type: "assistant", data: { text: block.text }, timestamp: ts, source };
      }
      if (blockType === "tool_use") {
        return { runId, type: "tool_use", data: { id: block.id, name: block.name, input: block.input }, timestamp: ts, source };
      }
      if (blockType === "thinking") {
        return { runId, type: "assistant", data: { delta: block.thinking }, timestamp: ts, source };
      }
    }
    return null;
  }

  if (t === "user") {
    const content = (msg as { message?: { content?: unknown[] } }).message?.content;
    if (Array.isArray(content) && content.length > 0) {
      const block = content[0] as Record<string, unknown>;
      if (block.type === "tool_result") {
        return { runId, type: "tool_result", data: { tool_use_id: block.tool_use_id, content: block.content, isError: !!block.is_error }, timestamp: ts, source };
      }
    }
    return null;
  }

  if (t === "result") {
    const rm = msg as { subtype: string; result?: string; is_error?: boolean; session_id?: string };
    return { runId, type: "system", data: { subtype: rm.subtype, result: rm.result ?? "", is_error: rm.is_error }, timestamp: ts, source };
  }

  if (t === "system") {
    const subtype = (msg as { subtype?: string }).subtype ?? "";
    // SDK status events — translate to Chinese for UI
    if (subtype === "status") {
      const status = (msg as { status?: string | null }).status;
      const text = status ? STATUS_LABELS[status] ?? status : null;
      if (text) return { runId, type: "status", data: { text }, timestamp: ts, source };
      return null;
    }
    // Filter out noisy SDK lifecycle events
    const skip = new Set(["init", "hook_started", "hook_response", "hook_progress", "memory_recall", "api_retry", "requesting", "compacting", "session_state_changed", "notification", "permission_denied", "files_persisted", "rate_limit"]);
    if (skip.has(subtype)) return null;
    return { runId, type: "system", data: { message: subtype || "System event" }, timestamp: ts, source };
  }

  return null;
}

// ── SDK status → Chinese labels ──
const STATUS_LABELS: Record<string, string> = {
  requesting: "正在思考...",
  compacting: "整理上下文中...",
  idle: "",
};
