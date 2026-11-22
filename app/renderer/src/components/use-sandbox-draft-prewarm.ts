import { useEffect, type MutableRefObject } from "react";
import { uiText } from "../lib/i18n";
import { useStatusStore } from "../stores/status-store";
import type { PermissionMode } from "./ChatInput";
import { WINDOWS_SANDBOX_ENABLED } from "../../../shared/windows-sandbox";

interface DraftOptions {
  active: boolean;
  projectPath?: string;
  tabId?: string;
  permissionMode: PermissionMode;
  existingSid?: string;
  sidRef: MutableRefObject<string>;
  permissionModeRef: MutableRefObject<PermissionMode>;
  pendingFirstTurnRef: MutableRefObject<boolean>;
  sessionHydrationRef: MutableRefObject<Promise<void>>;
  sandboxDraftTokenRef: MutableRefObject<string | null>;
  permissionChangePendingRef?: MutableRefObject<Promise<void> | null>;
}

/** Start only after saved permission mode is known; cleanup cannot cancel an adopted worker. */
export function useSandboxDraftPrewarm(options: DraftOptions): void {
  const { active, projectPath, tabId, permissionMode, existingSid, sidRef, permissionModeRef, pendingFirstTurnRef, sessionHydrationRef, sandboxDraftTokenRef, permissionChangePendingRef } = options;
  useEffect(() => {
    if (window.electronAPI.platform !== "win32" || !WINDOWS_SANDBOX_ENABLED || !active || !projectPath || !tabId || permissionMode !== "standard" || !window.electronAPI.agent.prepareSandboxDraft) return;
    let cancelled = false;
    const token = globalThis.crypto.randomUUID();
    const statusKey = `sandbox-prewarm:${token}`;
    const statusSid = sidRef.current;
    const offProgress = window.electronAPI.agent.onSandboxDraftProgress?.(data => {
      if (!cancelled && data.tabId === tabId && data.token === token && data.state === "stopping") {
        useStatusStore.getState().pushSignal(statusSid, statusKey, uiText("ui.ChatPanel.finishingSandbox"));
      }
    }) ?? (() => {});
    void (async () => {
      await sessionHydrationRef.current;
      const settings = await window.electronAPI.settings.get();
      const cache = existingSid ? await window.electronAPI.sessionCache.read(existingSid) : null;
      const raw = cache?.permissionMode ?? settings.chatPermissionMode ?? "standard";
      const saved = raw === "full" || raw === "bypassPermissions" ? "full"
        : raw === "readonly" || raw === "restricted" || raw === "sandbox" ? "readonly" : "standard";
      if (cancelled || pendingFirstTurnRef.current || permissionChangePendingRef?.current || saved !== "standard" || permissionModeRef.current !== "standard") return;
      sandboxDraftTokenRef.current = token;
      useStatusStore.getState().pushSignal(statusSid, statusKey, uiText("ui.ChatPanel.preparingSandbox"));
      const result = await window.electronAPI.agent.prepareSandboxDraft({ projectPath, tabId, token, sessionId: existingSid, mode: "standard" });
      if (!cancelled && result.state === "failed") {
        useStatusStore.getState().pushSignal(statusSid, "error", uiText("ui.ChatPanel.sandboxPreparationFailed", { v0: result.error ?? "" }), 8000);
      }
    })().catch(error => {
      if (!cancelled) {
        console.warn("[sandbox] 后台准备请求失败:", error);
        useStatusStore.getState().pushSignal(statusSid, "error", uiText("ui.ChatPanel.sandboxPreparationFailed", { v0: error instanceof Error ? error.message : String(error) }), 8000);
      }
    })
      .finally(() => useStatusStore.getState().popSignal(statusSid, statusKey));
    return () => {
      cancelled = true;
      offProgress();
      if (sandboxDraftTokenRef.current === token) sandboxDraftTokenRef.current = null;
      useStatusStore.getState().popSignal(statusSid, statusKey);
      void window.electronAPI.agent.cancelSandboxDraft(tabId, token).catch(error => console.warn("[sandbox] 停止后台准备失败:", error));
    };
  }, [active, projectPath, tabId, permissionMode, existingSid, sidRef, permissionModeRef, pendingFirstTurnRef, sessionHydrationRef, sandboxDraftTokenRef, permissionChangePendingRef]);
}
