/**
 * Pi 事件 → 前端 PiChatEvent 格式转换
 *
 * 参考：Proma pi-agent-adapter.ts subscribe 回调 + pi-streaming-control.ts 50ms 合并
 */

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

// ── 前端事件格式 ─────────────────────────────────────

export interface PiChatEvent {
  type: string;
  sessionId: string;
  chatId?: string;
  // message 事件
  blocks?: ChatBlock[];
  partial?: boolean;
  // turn_end 事件
  usage?: ChatUsage;
  // tool_progress 事件
  toolCallId?: string;
  toolName?: string;
  // compacting/compacted
  summary?: string;
  // error
  message?: string;
  canRetry?: boolean;
}

export interface ChatBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: unknown;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

// ── 类型辅助 ─────────────────────────────────────────

interface AssistantMessageLike {
  role: "assistant";
  content: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  usage?: { inputTokens: number; outputTokens: number };
}

function isAssistantMessage(msg: unknown): msg is AssistantMessageLike {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return m.role === "assistant" && Array.isArray(m.content);
}

// ── Partial 合并 ─────────────────────────────────────

const COALESCE_INTERVAL_MS = 50;

interface CoalesceEntry {
  message: AssistantMessageLike;
  uuid: string;
}

/**
 * 50ms 合并器 — Pi 的 message_update 每秒可能触发数十次（每 token），
 * 每次都全文替换前端消息会造成大量无效渲染。收集 50ms 窗口内的更新，
 * 只发最后一帧。
 */
export function createPartialCoalescer(
  onFlush: (entry: { message: AssistantMessageLike; uuid: string }) => void,
  intervalMs: number = COALESCE_INTERVAL_MS,
) {
  let pending: CoalesceEntry | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule(entry: CoalesceEntry): void {
      pending = entry;
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        if (pending) {
          onFlush(pending);
          pending = null;
        }
      }, intervalMs);
    },
    flush(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (pending) {
        onFlush(pending);
        pending = null;
      }
    },
  };
}

// ── 消息转换 ─────────────────────────────────────────

interface ConvertOptions {
  final: boolean;
  uuid: string;
  model?: string;
}

export function convertPiAssistantMessage(
  msg: AssistantMessageLike,
  sessionId: string,
  opts: ConvertOptions,
): PiChatEvent | null {
  const blocks: ChatBlock[] = [];

  for (const block of msg.content) {
    if (block.type === "text") {
      blocks.push({ type: "text", text: block.text ?? "" });
    } else if (block.type === "tool_use") {
      blocks.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input,
      });
    }
  }

  if (blocks.length === 0) return null;

  return {
    type: "message",
    sessionId,
    blocks,
    partial: !opts.final,
  };
}

// ── 事件订阅桥接 ─────────────────────────────────────

export interface BridgeCallbacks {
  /** 发送事件到前端（通过 IPC）*/
  onEvent: (event: PiChatEvent) => void;
  /** 获取 assistant message 的 uuid */
  getAssistantUuid: () => string;
  /** 设置 agent_end 的 pending result */
  setPendingResult: (result: PiChatEvent) => void;
}

/**
 * 订阅 AgentSession 事件并转换为 PiChatEvent
 *
 * 返回 unsubscribe 函数
 */
export function bridgeSessionEvents(
  event: AgentSessionEvent,
  callbacks: BridgeCallbacks,
  state: {
    coalescer: ReturnType<typeof createPartialCoalescer>;
    lastPartialAssistant: AssistantMessageLike | null;
  },
): void {
  switch (event.type) {
    case "message_update": {
      if (!isAssistantMessage(event.message)) break;
      state.lastPartialAssistant = event.message;
      state.coalescer.schedule({
        message: event.message,
        uuid: callbacks.getAssistantUuid(),
      });
      break;
    }

    case "message_end": {
      state.coalescer.flush();
      const msg = event.message;
      if (!isAssistantMessage(msg)) break;

      const converted = convertPiAssistantMessage(msg, "", {
        final: true,
        uuid: callbacks.getAssistantUuid(),
      });
      if (converted) {
        converted.sessionId = ""; // 由 agent-service 填入
        callbacks.onEvent(converted);
      }
      state.lastPartialAssistant = null;
      break;
    }

    case "agent_end": {
      // Pi 的 AgentMessage 无 usage 字段 — 使用默认值
      const resultEvent: PiChatEvent = {
        type: "turn_end",
        sessionId: "", // 由 agent-service 填入
        usage: { inputTokens: 0, outputTokens: 0 },
      };
      callbacks.setPendingResult(resultEvent);
      break;
    }

    case "tool_execution_update": {
      callbacks.onEvent({
        type: "tool_progress",
        sessionId: "", // 由 agent-service 填入
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      });
      break;
    }

    case "compaction_start": {
      callbacks.onEvent({
        type: "compacting",
        sessionId: "", // 由 agent-service 填入
      });
      break;
    }

    case "compaction_end": {
      if (!event.aborted && event.result) {
        callbacks.onEvent({
          type: "compacted",
          sessionId: "", // 由 agent-service 填入
          summary: event.result.summary,
        });
      }
      break;
    }

    case "auto_retry_start": {
      callbacks.onEvent({
        type: "error",
        sessionId: "", // 由 agent-service 填入
        message: event.errorMessage,
        canRetry: true,
      });
      break;
    }
  }
}
