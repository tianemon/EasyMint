/**
 * Pi 事件 → 前端 PiChatEvent 格式转换
 *
 * 核心思路：Pi SDK 的 session.getLastAssistantText() 维护累计全文，
 * message_update 触发时直接读取，不需要手动累加。
 */

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export interface PiChatEvent {
  type: string;
  sessionId: string;
  chatId?: string;
  blocks?: ChatBlock[];
  partial?: boolean;
  toolCallId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  /** user 消息文本(user_message 事件) */
  text?: string;
  /** user 消息落盘时间(委派完成通知等,前端按时间戳有序插入) */
  timestamp?: number;
  message?: string;
  canRetry?: boolean;
  summary?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ChatBlock {
  type: "text" | "tool_use" | "tool_result" | "thinking";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: unknown;
}

interface AssistantMessageLike {
  role: "assistant";
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; arguments?: Record<string, unknown>; thinking?: string; content?: unknown }>;
}

function messageToBlocks(msg: AssistantMessageLike): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  for (const b of msg.content) {
    if (b.type === "text" && b.text) blocks.push({ type: "text" as const, text: b.text });
    // Pi 的 toolCall 块参数字段是 arguments（磁盘数据实证）；兼容 input 双格式
    else if (b.type === "toolCall") blocks.push({ type: "tool_use" as const, id: b.id, name: b.name, input: b.input ?? b.arguments });
    else if (b.type === "thinking") {
      const t = (b as any).thinking ?? "";
      if (t) blocks.push({ type: "thinking" as any, text: t });
    }
  }
  return blocks;
}

function isAssistantMessage(msg: unknown): msg is AssistantMessageLike {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return m.role === "assistant" && Array.isArray(m.content);
}

/** user 消息文本(系统注入的委派完成通知等) */
function extractUserText(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  const m = msg as { content?: unknown };
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .filter((b): b is { type?: string; text?: string } => typeof b === "object" && b !== null)
      .map((b) => (b.type === "text" && b.text ? b.text : ""))
      .join("");
  }
  return "";
}

export interface BridgeCallbacks {
  onEvent: (event: PiChatEvent) => void;
  getSession: () => { getLastAssistantText(): string | undefined } | null;
  setPendingResult: (result: PiChatEvent) => void;
}

export function bridgeSessionEvents(
  event: AgentSessionEvent,
  callbacks: BridgeCallbacks,
): void {
  switch (event.type) {
    case "turn_start": {
      // Pi 新一轮 assistant 回复开始 — 比 message_start 更可靠的分界信号
      callbacks.onEvent({ type: "turn_start", sessionId: "" });
      break;
    }

    case "message_start": {
      // Pi 新 assistant turn 开始的信号 — 告知前端创建新 AI 消息
      const msg = event.message;
      if (isAssistantMessage(msg)) {
        // 对于 done/error (无 streaming) 的情况，message_start 携带完整内容
        // 此时直接当 message 事件处理
        const blocks = messageToBlocks(msg);
        if (blocks.length > 0) {
          callbacks.onEvent({ type: "message_start", sessionId: "", blocks });
        } else {
          // 空内容 → 纯信号，告知前端开始新 turn
          callbacks.onEvent({ type: "message_start", sessionId: "" });
        }
      } else {
        // 仅转发系统注入的 user 消息([系统消息] 开头,如委派完成通知)——
        // 用户自己发送的消息由前端 sendText append,工具结果(toolResult)不渲染,
        // 转发它们会导致重复渲染 / 错误显示为 USER 气泡
        const text = extractUserText(msg);
        if (text.startsWith("[系统消息]")) {
          callbacks.onEvent({
            type: "user_message",
            sessionId: "",
            text,
            timestamp: (msg as { created_at?: number }).created_at,
          });
        }
      }
      break;
    }

    case "message_update": {
      // Pi 的 message_update 携带完整的累计 AssistantMessage
      // 直接取 event.message.content（全部内容块），不做增量逻辑
      const msg = event.message;
      if (!isAssistantMessage(msg)) break;
      const blocks = messageToBlocks(msg);
      if (blocks.length > 0) {
        callbacks.onEvent({ type: "message" as const, sessionId: "", blocks, partial: true });
      }
      break;
    }

    case "message_end": {
      const msg = event.message;
      if (!isAssistantMessage(msg)) break;
      const blocks = messageToBlocks(msg);
      if (blocks.length > 0) {
        callbacks.onEvent({ type: "message" as const, sessionId: "", blocks, partial: false });
      }
      break;
    }

    case "agent_end": {
      callbacks.setPendingResult({ type: "turn_end", sessionId: "", usage: { inputTokens: 0, outputTokens: 0 } });
      break;
    }

    case "tool_execution_start": {
      // 工具开始执行 → 状态栏显示工具名
      callbacks.onEvent({ type: "tool_progress", sessionId: "", toolCallId: event.toolCallId, toolName: event.toolName, toolArgs: event.args });
      break;
    }

    case "tool_execution_update": {
      callbacks.onEvent({ type: "tool_progress", sessionId: "", toolCallId: event.toolCallId, toolName: event.toolName, toolArgs: event.args });
      break;
    }

    case "tool_execution_end": {
      // 工具执行结束 → 通知前端清除状态栏工具名（否则残留「调用中」直到下个事件覆盖）
      callbacks.onEvent({ type: "tool_done", sessionId: "", toolCallId: event.toolCallId, toolName: event.toolName });
      break;
    }

    case "compaction_start": {
      callbacks.onEvent({ type: "compacting", sessionId: "" });
      break;
    }

    case "compaction_end": {
      if (!event.aborted && event.result) {
        callbacks.onEvent({ type: "compacted", sessionId: "", summary: event.result.summary });
      }
      break;
    }

    case "auto_retry_start": {
      callbacks.onEvent({ type: "error", sessionId: "", message: event.errorMessage, canRetry: true });
      break;
    }
  }
}
