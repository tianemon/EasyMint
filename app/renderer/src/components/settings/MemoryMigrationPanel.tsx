import { useState } from "react";
import type {MemoryMigrationReport,MemoryView} from "@shared/memory";
import {appText,uiText,useUiLocale} from "../../lib/i18n";
import {toast} from "../ui/Toast";

const button="px-2.5 py-1 text-xs rounded-[var(--radius-lg)] text-text-secondary hover:bg-surface-hover disabled:opacity-50";
export function MemoryMigrationPanel({view,onRetry,onCandidates,onRepair,busy=false}:{view:MemoryView;onRetry:(projectId?:string)=>Promise<void>;onCandidates:(report:MemoryMigrationReport)=>void;onRepair:(report:MemoryMigrationReport)=>void;busy?:boolean}):JSX.Element|null {
 useUiLocale();
 const [expanded,setExpanded]=useState(false),[opening,setOpening]=useState(false);
 const phase=view.migration?.phase ?? "idle",running=phase==="opening"||phase==="migrating";
 const meaningful=view.reports.filter(report=>report.imported+report.unchanged+report.conflicts>0 || report.errors.length || report.missing.length || report.documentError || report.status==="failed");
 const issues=meaningful.filter(report=>report.status==="failed" || report.errors.length || report.missing.length || report.documentError);
 if(phase==="idle" && !view.ready && !meaningful.length)return null;
 const stateLabel=phase==="opening"?uiText("memory.migrationOpening"):phase==="migrating"?uiText("memory.migrationProgress",{done:view.migration?.completed ?? 0,total:view.migration?.total ?? 0,project:view.migration?.projectName ?? uiText("memory.global")}):phase==="error"?uiText("memory.migrationUnavailable"):issues.length?uiText("memory.migrationPartial",{count:issues.length}):uiText("memory.migrationReady");
 const retry=(projectId?:string)=>{void onRetry(projectId).catch(cause=>toast(appText(String(cause))));};
 return <section className="space-y-2 text-xs">
  <div className="flex items-center justify-between gap-2 flex-wrap">
   <span className="text-text-secondary">{uiText("memory.migrationTitle")}</span>
   <div className="flex items-center gap-1 flex-wrap">
    <button type="button" className={button} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{uiText(expanded?"memory.hideMigration":"memory.viewMigration")}</button>
    <button type="button" className={button} disabled={opening||!view.backupDirectory} onClick={()=>{setOpening(true);void window.electronAPI.memory.openBackups().catch(cause=>toast(appText(String(cause)))).finally(()=>setOpening(false));}}>{uiText("memory.openBackups")}</button>
    {(phase==="error"||issues.length>0) && <button type="button" className={`${button} text-accent`} disabled={busy||running} onClick={()=>retry()}>{uiText("memory.retryMigrations")}</button>}
   </div>
  </div>
  <p role="status" className={phase==="error"?"text-danger":"text-text-secondary"}>{stateLabel}</p>
  {(expanded||running||issues.length>0) && <div className="space-y-2">
   {meaningful.map(report=>{
    const status=report.status ?? (report.errors.length||report.missing.length||report.documentError?"attention":"complete");
    return <div key={report.projectId ?? "global"} className="rounded-[var(--radius-lg)] bg-surface-alt px-3 py-2 space-y-1">
     <div className="flex items-center justify-between gap-2 flex-wrap"><span className="text-text-primary break-words">{report.projectName ?? uiText("memory.global")}</span><span className={status==="failed"?"text-danger":"text-text-secondary"}>{uiText(`memory.migrationStatus.${status}`)}</span></div>
     <p className="text-text-secondary">{uiText("memory.migrationCounts",{imported:report.imported,unchanged:report.unchanged,conflicts:report.conflicts})}</p>
     {report.documentError && <p className="text-danger whitespace-pre-wrap break-all">{appText(report.documentError)}</p>}
     {report.errors.map((error,index)=><p key={`error-${index}`} className="text-danger whitespace-pre-wrap break-all">{appText(error)}</p>)}
     {report.missing.length>0 && <p className="text-text-secondary whitespace-pre-wrap break-all">{uiText("memory.migrationMissing",{count:report.missing.length})}{"\n"}{report.missing.join("\n")}</p>}
     <div className="flex gap-1 flex-wrap">
      {report.imported+report.unchanged+report.conflicts>0 && <button type="button" className={button} disabled={view.ready===false} onClick={()=>onCandidates(report)}>{uiText("memory.reviewImported")}</button>}
      {report.documentError && <button type="button" className={button} disabled={busy||running||!report.projectPath} onClick={()=>onRepair(report)}>{uiText("memory.previewRepair")}</button>}
      {status!=="complete" && <button type="button" className={button} disabled={busy||running} onClick={()=>retry(report.projectId ?? "global")}>{uiText("memory.retryMigrationSource")}</button>}
     </div>
    </div>;
   })}
   {!meaningful.length&&!running && <p className="text-text-muted">{uiText("memory.noLegacyFiles")}</p>}
   {view.backupDirectory && <p className="text-text-muted break-all">{uiText("memory.backupLocation",{path:view.backupDirectory})}</p>}
   <p className="text-text-secondary">{uiText("memory.recoveryHelp")}</p>
  </div>}
 </section>;
}
