import {useCallback,useEffect,useRef,useState} from "react";
import type {MemoryDocument,MemorySettings} from "@shared/memory";
import {Toggle} from "../ui/Toggle";
import {PromptEditorDialog} from "../PromptEditorDialog";
import {confirmDialog} from "../ui/ConfirmDialog";
import {appText,uiText,useUiLocale} from "../../lib/i18n";
const button="px-3 py-1.5 text-xs rounded-[var(--radius-lg)] text-text-secondary hover:bg-surface-hover disabled:opacity-50";
export function MemoryTab():JSX.Element {
 useUiLocale();
 const [settings,setSettings]=useState<MemorySettings|null>(null),[error,setError]=useState(""),[configuring,setConfiguring]=useState(false);
 const [document,setDocument]=useState<MemoryDocument|null>(null),[draft,setDraft]=useState(""),[opening,setOpening]=useState(false),[saving,setSaving]=useState(false);
 const loaded=useRef(0),openingRef=useRef(false),savingRef=useRef(false),configuringRef=useRef(false),alive=useRef(true);
 const reload=useCallback(async()=>{const request=++loaded.current;try{const view=await window.electronAPI.memory.state();if(alive.current&&loaded.current===request){setSettings(view.settings);}}catch(cause){if(alive.current&&loaded.current===request)setError(appText(cause instanceof Error?cause.message:String(cause)));}},[]);
 useEffect(()=>{alive.current=true;void reload();const off=window.electronAPI.memory.onChanged(()=>{void reload();});return ()=>{alive.current=false;loaded.current++;off();};},[reload]);
 const configure=async(patch:Partial<MemorySettings>)=>{
  if(configuringRef.current)return;configuringRef.current=true;setConfiguring(true);setError("");
  try{const next=await window.electronAPI.memory.configure(patch);if(alive.current){setSettings(next);}}
  catch(cause){if(alive.current)setError(appText(cause instanceof Error?cause.message:String(cause)));}
  finally{configuringRef.current=false;if(alive.current)setConfiguring(false);}
 };
 const open=async()=>{
  if(openingRef.current)return;openingRef.current=true;setOpening(true);setError("");
  try{const value=await window.electronAPI.memory.readDocument();if(alive.current){setDocument(value);setDraft(value.content);}}
  catch(cause){if(alive.current)setError(appText(cause instanceof Error?cause.message:String(cause)));}
  finally{openingRef.current=false;if(alive.current)setOpening(false);}
 };
 const close=async()=>{
  if(savingRef.current)return;
  if(document && draft!==document.content && !await confirmDialog({title:uiText("memory.discardTitle"),message:uiText("memory.discardHelp"),confirmText:uiText("memory.discard")}))return;
  setDocument(null);
 };
 const save=async()=>{
  if(!document || savingRef.current)return;savingRef.current=true;setSaving(true);setError("");
  try{const value=await window.electronAPI.memory.saveDocument(draft,document.hash);if(alive.current){setDraft(value.content);setDocument(null);}}
  catch(cause){if(alive.current)setError(appText(cause instanceof Error?cause.message:String(cause)));}
  finally{savingRef.current=false;if(alive.current)setSaving(false);}
 };
 return <div className="space-y-4 text-xs">
  <div className="flex items-center justify-between gap-3"><div><p className="text-text-primary">{uiText("memory.enabled")}</p><p className="text-text-secondary mt-1">{uiText("memory.enabledHelp")}</p></div><Toggle checked={settings?.enabled??false} disabled={!settings||configuring} onChange={enabled=>void configure({enabled})} ariaLabel={uiText("memory.enabled")} /></div>
  <div className="flex items-center justify-between gap-3"><div><p className="text-text-primary">{uiText("memory.background")}</p><p className="text-text-secondary mt-1">{uiText("memory.backgroundHelp")}</p></div><Toggle checked={settings?.background??false} disabled={!settings?.enabled||configuring} onChange={background=>void configure({background})} ariaLabel={uiText("memory.background")} /></div>
  <div className="flex items-center justify-between gap-3"><div><p className="text-text-primary">MEMORY.md</p><p className="text-text-secondary mt-1">{uiText("memory.documentHelp")}</p></div><button type="button" className={button} disabled={opening} onClick={()=>void open()}>{uiText("memory.openDocument")}</button></div>
  {error && !document && <p role="alert" className="text-danger whitespace-pre-wrap break-words">{error}</p>}
  {document && <PromptEditorDialog title="MEMORY.md" onClose={()=>void close()} busy={saving}>
   <div className="settings-body flex flex-col flex-1 min-h-0 gap-2 px-5 py-3"><textarea className="em-input w-full flex-1 min-h-0 px-3 py-2 text-xs text-text-primary resize-none" aria-label="MEMORY.md" value={draft} onChange={event=>setDraft(event.target.value)} spellCheck={false} />{error&&<p role="alert" className="text-xs text-danger whitespace-pre-wrap break-words">{error}</p>}</div>
   <div className="flex justify-end gap-2 shrink-0 px-4 py-2"><button type="button" className={button} disabled={saving} onClick={()=>void close()}>{uiText("common.cancel")}</button><button type="button" className="btn-accent rounded-[var(--radius-lg)] px-4 py-1.5 text-xs disabled:opacity-50" disabled={saving||draft===document.content} onClick={()=>void save()}>{uiText("ui.AgentTemplateSettings.save")}</button></div>
  </PromptEditorDialog>}
 </div>;
}
