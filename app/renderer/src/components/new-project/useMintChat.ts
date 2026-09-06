import { useRef, useCallback } from "react";
import { postToAgent } from "../../lib/agent-stream";
import { sessionListActions } from "../../stores/session-list-actions";
import { getWorkspaceDir } from "../../lib/getWorkspaceDir";
import type { SystemMessagePayload } from "../../../../shared/prompts";

/** AI 助手:项目会话问答 + 表单流程级共享的 workspace 旁路问答(名称翻译/功能推荐等轻量任务)
 *  旁路会话一次创建、流程内复用(翻译/推荐都发往同一会话),组件卸载时 dispose 统一清理——
 *  避免每次调用都建/删一个会话。模型不在此指定,一律按配置默认模型走。 */
export function useMintChat(pathRef: React.RefObject<string | null>) {
  const sidRef = useRef<string | null>(null);      // project session
  const workspaceSidRef = useRef<string | null>(null);   // workspace 旁路会话（流程级共享）
  const workspaceChatIdRef = useRef<string | null>(null);

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
   * Workspace 旁路问答（名称翻译/功能推荐等）——首次调用创建会话，之后复用同一会话发消息。
   * 由调用方在流程结束（弹窗关闭/创建完成）时调 disposeWorkspaceSession 统一删除。
   *
   * 时序（dispose）：killChat（关闭 channel + abort + flush） → 延迟确保 flush 完成 →
   * deleteSession（删文件） → 刷新会话列表。killChat 必须在 delete 之前，否则 SDK 内部状态
   * 在 chat 销毁时重新写回元数据到磁盘。
   */
  const askWorkspace = useCallback((prompt: string, systemPayload?: SystemMessagePayload): Promise<string> => {
    const unsubSession = window.electronAPI.agent.onChatSession(({ sessionId: sid }) => {
      if (sid) {
        const first = !workspaceSidRef.current;
        workspaceSidRef.current = sid;
        // 首次建会话时命名——表单停留期间临时会话在列表里可见，有名字避免「未命名」困惑
        if (first) window.electronAPI.conv.rename(sid, "项目创建中", WORKSPACE_DIR).catch(() => {});
      }
    });
    return postToAgent({ cwd: WORKSPACE_DIR, sessionId: workspaceSidRef.current, systemPayload }, prompt)
      .then(async (r) => {
        if (!workspaceChatIdRef.current) workspaceChatIdRef.current = r.chatId;
        return await r.replyText;
      })
      .catch(() => "")
      .finally(() => { unsubSession(); });
  }, []);

  /** 清理流程级 workspace 旁路会话（弹窗卸载/创建完成后调用；无会话时为空操作） */
  const disposeWorkspaceSession = useCallback((): void => {
    const sid = workspaceSidRef.current;
    const chatId = workspaceChatIdRef.current;
    workspaceSidRef.current = null;
    workspaceChatIdRef.current = null;
    if (sid && chatId) {
      window.electronAPI.agent.killChat(chatId).catch(() => {});
      setTimeout(() => {
        window.electronAPI.conv.delete(sid, WORKSPACE_DIR)
          .then(() => sessionListActions.refresh())
          .catch(() => {});
      }, 500);
    }
  }, []);

  return { ask, askWorkspace, disposeWorkspaceSession, sidRef };
}
