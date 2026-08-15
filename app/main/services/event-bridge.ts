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
  /** tool_result 内容(toolResult 消息转发) */
  content?: string;
  /** tool_result 是否错误 */
  isError?: boolean;
  /** user 消息落盘时间戳(毫秒,磁盘字段实证为 timestamp 而非 created_at) */
  timestamp?: number;
  /** custom 消息类型(custom_event 事件:system_message 等) */
  customType?: string;
  /** custom 消息元数据(custom_event 事件:kind 细分等,不进 LLM) */
  details?: Record<string, unknown>;
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
          callbacks.onEvent({
            type: "message_start", sessionId: "", blocks,
            // Pi 落盘时间戳——前端按此拆分/排序回合输出块(与磁盘逐条 assistant 对齐)
            timestamp: (msg as { timestamp?: number }).timestamp,
          });
        } else {
          // 空内容 → 纯信号，告知前端开始新 turn
          callbacks.onEvent({ type: "message_start", sessionId: "" });
        }
      } else {
        // custom 消息(系统消息,role: "custom" + customType: system_message)
        // → 转发 custom_event(结构身份,不依赖文本前缀);
        // 普通 user 消息不转发——用户自己发送的消息由前端 sendText append;
        // 工具结果(toolResult)转发为 tool_result 事件(前端按 toolCallId 关联到工具块显示)
        const role = (msg as { role?: string }).role;
        if (role === "toolResult") {
          callbacks.onEvent({
            type: "tool_result",
            sessionId: "",
            toolCallId: (msg as { toolCallId?: string }).toolCallId,
            toolName: (msg as { toolName?: string }).toolName,
            content: extractUserText(msg),
            isError: !!(msg as { isError?: boolean }).isError,
          });
        } else {
          const customType = (msg as { customType?: string }).customType;
          if (customType === "system_message") {
            callbacks.onEvent({
              type: "custom_event",
              sessionId: "",
              text: extractUserText(msg),
              // Pi 消息对象时间字段是 timestamp(毫秒)(磁盘 JSONL 实证)
              timestamp: (msg as { timestamp?: number }).timestamp,
              customType,
              details: (msg as { details?: Record<string, unknown> }).details,
            });
          }
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
        callbacks.onEvent({
          type: "message" as const, sessionId: "", blocks, partial: true,
          // Pi 落盘时间戳——前端按此拆分/排序回合输出块(与磁盘逐条 assistant 对齐)
          timestamp: (msg as { timestamp?: number }).timestamp,
        });
      }
      break;
    }

    case "message_end": {
      const msg = event.message;
      if (!isAssistantMessage(msg)) break;
      const blocks = messageToBlocks(msg);
      if (blocks.length > 0) {
        callbacks.onEvent({
          type: "message" as const, sessionId: "", blocks, partial: false,
          // Pi 落盘时间戳——前端按此拆分/排序回合输出块(与磁盘逐条 assistant 对齐)
          timestamp: (msg as { timestamp?: number }).timestamp,
        });
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
      // 无论成功/中止都广播——前端清除压缩蒙版(aborted/无 result 时不广播会导致蒙版卡死)
      callbacks.onEvent({
        type: "compacted", sessionId: "",
        summary: !event.aborted && event.result ? event.result.summary : undefined,
      });
      break;
    }

    case "auto_retry_start": {
      callbacks.onEvent({ type: "error", sessionId: "", message: event.errorMessage, canRetry: true });
      break;
    }
  }
}
