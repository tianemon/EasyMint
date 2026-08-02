/**
 * 上下文轮转（rotation）— 独立状态机
 *
 * 触发链：Pi 原生 compact 计数（compaction_end）达 MAX_COMPACT →
 * summarizing 状态 → 下一轮 prompt 结束后执行 finishRotation：
 * 归档旧会话 → 创建新会话 → handoff 接力。
 *
 * 从 agent-service.ts 拆出：逻辑独立、可测；依赖通过 RotationDeps 注入。
 */

import type { Model } from "@earendil-works/pi-ai";
import type { AgentSession, ToolDefinition } from "./pi-sdk";
import type { Store } from "./store";
import { createPiSession } from "./pi-session";
import { archiveSession } from "./session-service";
import { broadcast } from "./ipc-broadcast";
import type { ActiveChat, CanUseToolFn } from "./agent-service";

/** 单会话最大 compact 次数，超过则归档旧会话、开启新会话 */
export const MAX_COMPACT = 3;

/** 轮转状态字段（ActiveChat 合并此接口） */
export interface RotationState {
  /** 本会话已 compact 次数。超过 MAX_COMPACT 触发轮转归档 */
  compactCount: number;
  /** 上下文状态：normal | summarizing | rotated */
  contextStatus: "normal" | "summarizing" | "rotated";
  /** 轮转时积累的摘要文本（来自 Pi 原生 compact 的 result.summary） */
  summaryBuffer: string;
  /** 轮转后新会话的 handoff 信息 */
  rotationContinuation: string;
}

/** finishRotation 的外部依赖（由 agent-service 注入，避免循环依赖） */
export interface RotationDeps {
  store: Store;
  getModel: () => Promise<Model<any> | null>;
  getAgentDir: () => string;
  buildSystemPrompt: (projectPath: string, isDesigner?: boolean) => string;
  buildExtraTools: (projectPath: string, sessionId: string) => Promise<{ tools: ToolDefinition[]; canUseTool: CanUseToolFn }>;
  promptAndBridge: (session: AgentSession, sessionId: string, chatId: string, text: string, chat: ActiveChat) => Promise<void>;
}

/** 轮转：归档旧会话 → 创建新会话 → 注入摘要 → 继续 */
export async function finishRotation(
  chat: ActiveChat,
  oldSession: AgentSession,
  oldSessionId: string,
  deps: RotationDeps,
): Promise<void> {
  const summary = chat.summaryBuffer;
  if (!summary) {
    console.log("[agent] rotation: no summary, skipping");
    chat.contextStatus = "normal";
    chat.compactCount = 0;
    return;
  }

  // 轮转进度提示（归档+建新会话约 1-2s，避免用户误以为卡死）
  broadcast("agent:context-summarizing", { chatId: chat.chatId, type: "summarizing" });

  chat.contextStatus = "rotated";
  broadcast("agent:context-summary", { chatId: chat.chatId, summary });

  // 归档旧会话
  try {
    archiveSession(oldSessionId);
    console.log(`[agent] rotation: archived ${oldSessionId}`);
  } catch (e) {
    console.error("[agent] rotation: archive failed", e);
  }

  // 创建新 Pi 会话
  const model = await deps.getModel();
  if (!model) {
    broadcast("agent:stream", {
      type: "error", sessionId: oldSessionId, chatId: chat.chatId,
      message: "上下文轮转失败：未配置 AI 模型", canRetry: false,
    });
    return;
  }

  try {
    const continuation = chat.rotationContinuation || "继续推进项目";
    const handoffPrompt = `[系统消息] 这是从上一轮会话迁移过来的项目上下文。请从这个断点继续工作。

<previous_session_summary>
${summary}
</previous_session_summary>

请检查项目当前状态，然后用自然的语气对用户说一句话作为开场，告诉用户会话已整理完毕，接下来继续做什么。开场白以"${continuation}"结尾。`;

    const { tools: extraTools, canUseTool } = await deps.buildExtraTools(chat.projectPath, chat.sessionId);
    const newSession = await createPiSession({
      cwd: chat.projectPath,
      agentDir: deps.getAgentDir(),
      model,
      store: deps.store,
      systemPrompt: deps.buildSystemPrompt(chat.projectPath, chat.agentType === "designer"),
      extraTools,
      canUseTool,
    });

    // 更新 chat 引用
    oldSession.dispose();
    chat.session = newSession;
    chat.sessionId = newSession.sessionId;
    chat.compactCount = 0;
    chat.contextStatus = "normal";
    chat.summaryBuffer = "";
    chat.rotationContinuation = "";

    broadcast("agent:chat-session", { chatId: chat.chatId, sessionId: newSession.sessionId });
    broadcast("agent:context-rotated", { chatId: chat.chatId, sessionId: newSession.sessionId });

    // 在新会话中发送 handoff
    await deps.promptAndBridge(newSession, newSession.sessionId, chat.chatId, handoffPrompt, chat);
  } catch (e) {
    console.error("[agent] rotation: new session creation failed", e);
    // 失败时清除轮转提示，避免状态卡住
    broadcast("agent:context-summarizing", { chatId: chat.chatId, type: "done" });
    broadcast("agent:stream", {
      type: "error", sessionId: oldSessionId, chatId: chat.chatId,
      message: `上下文轮转失败: ${(e as Error).message}`, canRetry: false,
    });
  }
}
