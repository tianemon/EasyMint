import {useEffect,useRef,useState} from "react";
import type {TrayCloseRequest} from "@shared/window-tray";
import {appText,uiText,useUiLocale} from "../lib/i18n";
import {Modal} from "./ui/Modal";
import {Checkbox} from "./ui/Checkbox";

export function CloseToTrayPrompt():JSX.Element|null {
  useUiLocale();
  const [request,setRequest]=useState<TrayCloseRequest|null>(null),[dontRemind,setDontRemind]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const platform = window.electronAPI?.platform;
  const isMac = platform === "darwin";
  const helpKey = isMac ? "tray.closeHelpMac" : platform === "win32" ? "tray.closeHelpWindows" : "tray.closeHelp";
  const active=useRef<TrayCloseRequest|null>(null),submitting=useRef(false);
  useEffect(()=>{
    const api=window.electronAPI?.win;
    if(!api?.onTrayPrompt)return;
    const off=api.onTrayPrompt(next=>{active.current=next;setRequest(next);setDontRemind(false);setError("");});
    void api.trayReady(true).catch(cause=>console.error("[tray] Prompt registration failed:",cause));
    return ()=>{active.current=null;off();void api.trayReady(false).catch(cause=>console.error("[tray] Prompt cleanup failed:",cause));};
  },[]);
  const respond=(hide:boolean)=>{
    if(!request || submitting.current)return;
    submitting.current=true;setBusy(true);setError("");
    void window.electronAPI.win.respondToTray({id:request.id,hide,dontRemind:hide&&dontRemind})
      .then(()=>{if(active.current?.id===request.id){active.current=null;setRequest(null);}})
      .catch(cause=>{if(active.current?.id===request.id)setError(appText(String(cause)));})
      .finally(()=>{submitting.current=false;setBusy(false);});
  };
  if(!request)return null;
  return <Modal tier="modal" overlayClassName="bg-black/40 backdrop-blur-sm" onClose={()=>{if(!submitting.current)respond(false);}}>
    <div role="dialog" aria-modal="true" aria-labelledby="tray-close-title" className="bg-[var(--modal-fill)] rounded-[var(--radius-lg)] p-5 max-w-md w-full shadow-2xl mx-4">
      <h2 id="tray-close-title" className="text-sm font-medium text-text-primary mb-1.5">{uiText(isMac ? "tray.closeTitleMac" : "tray.closeTitle")}</h2>
      <p className="text-xs text-text-secondary leading-relaxed">{uiText(helpKey)}</p>
      <div className="flex items-center gap-2 mt-4 text-xs text-text-secondary">
        <Checkbox checked={dontRemind} disabled={busy} onChange={setDontRemind} ariaLabel={uiText("tray.dontRemind")} />
        <span onClick={()=>{if(!busy)setDontRemind(value=>!value);}}>{uiText("tray.dontRemind")}</span>
      </div>
      {error && <p role="alert" className="text-xs text-danger break-words mt-2">{error}</p>}
      <div className="flex gap-2 justify-end mt-4">
        <button type="button" disabled={busy} className="px-4 py-1.5 text-xs rounded-[var(--radius-lg)] bg-surface-alt text-text-secondary hover:text-text-primary disabled:opacity-50" onClick={()=>respond(false)}>{uiText("common.cancel")}</button>
        <button type="button" disabled={busy} className="btn-accent px-4 py-1.5 text-xs rounded-[var(--radius-lg)] disabled:opacity-50" onClick={()=>respond(true)}>{uiText(isMac ? "tray.hideMac" : "tray.hide")}</button>
      </div>
    </div>
  </Modal>;
}
