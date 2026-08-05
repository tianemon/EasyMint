import { useRef, useCallback } from "react";
import { postToAgent } from "../../lib/agent-stream";
import { sessionListActions } from "../../stores/session-list-actions";
import { getWorkspaceDir } from "../../lib/getWorkspaceDir";
import type { SystemMessagePayload } from "../../../../shared/prompts";

/** AI 助手:项目会话问答 + 一次性 workspace 问答(用于名称翻译等轻量任务) */
export function useMintChat(pathRef: React.RefObject<string | null>) {
  const sidRef = useRef<string | null>(null);      // project session

  const WORKSPACE_DIR = getWorkspaceDir();

  const getCwd = useCallback(() => {
    return pathRef.current || WORKSPACE_DIR;
  }, [pathRef]);

  /** Send a prompt (or system message payload) and wait for the full response. Uses sidRef for session reuse. */
  const ask = useCallback((prompt: string, opts?: { forceNewSession?: boolean; systemPayload?: SystemMessagePayload }): Promise<string> => {
    const cwd = getCwd();
    const sessionId = opts?.forceNewSession ? null : sidRef.current;
    // 捕获本次会话的真实 sessionId（新会话首消息携带），更新 sidRef 供后续复用
    const unsubSession = window.electronAPI.agent.onChatSession(({ sessionId: sid }: { sessionId: string }) => {
      if (sid) sidRef.current = sid;
    });
    return postToAgent({ cwd, sessionId, systemPayload: opts?.systemPayload }, prompt)
      .then((r) => r.replyText)
      .catch(() => "")
      .finally(() => { unsubSession(); });
  }, [pathRef]);

  /**
   * One-shot workspace ask for lightweight tasks like name translation.
   * Always creates a fresh chat with a fast model, deletes the session after.
   *
   * 时序：等 onExit（SDK 正常完成） → killChat（关闭 chat，触发 SDK flush 并阻止后续写入）
   * → 延迟确保 flush 完成 → deleteSession（删文件） → 刷新会话列表。
   * killChat 必须在 delete 之前，否则 SDK 内部状态在 chat 销毁时重新写回元数据到磁盘。
   */
  const askWorkspace = useCallback((prompt: string, systemPayload?: SystemMessagePayload): Promise<string> => {
    let capturedSessionId = "";
    let capturedChatId = "";
    const unsubSession = window.electronAPI.agent.onChatSession(({ sessionId: sid }) => {
      if (sid) capturedSessionId = sid;
    });
    return postToAgent({ cwd: WORKSPACE_DIR, sessionId: null, model: "deepseek-v4-flash", systemPayload }, prompt)
      .then(async (r) => { capturedChatId = r.chatId; return await r.replyText; })
      .catch(() => "")
      .finally(() => {
        unsubSession();
        if (capturedSessionId && capturedChatId) {
          // ① 先 killChat——关闭 channel + abort + close query，触发 SDK flush
          window.electronAPI.agent.killChat(capturedChatId).catch(() => {});
          // ② 延迟后 delete——确保 flush 完成再删文件
          setTimeout(() => {
            window.electronAPI.conv.delete(capturedSessionId, WORKSPACE_DIR)
              .then(() => sessionListActions.refresh())
              .catch(() => {});
          }, 500);
        } else {
          console.warn("[askWorkspace] missing sessionId or chatId, skip delete");
        }
      });
  }, []);

  return { ask, askWorkspace, sidRef };
}
