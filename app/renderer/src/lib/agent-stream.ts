/**
 * Agent 流式通信内核 —— 表单 ask 和聊天 sendText 共用的底层。
 *
 * 职责（仅限"发消息 + 收流过滤 + 提取本轮文本"）：
 *   1. 调 agent.sendMessage 发消息，拿 chatId
 *   2. 按 chatId 过滤 onStream 流，只收本次的流
 *   3. 从 result 事件提取本轮最终文本（result.result），不累加 assistant 事件
 *      —— 避免复用有历史的会话时，历史 assistant 被重放导致"返回所有历史回复"
 *   4. onExit(runId=chatId) 时 resolve 本轮文本
 *
 * 内核绝不做：
 *   - 不写 chat-store（消除双写：表单期不存消息，聊天期由 ChatPanel onStream 入 store）
 *   - 不碰 UI（setBusy/setStatusText/scroll 等由各自 UI 壳负责）
 *   - 不 normalizeEvent（展示层职责）
 */

export interface PostAgentOptions {
  cwd: string;
  /** null = 新会话；非空 = resume 已有会话 */
  sessionId: string | null;
  permissionMode?: string;
  model?: string;
}

export interface PostAgentResult {
  /** 本次会话的 chatId（runId），UI 壳用它过滤自己的 onStream */
  chatId: string;
  /** 本轮 result 事件返回的最终文本。form 模式 await 它拿回复；chat 模式可忽略 */
  replyText: Promise<string>;
}

/**
 * 发消息到 agent 并返回 chatId + 本轮回复文本 Promise。
 *
 * 注意：replyText 只在 result(subtype=success) 时取 result.result。
 * 若模型本轮只调工具没出文本结论，result.result 可能为空字符串。
 */
export function postToAgent(opts: PostAgentOptions, text: string): Promise<PostAgentResult> {
  return new Promise((resolve, reject) => {
    let chatId = "";
    let replyText = "";
    let unsubStream: (() => void) | null = null;
    let unsubExit: (() => void) | null = null;
    let settled = false;

    const teardown = () => {
      unsubStream?.();
      unsubExit?.();
      unsubStream = null;
      unsubExit = null;
    };

    unsubStream = window.electronAPI.agent.onStream((event: StreamEvent) => {
      if (event.source !== "chat") return;
      // 仅收本次 chat 的流（chatId 在 sendMessage 返回后赋值）
      if (chatId && (!event.runId || event.runId !== chatId)) return;
      // result 事件：本轮最终文本（subtype=success 时 toStreamEvent 转成 system 事件携带 result）
      if (event.type === "system" && event.data.subtype === "success") {
        const r = event.data.result;
        if (typeof r === "string") replyText = r;
      }
    });

    unsubExit = window.electronAPI.agent.onExit(({ runId }: { runId: string }) => {
      if (chatId && runId !== chatId) return;
      teardown();
      if (!settled) { settled = true; resolve({ chatId, replyText: Promise.resolve(replyText.trim()) }); }
    });

    window.electronAPI.agent
      .sendMessage(opts.cwd, text, {
        sessionId: opts.sessionId,
        permissionMode: opts.permissionMode,
        model: opts.model,
      })
      .then((result: { chatId: string }) => {
        chatId = result.chatId;
      })
      .catch((e: unknown) => {
        teardown();
        if (!settled) { settled = true; reject(e); }
      });
  });
}
