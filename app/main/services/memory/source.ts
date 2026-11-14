import { hashText } from "./codec";
import { getSessionDataHelpers } from "../pi-sdk";
import type { MemoryConclusion } from "../../../shared/memory";

export interface EvidenceMessage { entryId:string; role:string; text:string; stopReason?:string; timestamp:number; hash:string }
export function messageText(content:unknown):string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((c:any)=>c?.type === "text" && typeof c.text === "string").map((c:any)=>c.text).join("\n");
}
/** Traverse the current append-only branch, including pre-compaction evidence, using SDK edit semantics. */
export async function evidenceMessages(entries:unknown[]):Promise<EvidenceMessage[]> {
  const byId=new Map(entries.map((e:any)=>[e.id,e]));
  const branch:any[]=[]; const seen=new Set<string>();
  let cursor=entries.at(-1) as any;
  while(cursor && !seen.has(cursor.id)) { seen.add(cursor.id); branch.push(cursor); cursor=byId.get(cursor.parentId); }
  branch.reverse();
  const helpers=await getSessionDataHelpers();
  // Evidence may predate compaction. Omit checkpoints and re-link a read-only projection;
  // SDK still owns all context-edit semantics. This is never used as model input wholesale.
  const evidenceBranch=branch.filter(e=>e.type!=="compaction" && e.type!=="branch_summary")
    .map((entry,index,all)=>({...entry,parentId:index ? all[index-1].id : null}));
  const projection=helpers.buildSessionProjection(evidenceBranch,evidenceBranch.at(-1)?.id);
  const result:EvidenceMessage[]=[];
  for (const projected of projection.entries) {
    const entry=projected.sourceEntry;
    if (entry.type!=="message") continue;
    for (const message of projected.messages) {
      const m=message as any;
      if(m.role==="toolResult" && m.toolName==="ask_user" && typeof m.details?.memoryUserEvidence==="string" && messageText(m.content)===m.details.memoryUserEvidence) {
        const text=`应用内问答选择：\n${m.details.memoryUserEvidence}`;
        const timestamp=typeof m.timestamp==="number"?m.timestamp:Date.parse(entry.timestamp);
        result.push({entryId:entry.id,role:"user",text,timestamp:Number.isFinite(timestamp)?timestamp:Date.now(),hash:hashText(JSON.stringify(["user",text]))});
        continue;
      }
      if (m.role!=="user" && m.role!=="assistant") continue;
      const text=messageText(m.content);
      const timestamp=typeof m.timestamp==="number" ? m.timestamp : Date.parse(entry.timestamp);
      result.push({entryId:entry.id,role:m.role,text,stopReason:m.stopReason,timestamp:Number.isFinite(timestamp)?timestamp:Date.now(),
        hash:hashText(JSON.stringify([m.role,text,m.stopReason]))});
    }
  }
  return result;
}
export function conclusionSnapshot(messages:EvidenceMessage[], entryId?:string):{assistant:EvidenceMessage;user?:EvidenceMessage;hash:string}|undefined {
  const index=entryId ? messages.findIndex(m=>m.entryId===entryId) : messages.length-1;
  const assistant=messages[index];
  if (!assistant || assistant.role!=="assistant" || assistant.stopReason!=="stop" || !assistant.text.trim()) return;
  const user=messages.slice(0,index).reverse().find(m=>m.role==="user");
  return {assistant,user,hash:hashText(JSON.stringify([assistant.hash,user?.hash]))};
}
export function bindConclusion(snapshot:NonNullable<ReturnType<typeof conclusionSnapshot>>, context:Omit<MemoryConclusion,"ref"|"entryId"|"timestamp"|"hash"|"anchorRef">):MemoryConclusion {
  return {...context,ref:`conclusion:${context.sessionId}:${snapshot.assistant.entryId}`,entryId:snapshot.assistant.entryId,timestamp:snapshot.assistant.timestamp,hash:snapshot.hash,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,...(snapshot.user?{anchorRef:`user:${context.sessionId}:${snapshot.user.entryId}`}:{})};
}
