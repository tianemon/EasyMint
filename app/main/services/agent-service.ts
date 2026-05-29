import { BrowserWindow } from "electron";
import type { SDKMessage, Options as QueryOptions } from "@anthropic-ai/claude-agent-sdk";
import { Store } from "./store";

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
function buildQueryOptions(projectPath: string, store: Store, overrides?: Partial<QueryOptions> & { thinkingEnabled?: boolean }): QueryOptions {
  const settings = store.getSettings();
  const env: Record<string, string> = {};
  if (settings.apiBaseUrl) env.ANTHROPIC_BASE_URL = settings.apiBaseUrl;
  if (settings.apiKey) env.ANTHROPIC_API_KEY = settings.apiKey;
  const thinking = overrides?.thinkingEnabled ? { type: "enabled" as const } : undefined;
  return {
    cwd: projectPath,
    permissionMode: "bypassPermissions",
    model: process.env.ANTHROPIC_MODEL || undefined,
    thinking,
    env: Object.keys(env).length > 0 ? env : undefined,
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
        const queryObj = await q({ prompt, options: buildQueryOptions(projectPath, this.store) });
        run.query = queryObj;
        for await (const msg of queryObj) {
          if (!this.activeRuns.has(runId)) break;

          const event = toStreamEvent(msg, runId, "worker");
          if (event) mainWindow.webContents.send("agent:stream", event);

          if (msg.type === "result") {
            const code = msg.subtype === "success" ? 0 : 1;
            mainWindow.webContents.send("agent:exit", { runId, code });
            this.activeRuns.delete(runId);
            if (code === 0 && this.onWorkerComplete) this.onWorkerComplete(projectPath);
          }
        }
      } catch (err: unknown) {
        if (this.activeRuns.has(runId)) {
          const msg = err instanceof Error ? err.message : String(err);
          mainWindow.webContents.send("agent:stderr", { runId, data: msg, timestamp: Date.now() });
          mainWindow.webContents.send("agent:exit", { runId, code: -1 });
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

  /** Send message — first call establishes session, subsequent calls use resume */
  sendMessage(projectPath: string, message: string, sessionId: string | null, thinkingEnabled: boolean, mainWindow: BrowserWindow): { chatId: string; sessionId: string } {
    const chatId = `chat-${++this.chatCounter}`;
    const overrides = { ...(sessionId ? { resume: sessionId } : {}), ...(thinkingEnabled ? { thinkingEnabled: true } : {}) };
    const options = buildQueryOptions(projectPath, this.store, overrides);

    const chat: ActiveChat = { chatId, sessionId: "", query: null, projectPath };
    this.activeChats.set(chatId, chat);

    (async () => {
      try {
        const q = await getQuery();
        const queryObj = await q({ prompt: message, options });
        chat.query = queryObj;
        let newSessionId = sessionId ?? "";
        for await (const msg of queryObj) {
          const event = toStreamEvent(msg, chatId, "chat");
          if (event) mainWindow.webContents.send("agent:stream", event);
          if (msg.type === "result") {
            newSessionId = (msg as { session_id?: string }).session_id ?? newSessionId;
            chat.sessionId = newSessionId;
            mainWindow.webContents.send("agent:exit", { runId: chatId, code: msg.subtype === "success" ? 0 : 1 });
          }
        }
      } catch (err: unknown) {
        if (this.activeChats.has(chatId)) {
          const msg = err instanceof Error ? err.message : String(err);
          mainWindow.webContents.send("agent:stderr", { runId: chatId, data: msg, timestamp: Date.now() });
          mainWindow.webContents.send("agent:exit", { runId: chatId, code: -1 });
        }
      }
      this.activeChats.delete(chatId);
    })();

    return { chatId, sessionId: "" };
  }

  stopChat(chatId: string): void {
    const chat = this.activeChats.get(chatId);
    if (chat?.query) {
      chat.query.interrupt().catch(() => {});
      this.activeChats.delete(chatId);
    }
  }
}

// ── Shared mutable reference for IPC window access ──
let _mainWindow: BrowserWindow | null = null;
export function setMainWindow(win?: BrowserWindow) { if (win) _mainWindow = win; }
function windowForChat(_chatId: string): BrowserWindow | null { return _mainWindow; }

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
    // Filter out noisy SDK lifecycle events
    const skip = new Set(["init", "hook_started", "hook_response", "hook_progress", "memory_recall", "api_retry", "status", "requesting", "compacting", "session_state_changed", "notification", "permission_denied", "files_persisted", "rate_limit"]);
    if (skip.has(subtype)) return null;
    return { runId, type: "system", data: { message: subtype || "System event" }, timestamp: ts, source };
  }

  return null;
}
