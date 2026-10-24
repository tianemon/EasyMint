import { useRef, useCallback } from "react";
import { createFormAssistClient } from "../../lib/form-assist-client";
import { getWorkspaceDir } from "../../lib/getWorkspaceDir";
import type { SystemMessagePayload } from "../../../../shared/prompts";
import type { FormAssistKind } from "../../../../shared/form-assist";

/** Formal project sessions and tool-free form assistance use separate lifecycles. */
export function useMintChat(pathRef: React.RefObject<string | null>) {
  const clientRef = useRef<ReturnType<typeof createFormAssistClient> | null>(null);
  if (!clientRef.current) clientRef.current = createFormAssistClient(window.electronAPI.agent);

  const startSession = useCallback((prompt: string, systemPayload: SystemMessagePayload) =>
    window.electronAPI.agent.sendMessage(pathRef.current || getWorkspaceDir(), prompt, { sessionId: null, systemPayload }), [pathRef]);

  const askForm = useCallback((prompt: string, kind: FormAssistKind): Promise<string> =>
    clientRef.current!.ask(kind, prompt).catch(error => {
      console.warn("[form-assist] request failed:", error);
      return "";
    }), []);

  const disposeFormRequests = useCallback(() => { clientRef.current?.dispose(); }, []);
  return { startSession, askForm, disposeFormRequests };
}
