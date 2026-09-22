/**
 * Pi 事件 → 前端 PiChatEvent 格式转换
 *
 * 核心思路：Pi SDK 的 session.getLastAssistantText() 维护累计全文，
 * message_update 触发时直接读取，不需要手动累加。
 */

import type { AgentSessionEvent, SessionEntry, SessionManager, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { compactionCardFields } from "../../shared/prompts";

export interface PiChatEvent {
  type: string;
  sessionId: string;
  chatId?: string;
  blocks?: ChatBlock[];
  partial?: boolean;
  toolCallId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  /** 工具执行中的增量输出文本(tool_execution_update 的 partialResult 提取;bash 实时输出) */
  deltaText?: string;
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
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number };
  /** 落盘条目 id(entry_appended 事件;前端给气泡回填 entryId 用) */
  entryId?: string;
  /** 条目消息角色(entry_appended 事件)——前端据此判断回填到 user 还是 ai 气泡 */
  entryRole?: PiEntryRole;
  /** 会话标题(session_info_changed 事件;name 为空时表示标题被清掉) */
  title?: string;
}

/** 条目的消息角色(AgentMessage.role 全集)——不对应气泡的角色由前端忽略 */
export type PiEntryRole = SessionMessageEntry["message"]["role"];

interface ChatBlock {
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
  /** Pi 归一化 usage（input 为未缓存输入；cacheRead/cacheWrite 缓存读/写——磁盘统计同源，见 getSessionStats） */
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}

