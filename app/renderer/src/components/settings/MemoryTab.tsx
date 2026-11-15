import { useCallback, useEffect, useRef, useState } from "react";
import type { MemoryDocumentPreview, MemoryKind, MemoryPage, MemoryRecord, MemorySettings, MemoryState, MemorySummary, MemoryView } from "@shared/memory";
import { MEMORY_KINDS,MEMORY_TEXT_LIMIT,MEMORY_DETAILS_LIMIT,MEMORY_SUMMARY_LIMIT } from "@shared/memory";
import { Select } from "../Select";
import { Checkbox } from "../ui/Checkbox";
import { PromptEditorDialog } from "../PromptEditorDialog";
import { confirmDialog } from "../ui/ConfirmDialog";
import { toast } from "../ui/Toast";
import { appText, uiText, useUiLocale } from "../../lib/i18n";
import { formatDate } from "../../lib/locale-format";

const input="em-input w-full px-2.5 py-1.5 text-xs text-text-primary";
const button="px-3 py-1.5 text-xs rounded-[var(--radius-lg)] text-text-secondary hover:bg-surface-hover disabled:opacity-50";
const kindLabel=(kind:MemoryKind)=>uiText(`memory.kind.${kind}`);
export function MemoryTab({projectPath}:{projectPath?:string}):JSX.Element {
  useUiLocale();
  const loadVersion=useRef(0),readVersion=useRef(0);
  const [view,setView]=useState<MemoryView|null>(null),[error,setError]=useState("");
  const [query,setQuery]=useState(""),[scope,setScope]=useState(projectPath?"both":"global");
  const [state,setState]=useState<MemoryState|"all">("confirmed"),[life,setLife]=useState("current");
  const [page,setPage]=useState<MemoryPage>({items:[],total:0}),[offset,setOffset]=useState(0);
  const [matchedRevision,setMatchedRevision]=useState<number|undefined>();
  const [editing,setEditing]=useState<MemoryRecord|"new"|null>(null),[revisions,setRevisions]=useState<MemoryRecord[]>([]);
  const [saving,setSaving]=useState(false),[analyzing,setAnalyzing]=useState(false),[refresh,setRefresh]=useState(0);
  const [documentDirectory,setDocumentDirectory]=useState("");
  const [preview,setPreview]=useState<MemoryDocumentPreview|null>(null);
  const [digestOpen,setDigestOpen]=useState(false);
  const reload=useCallback(async()=>{
    const request=++loadVersion.current;
    try {const result=await window.electronAPI.memory.state(projectPath);if(request===loadVersion.current){setView(result);setError("");}}
    catch(cause){if(request===loadVersion.current)setError(appText(String(cause)));}
  },[projectPath]);
  useEffect(()=>{void reload();},[reload,refresh]);
  useEffect(()=>{setScope(view?.projectId?"both":"global");},[view?.projectId]);
  useEffect(()=>window.electronAPI.memory.onChanged?.(()=>setRefresh(n=>n+1)),[]);
  useEffect(()=>{setOffset(0);},[query,scope,state,life,projectPath]);
  const visible=Boolean(view?.settings.enabled || (view?.status.count ?? 0)>0);
  useEffect(()=>{
    if(!visible) return;
    let cancelled=false;
    const timer=setTimeout(()=>{
      void window.electronAPI.memory.query({projectPath,query,scope:scope as "both"|"global"|"project"|"recent",state,
        view:state==="confirmed"?(scope==="recent"?"all":life as "current"|"history"|"all"):"all",history:life!=="current" || scope==="recent" || state!=="confirmed",offset,limit:15})
        .then(result=>{if(!cancelled){setPage(result);setError("");}}).catch(cause=>{if(!cancelled)setError(appText(String(cause)));});
    },200);
    return ()=>{cancelled=true;clearTimeout(timer);};
  },[visible,projectPath,query,scope,state,life,offset,refresh]);
  const configure=async(patch:Partial<MemorySettings>)=>{
    setSaving(true);
    try {await window.electronAPI.memory.configure(patch);await reload();setRefresh(n=>n+1);}
    catch(cause){setError(appText(String(cause)));}
    finally {setSaving(false);}
  };
  const change=async(item:MemorySummary,patch:Parameters<typeof window.electronAPI.memory.update>[2])=>{
    setSaving(true);
    try {await window.electronAPI.memory.update(item.key,item.revision,patch,projectPath);setRefresh(n=>n+1);}
    catch(cause){setError(appText(String(cause)));}
    finally{setSaving(false);}
  };
  const open=async(item:MemorySummary)=>{
    const request=++readVersion.current;
    try {const result=await window.electronAPI.memory.read(item.key,projectPath);if(request===readVersion.current && result.item){setMatchedRevision(item.matchedRevision);setEditing(result.item);setRevisions(result.revisions);}}
    catch(cause){setError(appText(String(cause)));}
  };
  const forget=async(item:MemorySummary)=>{
    if(!await confirmDialog({title:uiText("memory.forget"),message:uiText("memory.forgetConfirm"),danger:true})) return;
    setSaving(true);
    try {await window.electronAPI.memory.forget(item.key,projectPath);setRefresh(n=>n+1);}
    catch(cause){setError(appText(String(cause)));}
    finally{setSaving(false);}
  };
  return <div className="space-y-4 text-xs">
    <div className="flex items-center justify-between gap-3">
      <div><p className="text-text-primary">{uiText("memory.enabled")}</p><p className="text-text-secondary mt-1">{uiText("memory.enabledHelp")}</p></div>
      <Checkbox checked={view?.settings.enabled??false} disabled={!view || saving} onChange={enabled=>void configure({enabled})} ariaLabel={uiText("memory.enabled")} />
    </div>
    <div className="flex items-center justify-between gap-3">
      <div><p className="text-text-primary">{uiText("memory.background")}</p><p className="text-text-secondary mt-1">{uiText("memory.backgroundHelp")}</p></div>
      <Checkbox checked={view?.settings.background??false} disabled={!view?.settings.enabled || saving} onChange={background=>void configure({background})} ariaLabel={uiText("memory.background")} />
    </div>
    {(error || view?.status.error) && <p role="alert" className="text-danger whitespace-pre-wrap break-words">{error || appText(view?.status.error)}</p>}
    {view && visible && <>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-text-secondary">{uiText("memory.dailyBudget")}
          <input className="em-input w-24 px-2 py-1 tabular-nums" inputMode="numeric" key={view.settings.dailyTokens} defaultValue={view.settings.dailyTokens}
            onBlur={event=>{const n=Number(event.target.value);if(!Number.isInteger(n)||n<1000||n>1_000_000){event.target.value=String(view.settings.dailyTokens);toast(uiText("memory.invalidBudget"));}else if(n!==view.settings.dailyTokens)void configure({dailyTokens:n});}} /></label>
        <span className="text-text-muted tabular-nums">{uiText("memory.usage",{used:view.status.usedTokens,pending:view.status.pending})}{view.status.failed?` · ${uiText("memory.failed",{count:view.status.failed})}`:""}</span>
        <button type="button" className={button} disabled={analyzing || !view.settings.enabled || !view.settings.background} onClick={()=>{
          setAnalyzing(true);void window.electronAPI.memory.analyze().then(()=>setRefresh(n=>n+1)).catch(cause=>setError(appText(String(cause)))).finally(()=>setAnalyzing(false));
        }}>{uiText(analyzing?"memory.analyzing":"memory.analyze")}</button>
      </div>
      {view.reports.some(r=>r.imported+r.unchanged+r.conflicts>0) && <p className="text-text-secondary">{uiText("memory.legacyPreserved")}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-text-secondary">{uiText("memory.summaryTitle")}</span>
        <button className={button} onClick={()=>setDigestOpen(true)}>{uiText("memory.viewSummary")}</button>
      </div>
      {view.digest?.error && <p className="text-danger">{appText(view.digest.error)}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${input} flex-1 min-w-32`} placeholder={uiText("memory.search")} value={query} onChange={event=>setQuery(event.target.value)} />
        <button className={`${button} text-accent`} onClick={()=>{readVersion.current++;setMatchedRevision(undefined);setEditing("new");setRevisions([]);}} disabled={saving}>{uiText("memory.add")}</button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Select borderless value={scope} onChange={setScope} options={[{value:"global",label:uiText("memory.global")},...(view?.projectId?[{value:"project",label:uiText("memory.project")},{value:"both",label:uiText("memory.both")}]:[]),{value:"recent",label:uiText("memory.recent")}]} />
        <Select borderless value={state} onChange={value=>setState(value as typeof state)} options={["confirmed","candidate","rejected","all"].map(value=>({value,label:uiText(`memory.state.${value}`)}))} />
        <Select borderless disabled={state!=="confirmed"} value={life} onChange={setLife} options={["current","history","all"].map(value=>({value,label:uiText(`memory.lifecycle.${value}`)}))} />
      </div>
      <div className="space-y-1">
        {page.items.map(item=><div key={item.key} className="rounded-[var(--radius-lg)] bg-surface-alt px-3 py-2.5">
          <button className="block w-full text-left" onClick={()=>void open(item)}>
            <span className="text-text-secondary">{kindLabel(item.kind)}{item.projectName?` · ${item.projectName}`:""} · {formatDate(item.occurredAt, {year:"numeric",month:"short",day:"numeric"})} · {uiText(item.lifecycle==="active"&&item.kind!=="activity"?"memory.lifecycle.current":"memory.lifecycle.history")}</span>
            {item.summary && <span className="ml-2 text-accent">{uiText("memory.inSummary")}</span>}
            {item.pendingAt && <span className="ml-2 text-text-secondary">{uiText("memory.scheduled")}</span>}
            {item.matchedRevision && <span className="ml-2 text-text-secondary">{uiText("memory.matchedRevision",{revision:item.matchedRevision})}</span>}
            {item.mergedInto && <span className="ml-2 text-text-secondary">{uiText("memory.merged")}</span>}
            <p className="text-text-primary mt-1 whitespace-pre-wrap break-words line-clamp-3">{item.text}</p>
          </button>
          <div className="flex flex-wrap items-center gap-1 mt-1">
            {item.state==="candidate" && <><button className={`${button} text-accent`} disabled={saving} onClick={()=>void change(item,{state:"confirmed",lifecycle:item.kind==="activity"?"archived":"active"})}>{uiText("memory.accept")}</button><button className={button} disabled={saving} onClick={()=>void change(item,{state:"rejected"})}>{uiText("memory.reject")}</button></>}
            {item.state==="confirmed" && item.lifecycle==="active" && <button className={button} disabled={saving} onClick={()=>void change(item,{lifecycle:"archived",summary:""})}>{uiText("memory.archive")}</button>}
            {item.kind!=="activity" && item.lifecycle!=="active" && <button className={button} disabled={saving} onClick={()=>void change(item,{lifecycle:"active",...(item.expiresAt!==undefined&&item.expiresAt<=Date.now()?{expiresAt:null}:{})})}>{uiText(item.mergedInto?"memory.restoreOriginal":"memory.restore")}</button>}
            <button className={`${button} text-danger`} disabled={saving} onClick={()=>void forget(item)}>{uiText("memory.forget")}</button>
          </div>
        </div>)}
        {!page.items.length && <p className="text-text-muted py-5 text-center">{uiText("memory.empty")}</p>}
      </div>
      <div className="flex items-center justify-end gap-2 text-text-secondary tabular-nums">
        <span>{uiText("memory.count",{count:page.total})}</span>
        <button className={button} disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-15))}>{uiText("memory.previous")}</button>
        <button className={button} disabled={page.next===undefined} onClick={()=>setOffset(page.next!)}>{uiText("memory.next")}</button>
      </div>
      {projectPath && view.projectId && <div className="space-y-2">
        <p className="text-text-primary">{uiText("memory.documents")}</p>
        <p className="text-text-secondary">{view.documents?uiText("memory.documentsManaged"):uiText("memory.documentsHelp")}</p>
        {view.documents?.error && <p className="text-danger whitespace-pre-wrap">{appText(view.documents.error)}</p>}
        {!view.documents && <input className={input} value={documentDirectory} onChange={event=>setDocumentDirectory(event.target.value)} placeholder={uiText("memory.directoryPlaceholder")} aria-label={uiText("memory.directory")} />}
        {!view.documents && <button className={button} onClick={()=>{void window.electronAPI.memory.previewDocuments(projectPath,documentDirectory.trim()||undefined).then(setPreview).catch(cause=>setError(appText(String(cause))));}}>{uiText("memory.previewDocuments")}</button>}
      </div>}
    </>}
    {digestOpen && <PromptEditorDialog title={uiText("memory.summaryTitle")} onClose={()=>setDigestOpen(false)} busy={saving}>
      <div className="settings-body flex flex-col flex-1 min-h-0 px-5 py-3 gap-2"><p className="text-xs text-text-secondary">{uiText("memory.summaryHelp")}</p><textarea readOnly className={`${input} flex-1 min-h-0 resize-none`} value={view?.digest?.content??""} aria-label={uiText("memory.summaryTitle")} /></div>
      <div className="flex justify-end gap-2 px-4 py-2 shrink-0"><button className={button} disabled={saving} onClick={()=>{setSaving(true);void window.electronAPI.memory.summary(true).then(digest=>{setView(value=>value?{...value,digest}:value);if(digest.error)toast(appText(digest.error));}).catch(cause=>toast(appText(String(cause)))).finally(()=>setSaving(false));}}>{uiText("memory.refreshSummary")}</button><button className={button} disabled={saving} onClick={()=>setDigestOpen(false)}>{uiText("common.close")}</button></div>
    </PromptEditorDialog>}
    {editing && <MemoryEditor key={editing==="new"?"new":`${editing.key}:${editing.revision}`} initial={editing} matchedRevision={matchedRevision} projectPath={view?.projectId?projectPath:undefined} revisions={revisions} onClose={()=>{readVersion.current++;setEditing(null);}} onSaved={()=>{setEditing(null);setRefresh(n=>n+1);}} />}
    {preview && <PromptEditorDialog title={uiText("memory.adoptTitle")} onClose={()=>setPreview(null)} busy={saving}>
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-3 text-xs text-text-secondary">
        <p>{uiText("memory.adoptHelp")}</p><p className="break-all">{preview.directory}</p>
        <p>{uiText("memory.adoptFiles",{count:preview.files.length})}</p>
        <ul className="space-y-1">{preview.files.map(file=><li key={file} className="break-all">{file}</li>)}</ul>
      </div>
      <div className="flex justify-end gap-2 px-4 py-2"><button className={button} disabled={saving} onClick={()=>setPreview(null)}>{uiText("common.cancel")}</button>
        <button className="btn-accent rounded-[var(--radius-lg)] px-4 py-1.5 text-xs" disabled={saving} onClick={()=>{
          setSaving(true);void window.electronAPI.memory.adoptDocuments(projectPath!,preview.directory,preview.hash).then(result=>{if(result.error)throw new Error(result.error);setPreview(null);setRefresh(n=>n+1);})
            .catch(cause=>toast(appText(String(cause)))).finally(()=>setSaving(false));
        }}>{uiText("memory.adopt")}</button></div>
    </PromptEditorDialog>}
  </div>;
}
function MemoryEditor({initial,matchedRevision,projectPath,revisions,onClose,onSaved}:{matchedRevision?:number;initial:MemoryRecord|"new";projectPath?:string;revisions:MemoryRecord[];onClose:()=>void;onSaved:()=>void}):JSX.Element {
  const item=initial==="new"?null:initial;
  const [text,setText]=useState(item?.text??""),[details,setDetails]=useState(item?.details??""),[kind,setKind]=useState<MemoryKind>(item?.kind??"preference");
  const [scope,setScope]=useState(item?.scope??(projectPath?"project":"global"));
  const initialSummary=item?.summary ?? (item?.pinned && item.scope==="global" && ["background","preference"].includes(item.kind) && item.text.length<=MEMORY_SUMMARY_LIMIT?item.text:"");
  const [summary,setSummary]=useState(initialSummary),[inSummary,setInSummary]=useState(Boolean(initialSummary)),[saving,setSaving]=useState(false),[showHistory,setShowHistory]=useState(Boolean(matchedRevision));
  const dateValue=(time?:number)=>{if(time===undefined)return "";const d=new Date(time),pad=(n:number)=>String(n).padStart(2,"0");return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;};
  const [expiry,setExpiry]=useState(dateValue(item?.expiresAt)),[effective,setEffective]=useState(dateValue(item?.effectiveAt));
  const parseDate=(value:string)=>{const v=value.trim();if(!v)return null;if(!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/u.test(v))return NaN;const time=new Date(v.replace(" ","T")).getTime();return Number.isFinite(time)&&dateValue(time)===v.replace("T"," ")?time:NaN;};
  const canSummarize=scope==="global"?["background","preference","attention"].includes(kind):kind==="activity";
  const save=async()=>{
    if(!text.trim() || (!item || text!==item.text) && text.length>MEMORY_TEXT_LIMIT || (!item || details!==item.details) && details.length>MEMORY_DETAILS_LIMIT)return;
    const expiresAt=parseDate(expiry),effectiveAt=parseDate(effective);
    if((expiresAt!==null&&!Number.isFinite(expiresAt)) || (effectiveAt!==null&&!Number.isFinite(effectiveAt))){toast(uiText("memory.invalidDate"));return;}
    setSaving(true);
    try {
      const selectedSummary=canSummarize&&inSummary?summary.trim():"";
      const result=item?await window.electronAPI.memory.update(item.key,item.revision,{...(text!==item.text?{text}:{}),...(details!==(item.details??"")?{details}:{}),...(kind!==item.kind?{kind}:{}),...(selectedSummary!==(item.summary??"")?{summary:selectedSummary}:{}),expiresAt,effectiveAt},projectPath):await window.electronAPI.memory.save({text,details,kind,scope,projectPath,summary:selectedSummary,expiresAt,effectiveAt});
      if(result?.warning)toast(appText(result.warning));else if(result?.pending)toast(uiText("memory.scheduledFor",{date:formatDate(result.pending.at,{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}));
      onSaved();
    }catch(cause){toast(appText(String(cause)));}finally{setSaving(false);}
  };
  return <PromptEditorDialog title={uiText(item?"memory.edit":"memory.add")} onClose={onClose} busy={saving}>
    <form noValidate className="flex flex-col flex-1 min-h-0" onSubmit={event=>{event.preventDefault();event.stopPropagation();void save();}}>
      <div className="settings-body flex flex-col flex-1 min-h-0 gap-3 px-5 py-3 overflow-y-auto">
        {item?.pending && <div className="shrink-0 rounded-[var(--radius-lg)] bg-surface-alt p-2 text-xs text-text-secondary"><p>{uiText("memory.scheduledFor",{date:formatDate(item.pending.at,{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})})}</p><p className="whitespace-pre-wrap mt-1">{item.pending.patch.text ?? item.pending.patch.details}</p><button type="button" className={button} disabled={saving} onClick={()=>{setSaving(true);void window.electronAPI.memory.update(item.key,item.revision,{cancelPending:true},projectPath).then(()=>onSaved()).catch(cause=>toast(appText(String(cause)))).finally(()=>setSaving(false));}}>{uiText("memory.cancelScheduled")}</button></div>}
        <div className="grid grid-cols-2 gap-3 shrink-0"><Select block borderless value={kind} onChange={value=>setKind(value as MemoryKind)} options={MEMORY_KINDS.map(value=>({value,label:kindLabel(value)}))} />
          <Select block borderless value={scope} disabled={Boolean(item)} onChange={value=>setScope(value as typeof scope)} options={[{value:"global",label:uiText("memory.global")},...(projectPath?[{value:"project",label:uiText("memory.project")}]:[])]} /></div>
        <label className="block shrink-0 text-xs text-text-secondary">{uiText("memory.text")}<textarea required className={`${input} h-24 mt-1 resize-none`} maxLength={MEMORY_TEXT_LIMIT} value={text} onChange={event=>{const next=event.target.value;if(summary===text)setSummary(next.length<=MEMORY_SUMMARY_LIMIT?next:"");setText(next);}} placeholder={uiText("memory.textPlaceholder")} /></label>
        <label className="flex flex-col flex-1 min-h-32 text-xs text-text-secondary">{uiText("memory.details")}<textarea className={`${input} mt-1 flex-1 min-h-0 resize-none`} maxLength={MEMORY_DETAILS_LIMIT} value={details} onChange={event=>setDetails(event.target.value)} placeholder={uiText("memory.detailsPlaceholder")} /></label>
        <div className="grid grid-cols-2 gap-3 shrink-0"><label className="text-xs text-text-secondary">{uiText("memory.effectiveAt")}<input className={`${input} mt-1`} value={effective} onChange={event=>setEffective(event.target.value)} placeholder="YYYY-MM-DD HH:mm" /></label><label className="text-xs text-text-secondary">{uiText("memory.expiresAt")}<input className={`${input} mt-1`} value={expiry} onChange={event=>setExpiry(event.target.value)} placeholder="YYYY-MM-DD HH:mm" /></label></div>
        {canSummarize && <div className="shrink-0 space-y-2"><label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer"><Checkbox checked={inSummary} onChange={next=>{setInSummary(next);if(next&&!summary&&text.length<=MEMORY_SUMMARY_LIMIT)setSummary(text);}} ariaLabel={uiText("memory.inSummary")} />{uiText("memory.inSummary")}</label>{inSummary&&<input className={input} value={summary} onChange={event=>setSummary(event.target.value)} maxLength={MEMORY_SUMMARY_LIMIT} placeholder={uiText("memory.summaryPlaceholder")} aria-label={uiText("memory.summaryLabel")} />}</div>}
        {item && <div className="shrink-0 text-xs"><button type="button" className={button} onClick={()=>setShowHistory(v=>!v)}>{uiText("memory.sourcesHistory")}</button>
          {showHistory && <div className="space-y-2 max-h-40 overflow-y-auto text-text-secondary">
            {item.reason && <p>{appText(item.reason)}</p>}
            {item.sources.map(source=><div key={source.ref} className="break-all"><p>{source.type} · {source.ref}{source.deleted?` · ${uiText("memory.sourceDeleted")}`:""}</p>{source.quote&&<p className="whitespace-pre-wrap">{source.quote}</p>}</div>)}
            {revisions.map(revision=><p key={revision.revision} className={`whitespace-pre-wrap ${revision.revision===matchedRevision?"bg-surface-alt rounded-[var(--radius-lg)] px-2 py-1":""}`}>r{revision.revision} · {formatDate(revision.updatedAt, {year:"numeric",month:"short",day:"numeric"})} · {revision.text}</p>)}
          </div>}
        </div>}
      </div>
      <div className="flex justify-end gap-2 px-4 py-2 shrink-0"><button type="button" className={button} disabled={saving} onClick={onClose}>{uiText("common.cancel")}</button><button type="submit" className="btn-accent rounded-[var(--radius-lg)] px-4 py-1.5 text-xs disabled:opacity-50" disabled={saving || !text.trim() || (canSummarize&&inSummary&&!summary.trim())}>{uiText("ui.AgentTemplateSettings.save")}</button></div>
    </form>
  </PromptEditorDialog>;
}
