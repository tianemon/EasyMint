import { useCallback, useEffect, useRef, useState } from "react";
import { appMessage, uiText } from "../lib/i18n";
import { toast } from "../components/ui/Toast";

export function useCollaborationModes(sessionId: string, legacyDesigner?: boolean) {
  const [ids, setIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const current = useRef({ sessionId, ids: [] as string[] });
  const hydration = useRef<Promise<void>>(Promise.resolve());
  const pendingSave = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setSaving(false);
    setIds([]);
    current.current = { sessionId, ids: [] };
    pendingSave.current = Promise.resolve();
    if (!window.electronAPI.conversation) { setReady(true); return; }
    hydration.current = window.electronAPI.conversation.getModes(sessionId, legacyDesigner).then(values => {
      if (cancelled) return;
      current.current = { sessionId, ids: values };
      setIds(values);
      setReady(true);
    });
    void hydration.current.catch(error => { if (!cancelled) toast(uiText("collaboration.failed", { detail: appMessage(error instanceof Error ? error.message : String(error)) })); });
    return () => { cancelled = true; };
  }, [sessionId, legacyDesigner]);

  const change = useCallback((values: string[]) => {
    setSaving(true);
    const operation = window.electronAPI.sessionCache.write(sessionId, { collaborationModeIds: values }).then(() => {
      if (current.current.sessionId !== sessionId) return;
      current.current.ids = values;
      setIds(values);
    }).catch(error => { toast(uiText("collaboration.failed", { detail: appMessage(error instanceof Error ? error.message : String(error)) })); })
      .finally(() => { if (current.current.sessionId === sessionId) setSaving(false); });
    pendingSave.current = operation;
    return operation;
  }, [sessionId]);

  const getIds = useCallback(async () => {
    await hydration.current;
    await pendingSave.current;
    if (current.current.sessionId !== sessionId) throw new Error(uiText("collaboration.sessionChanged"));
    return current.current.ids;
  }, [sessionId]);
  const owned = current.current.sessionId === sessionId;
  return { ids: owned ? ids : [], change, getIds, ready: owned && ready && !saving };
}
