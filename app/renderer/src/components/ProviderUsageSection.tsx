import { useEffect, useState } from "react";
import { uiText, useUiLocale } from "../lib/i18n";
import { formatDate, formatNumber } from "../lib/locale-format";
import type { AccountUsageLabel, AccountUsageResult, AccountUsageRow } from "@shared/provider-usage";

type Failure = Extract<AccountUsageResult, {ok:false}>["reason"];
export function ProviderUsageSection({providerId,labels}:{providerId:string;labels:AccountUsageLabel[]}): JSX.Element {
  useUiLocale();
  const [rows,setRows]=useState<AccountUsageRow[]>();
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<Failure>();
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let cancelled=false,pending=false;
    const load=async(force=false)=>{
      if(pending)return;pending=true;setLoading(true);
      try {
        const result=await window.electronAPI.provider.usage(providerId,force);
        if(cancelled)return;
        if(result.ok && result.providerId===providerId){setRows(result.rows);setError(undefined);}
        else {
          const reason=result.ok ? "changed" : result.reason;
          if(reason==="changed" || reason==="auth")setRows(undefined);
          setError(reason);
        }
      }catch(cause){if(!cancelled){console.warn("[ProviderUsage] 账户查询失败",cause instanceof Error ? cause.name : "Error");setError("unavailable");}}
      finally{pending=false;if(!cancelled)setLoading(false);}
    };
    void load(attempt>0);
    const refresh=()=>{if(document.visibilityState==="visible")void load();};
    const timer=setInterval(refresh,60_000);
    window.addEventListener("focus",refresh);document.addEventListener("visibilitychange",refresh);
    return()=>{cancelled=true;clearInterval(timer);window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",refresh);};
  },[providerId,attempt]);
  const displayed:AccountUsageRow[]=rows??labels.map(label=>({id:label,label,unit:"usedPercent"}));
  return <div aria-busy={loading} className="space-y-3" data-provider-usage={providerId}>
    {displayed.map(row=><div key={row.id} data-usage-row={row.id} className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-sm text-text-primary">
        <span className="min-w-0 [overflow-wrap:anywhere]">{uiText(`ui.AccountUsage.${row.label}`)}{row.scope && <span className="ml-1 text-xs text-text-muted">{row.scope}</span>}</span>
        <span className="shrink-0 tabular-nums max-w-[60%] truncate" title={formatUsageValue(row)}>{formatUsageValue(row)}</span>
      </div>
      {row.resetAt && <div className="text-right text-[length:var(--text-2xs)] text-text-muted">{uiText("ui.AccountUsage.resetAt",{time:formatDate(new Date(row.resetAt),{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})})}</div>}
    </div>)}
    {error && <div role="status" className="flex items-center gap-2 text-[length:var(--text-2xs)] text-text-secondary">
      <span className="min-w-0 flex-1">{uiText(`ui.AccountUsage.error.${error}`)}</span>
      <button type="button" disabled={loading} className="shrink-0 text-text-primary em-hover-control rounded px-2 py-1" onClick={()=>setAttempt(value=>value+1)}>{uiText("ui.PlanUsage.retry")}</button>
    </div>}
  </div>;
}

function formatUsageValue(row:AccountUsageRow):string {
  if(row.unit==="unlimited")return uiText("ui.AccountUsage.unlimited");
  if(row.value===undefined)return "—";
  if(row.unit==="remainingCount")return uiText("ui.AccountUsage.remainingCount",{value:row.value});
  if(row.unit==="usedPercent" || row.unit==="remainingPercent") {
    const value=formatNumber(Number(row.value),{maximumFractionDigits:1});
    return uiText(row.unit==="usedPercent"?"ui.AccountUsage.usedPercent":"ui.AccountUsage.remainingPercent",{value});
  }
  return row.currency?`${row.currency} ${row.value}`:row.value;
}