/** 提取 assistant 消息的 usage（input/output/cacheRead/cacheWrite——命中率口径与 getSessionStats 一致） */
function extractUsage(msg: AssistantMessageLike): { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } | undefined {
  const u = msg.usage;
  if (!u) return undefined;
  return {
    inputTokens: u.input ?? 0,
    outputTokens: u.output ?? 0,
    cacheReadTokens: u.cacheRead ?? 0,
    cacheWriteTokens: u.cacheWrite ?? 0,
  };
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

/** 工具增量输出转纯文本(SDK 的 partialResult 是 AgentToolResult:content 为内容块数组) */
function extractPartialText(partialResult: unknown): string {
  const content = (partialResult as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is { type?: string; text?: string } => typeof b === "object" && b !== null)
    .map((b) => (b.type === "text" && b.text ? b.text : ""))
    .join("");
}

/**
 * 会话条目 → entry_appended 事件。
 *
 * 只处理能对到前端气泡的条目:user/assistant 的 message 条目带 message 对象,其 timestamp
 * 与流式帧(前端气泡的 piTs)同源,前端可按时间戳精确回填 entryId。其余一律返回 null 不转发——
 * toolResult 合并显示在 AI 气泡里(无自己的气泡)、状态变更/压缩/标签不对应气泡、
 * custom_message 条目只有 ISO 时间戳(与消息时间戳不同源,前端也匹配不上)。
 */
export function entryAppendedEvent(entry: SessionEntry): PiChatEvent | null {
  if (entry.type !== "message") return null;
  if (entry.message.role !== "user" && entry.message.role !== "assistant") return null;
  return {
    type: "entry_appended",
    sessionId: "",
    entryId: entry.id,
    entryRole: entry.message.role,
    timestamp: (entry.message as { timestamp?: number }).timestamp,
  };
}

/** message 条目的 entryId 回填器(见 createMessageEntryTracker 的说明) */
export interface MessageEntryTracker {
  /** 每个 SDK 事件都要过一遍:挂起 message_end 的消息、结算已落盘的挂起项 */
  observe(event: AgentSessionEvent): void;
  flush(): void;
}

/**
 * message 条目的 entryId 回填器。
 *
 * **SDK 不对 message 条目 emit `entry_appended`**——源码实证(agent-session.js):该事件只在
 * boundary draft / context_edit / 扩展 appendEntry / cache warmer 四处发出,普通消息落盘走的是
 * `message_end` 分支里的 `sessionManager.appendMessage(event.message)`,id 只存进私有的
 * `_entryIdsByMessage`,事件流里拿不到。
 *
 * 而落盘发生在 message_end 派发之后的同一段同步代码里(先 `_emit(event)`,再 appendMessage),
 * 所以这里把 message_end 的消息**按对象身份**挂起,在随后的事件或微任务里回查 sessionManager
 * 得到条目 id,再以 `entry_appended` 同形状事件推给前端。用对象身份而非时间戳,同毫秒多条目
 * 也不会错配(前端才需要按 role+timestamp 落到气泡上)。
 */
export function createMessageEntryTracker(opts: {
  getSession: () => { sessionManager: SessionManager } | null;
  emit: (event: PiChatEvent) => void;
}): MessageEntryTracker {
  const pending: unknown[] = [];
  let scheduled = false;

  const flush = (): void => {
    scheduled = false;
    if (pending.length === 0) return;
    const entries = opts.getSession()?.sessionManager.getEntries() ?? [];
    // 正序遍历:发出的顺序 = 消息落盘顺序(前端 user 气泡按发送队列 FIFO 配对,依赖这个顺序)
    for (let i = 0; i < pending.length; ) {
      const entry = entries.find((e) => e.type === "message" && e.message === pending[i]);
      // 还没落盘(SDK 的持久化在本事件的派发之后)→ 留着等下一个事件再查,不丢
      if (!entry) { i++; continue; }
      pending.splice(i, 1);
      const ev = entryAppendedEvent(entry);
      if (ev) opts.emit(ev);
    }
  };

  return {
    observe(event) {
      flush();
      if (event.type === "message_end") {
        pending.push(event.message);
        if (!scheduled) {
          scheduled = true;
          // 微任务:当前同步段(含落盘)结束后立刻结算,用户消息不必等到下一个流事件才有 id
          queueMicrotask(flush);
        }
        return;
      }
      // 回合结束仍查不到(appendMessage 是同步的,理论不可达)→ 丢弃并记日志,不留悬挂状态
      if (event.type === "agent_end" && pending.length > 0) {
        console.warn(`[event-bridge] entry_appended: ${pending.length} 条消息在会话文件里找不到条目,放弃回填`);
        pending.length = 0;
      }
    },
    flush,
  };
}

interface BridgeCallbacks {
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
          // 回合完整消息携带 usage——每条回复的 token/缓存统计（前端挂消息渲染）
          usage: extractUsage(msg),
        });
      }
      break;
    }

    case "agent_end": {
      // 错误回合不静默：SDK 错误(额度用完/429/529 等)生成空 content 的 error 消息，
      // message_end 无内容块不广播、前端静默无提示——agent_end 时检查最后一条
      // 消息的 stopReason=error，广播 error 事件让前端提示用户
      const endMsgs = (event as { messages?: Array<{ stopReason?: string; errorMessage?: string }> }).messages;
      const lastMsg = endMsgs && endMsgs.length > 0 ? endMsgs[endMsgs.length - 1] : undefined;
      if (lastMsg?.stopReason === "error") {
        callbacks.onEvent({
          type: "error", sessionId: "",
          message: lastMsg.errorMessage || "API 请求失败（可能额度用完或供应商不可用）",
          canRetry: true,
        });
      }
      callbacks.setPendingResult({ type: "turn_end", sessionId: "", usage: { inputTokens: 0, outputTokens: 0 } });
      break;
    }

    case "tool_execution_start": {
      // 工具开始执行 → 状态栏显示工具名
      callbacks.onEvent({ type: "tool_progress", sessionId: "", toolCallId: event.toolCallId, toolName: event.toolName, toolArgs: event.args });
      break;
    }

    case "tool_execution_update": {
      // 增量输出(如 bash 实时 stdout)——此前只转发工具名,partialResult 被丢弃
      callbacks.onEvent({
        type: "tool_progress",
        sessionId: "",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        toolArgs: event.args,
        deltaText: extractPartialText(event.partialResult),
      });
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
      // 区分成败:成功(有 result)→ compacted;失败(带 errorMessage)→ error 提示——
      // SDK 失败也发 compaction_end,若不区分前端会清蒙版显示"已整理完毕",失败伪装成成功
      if (!event.aborted && !event.errorMessage && event.result) {
        const summary = event.result.summary;
        callbacks.onEvent({
          type: "compacted", sessionId: "",
          summary,
          ...compactionCardFields(summary),
        });
      } else if (!event.aborted && event.errorMessage) {
        callbacks.onEvent({
          type: "error", sessionId: "",
          message: event.errorMessage || "上下文压缩失败，请稍后重试", canRetry: true,
        });
      }
      // aborted(中止):不广播——清蒙版由上层 context-summarizing done 兜底
      break;
    }

    case "entry_appended": {
      // SDK 自带条目事件(boundary draft / context_edit / 扩展 appendEntry 等)。
      // 注意:普通 message 条目 SDK 不发此事件(id 在私有 _entryIdsByMessage 里)——
      // 那部分由 createMessageEntryTracker 在落盘后补发,前端收到的形状与此一致
      const ev = entryAppendedEvent(event.entry);
      if (ev) callbacks.onEvent(ev);
      break;
    }

    case "session_info_changed": {
      // 会话改名回执：SDK 的 setSessionName 写 session_info 条目后 emit（agent-session.js 实证）。
      // 注意本事件只在会话有订阅者时才能到达前端——订阅随回合建立/拆除（见 promptAndBridge），
      // 因此它只管「回合进行中的改名」，空闲态改名由 renameSession 直接广播 agent:session-renamed 兜底。
      callbacks.onEvent({ type: "session_info_changed", sessionId: "", title: event.name });
      break;
    }

    case "auto_retry_start": {
      callbacks.onEvent({ type: "error", sessionId: "", message: event.errorMessage, canRetry: true });
      break;
    }
  }
}
