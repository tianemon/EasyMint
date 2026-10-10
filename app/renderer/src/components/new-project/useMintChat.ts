import { uiText } from "../../lib/i18n";
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
  const workspaceGenerationRef = useRef(0);
  const workspaceQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const WORKSPACE_DIR = getWorkspaceDir();

  const getCwd = useCallback(() => {
    return pathRef.current || WORKSPACE_DIR;
  }, [pathRef]);

  /** Send a prompt (or system message payload) and wait for the full response. Uses sidRef for session reuse. */
  const ask = useCallback((prompt: string, opts?: { forceNewSession?: boolean; systemPayload?: SystemMessagePayload }): Promise<string> => {
    const cwd = getCwd();
    const sessionId = opts?.forceNewSession ? null : sidRef.current;
    return postToAgent({ cwd, sessionId, systemPayload: opts?.systemPayload,
      onStarted: identity => { sidRef.current = identity.sessionId; },
    }, prompt)
      .then((r) => r.replyText)
      .catch(error => { console.warn("[ask] 请求失败（返回空串）:", error); return ""; });
  }, [pathRef]);

  /**
   * Workspace 旁路问答（名称翻译/功能推荐等）——首次调用创建会话，之后复用同一会话发消息。
   * 由调用方在流程结束（弹窗关闭/创建完成）时调 disposeWorkspaceSession 统一删除。
   *
   * 时序（dispose）：等待 killChat 确认回合已停止 →
   * deleteSession（删文件） → 刷新会话列表。killChat 必须在 delete 之前，否则 SDK 内部状态
   * 在 chat 销毁时重新写回元数据到磁盘。
   */
  const askWorkspace = useCallback((prompt: string, systemPayload?: SystemMessagePayload): Promise<string> => {
    const generation = workspaceGenerationRef.current;
    const work = workspaceQueueRef.current.then(async () => {
      if (generation !== workspaceGenerationRef.current) return "";
      const response = await postToAgent({ cwd: WORKSPACE_DIR, sessionId: workspaceSidRef.current, systemPayload,
        onStarted: identity => {
          if (generation !== workspaceGenerationRef.current) {
            void cleanupWorkspace(identity.chatId, identity.sessionId, WORKSPACE_DIR).catch(error => console.warn("[askWorkspace] 延后清理失败:", error));
            return;
          }
          const first = !workspaceSidRef.current;
          workspaceSidRef.current = identity.sessionId;
          workspaceChatIdRef.current = identity.chatId;
          if (first) void window.electronAPI.conv.rename(identity.sessionId, uiText("ui.useMintChat.projectSetup"), WORKSPACE_DIR).catch(error => console.warn("[askWorkspace] 命名失败:", error));
        },
      }, prompt);
      return generation === workspaceGenerationRef.current ? await response.replyText : "";
    })
      .catch((e: unknown) => {
        console.warn("[askWorkspace] 请求失败（返回空串，调用方按未翻译处理）:", e);
        return "";
      });
    workspaceQueueRef.current = work;
    return work;
  }, []);

  /** 清理流程级 workspace 旁路会话（弹窗卸载/创建完成后调用；无会话时为空操作） */
  const disposeWorkspaceSession = useCallback((): void => {
    const sid = workspaceSidRef.current;
    const chatId = workspaceChatIdRef.current;
    workspaceGenerationRef.current++;
    workspaceSidRef.current = null;
    workspaceChatIdRef.current = null;
    if (sid && chatId) {
      void cleanupWorkspace(chatId, sid, WORKSPACE_DIR).catch(error => console.warn("[askWorkspace] 清理失败，保留会话:", error));
    }
  }, []);

  return { ask, askWorkspace, disposeWorkspaceSession, sidRef };
}

async function cleanupWorkspace(chatId: string, sessionId: string, cwd: string): Promise<void> {
  await window.electronAPI.agent.killChat(chatId);
  await window.electronAPI.conv.delete(sessionId, cwd);
  await sessionListActions.refresh();
}
