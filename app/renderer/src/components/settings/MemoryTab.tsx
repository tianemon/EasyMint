import {useCallback,useEffect,useRef,useState} from "react";
import type {MemoryDocument,MemorySettings,MemoryView} from "@shared/memory";
import {Toggle} from "../ui/Toggle";
import {appText,uiText,useUiLocale} from "../../lib/i18n";
export function MemoryTab():JSX.Element {
 useUiLocale();const [view,setView]=useState<MemoryView|null>(null),[document,setDocument]=useState<MemoryDocument|null>(null),[error,setError]=useState(""),[stateError,setStateError]=useState(""),[busy,setBusy]=useState(false),[configuring,setConfiguring]=useState(false),[documentError,setDocumentError]=useState("");
 const settings=view?.settings;
 const active=useRef(true),version=useRef(0),saving=useRef(false);
 const reload=useCallback(async()=>{
  const request=++version.current;
  const [stateResult,documentResult]=await Promise.allSettled([window.electronAPI.memory.state(),window.electronAPI.memory.readDocument()]);
  if(!active.current||request!==version.current)return;
  if(stateResult.status==="fulfilled"){setView(stateResult.value);setStateError("");}else setStateError(appText(stateResult.reason instanceof Error?stateResult.reason.message:String(stateResult.reason)));
  if(documentResult.status==="fulfilled"){setDocument(documentResult.value);setDocumentError("");}else setDocumentError(appText(documentResult.reason instanceof Error?documentResult.reason.message:String(documentResult.reason)));
 },[]);
 useEffect(()=>{active.current=true;void reload();const off=window.electronAPI.memory.onChanged(()=>{void reload();});return ()=>{active.current=false;version.current++;off();};},[reload]);
 const configure=async(patch:Partial<MemorySettings>)=>{if(saving.current)return;saving.current=true;setBusy(true);setConfiguring(true);setError("");try{const next=await window.electronAPI.memory.configure(patch);if(active.current){setView(previous=>({settings:next,status:previous?.status??{count:0,pending:0,usedTokens:0},ready:patch.enabled===true?false:previous?.ready}));await reload();}}catch(cause){if(active.current)setError(appText(cause instanceof Error?cause.message:String(cause)));}finally{saving.current=false;if(active.current){setBusy(false);setConfiguring(false);}}};
 return <div className="flex h-full min-h-0 flex-col gap-4 text-xs">
  <div className="flex items-center justify-between gap-3 shrink-0"><p className="text-text-primary">{uiText("memory.enabled")}</p><Toggle checked={settings?.enabled??false} disabled={!settings||busy} onChange={enabled=>void configure({enabled})} ariaLabel={uiText("memory.enabled")} /></div>
  <div className="flex items-center justify-between gap-3 shrink-0"><div><p className="text-text-primary">{uiText("memory.background")}</p><p className="mt-1 text-text-secondary">{uiText("memory.backgroundHelp")}</p></div><Toggle checked={settings?.background??false} disabled={!settings?.enabled||busy} onChange={background=>void configure({background})} ariaLabel={uiText("memory.background")} /></div>

  {!view&&!stateError&&<p role="status" className="text-text-secondary">{uiText("memory.loadingState")}</p>}
  {configuring&&<p role="status" className="text-text-secondary">{uiText("memory.savingSettings")}</p>}
  {settings?.enabled&&!stateError&&(view?.status.error
   ? <p role="alert" className="text-danger break-words whitespace-pre-wrap">{uiText(view.ready?"memory.backgroundIssue":"memory.unavailable")} {appText(view.status.error)}</p>
   : !view?.ready&&<p role="status" className="text-text-secondary">{uiText("memory.opening")}</p>)}
  {stateError&&<p role="alert" className="text-danger break-words whitespace-pre-wrap">{uiText("memory.stateFailed")} {stateError}</p>}
  {error&&<p role="alert" className="text-danger break-words whitespace-pre-wrap">{error}</p>}
  <label className="flex flex-col flex-1 min-h-40 gap-2"><span className="text-text-primary">MEMORY.md</span><textarea readOnly aria-label="MEMORY.md" aria-busy={!document&&!documentError} spellCheck={false} value={document?.content??""} className="em-input em-content-input flex-1 min-h-0 w-full resize-none px-3 py-2 text-text-primary" /></label>
  {documentError&&<p role="alert" className="text-danger break-words whitespace-pre-wrap shrink-0">{documentError}</p>}
 </div>;
}
