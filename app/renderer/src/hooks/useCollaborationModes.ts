import { useCallback, useEffect, useRef, useState } from "react";
import { appMessage, uiText } from "../lib/i18n";
import { toast } from "../components/ui/Toast";

export function useCollaborationModes(sessionId: string, legacyDesigner?: boolean, options: {created?:boolean;blocked?:boolean} = {}) {
  const created=options.created ?? !sessionId.startsWith("__new_");
  const blocked=options.blocked ?? false;
  const [ids, setIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const editableRef = useRef(false);
  editableRef.current = !created && !blocked && !creatingRef.current;
  const current = useRef({ sessionId, ids: [] as string[] });
  const hydration = useRef<Promise<void>>(Promise.resolve());
  const pendingSave = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setSaving(false);
    setIds([]);
    creatingRef.current = false;setCreating(false);
    current.current = { sessionId, ids: [] };
    pendingSave.current = Promise.resolve();
    if (!window.electronAPI.conversation) { setReady(true); return; }
    hydration.current = window.electronAPI.conversation.getModes(sessionId, legacyDesigner,created).then(values => {
      if (cancelled) return;
      current.current = { sessionId, ids: values };
      setIds(values);
      setReady(true);
    });
    void hydration.current.catch(error => { if (!cancelled) toast(uiText("collaboration.failed", { detail: appMessage(error instanceof Error ? error.message : String(error)) })); });
    return () => { cancelled = true; };
  }, [sessionId, legacyDesigner,created]);

  const change = useCallback((values: string[]) => {
    if (!editableRef.current) { toast(uiText("collaboration.locked")); return Promise.resolve(); }
    setSaving(true);
    const operation = pendingSave.current.then(() => window.electronAPI.sessionCache.write(sessionId, { collaborationModeIds: values })).then(() => {
      if (current.current.sessionId !== sessionId) return;
      current.current.ids = values;
      setIds(values);
    }).catch(error => { toast(uiText("collaboration.failed", { detail: appMessage(error instanceof Error ? error.message : String(error)) })); })
      .finally(() => { if (current.current.sessionId === sessionId && pendingSave.current === operation) setSaving(false); });
    pendingSave.current = operation;
    return operation;
  }, [sessionId]);

  const getIds = useCallback(async () => {
    if(!created){creatingRef.current=true;editableRef.current=false;setCreating(true);}
    await hydration.current;
    await pendingSave.current;
    if (current.current.sessionId !== sessionId) throw new Error(uiText("collaboration.sessionChanged"));
    return current.current.ids;
  }, [sessionId,created]);
  const cancelCreation = useCallback(() => {
    if(current.current.sessionId!==sessionId || created)return;
    creatingRef.current=false;setCreating(false);
  },[sessionId,created]);
  const owned = current.current.sessionId === sessionId;
  const showPicker = !created && !blocked && !creating;
  return { ids: owned ? ids : [], change, getIds, cancelCreation, showPicker, editable: owned && showPicker, ready: owned && ready && !saving };
}
