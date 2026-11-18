import { hashText } from "./codec";
import {selectionConsent} from "./intent-clauses";
import { getSessionDataHelpers } from "../pi-sdk";
import type { MemoryConclusion } from "../../../shared/memory";

export interface MemoryUserAnswer {question:string;answer:string}
export interface EvidenceMessage { consentText?:string; entryId:string; role:string; text:string; stopReason?:string; toolName?:string;userEntryId?:string;messageEntryId?:string;isError?:boolean; timestamp:number; hash:string }
export function messageText(content:unknown):string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((c:any)=>c?.type === "text" && typeof c.text === "string").map((c:any)=>c.text).join("\n");
}
/** Traverse the current append-only branch, including pre-compaction evidence, using SDK edit semantics. */
export async function evidenceMessages(entries:unknown[],includeTools=false):Promise<EvidenceMessage[]> {
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
  let userEntryId:string|undefined;
  for (const projected of projection.entries) {
    const entry=projected.sourceEntry;
    if (entry.type!=="message") continue;
    for (const message of projected.messages) {
      const m=message as any;
      if(m.role==="user")userEntryId=entry.id;
      const observedAt=typeof m.timestamp==="number"?m.timestamp:Date.parse(entry.timestamp);
      if(includeTools && m.role==="assistant" && Array.isArray(m.content))for(const part of m.content)if(part?.type==="toolCall" && typeof part.id==="string"){
        let text:string|undefined,hash:string|undefined;
        result.push({entryId:`toolcall:${part.id}`,role:"call",get text(){return text ??= JSON.stringify([part.name,part.arguments]);},toolName:part.name,userEntryId,messageEntryId:entry.id,timestamp:Number.isFinite(observedAt)?observedAt:Date.now(),get hash(){return hash ??= hashText(this.text);}});
      }
      if(includeTools && m.role==="toolResult" && m.toolName!=="ask_user"){
        let text:string|undefined,hash:string|undefined;
        result.push({entryId:entry.id,role:"tool",toolName:m.toolName,userEntryId,isError:m.isError,get text(){return text ??= messageText(m.content);},timestamp:Number.isFinite(observedAt)?observedAt:Date.now(),get hash(){return hash ??= hashText(JSON.stringify(["tool",m.toolName,this.text,m.isError]));}});continue;
      }
      if(m.role==="toolResult" && m.toolName==="ask_user" && typeof m.details?.memoryUserEvidence==="string" && messageText(m.content)===m.details.memoryUserEvidence) {
        userEntryId=entry.id;
        const text=`应用内问答选择：\n${m.details.memoryUserEvidence}`;
        const timestamp=typeof m.timestamp==="number"?m.timestamp:Date.parse(entry.timestamp);
        result.push({entryId:entry.id,role:"user",toolName:"ask_user",text,consentText:selectionConsent(m.details.memoryUserAnswers),timestamp:Number.isFinite(timestamp)?timestamp:Date.now(),hash:hashText(JSON.stringify(["user",text]))});
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
export interface CompletedRound {assistant:EvidenceMessage;user?:EvidenceMessage;users:EvidenceMessage[];messages:EvidenceMessage[];tools:EvidenceMessage[];hash:string}
/** A round is complete text; tool evidence is separate and only a bounded chosen subset is sent. */
export function completedRounds(all:EvidenceMessage[]):CompletedRound[] {
 const messages=all.filter(message=>message.role==="user"||message.role==="assistant"),out:CompletedRound[]=[];let start=0,allStart=0;
 for(let index=0;index<messages.length;index++){
  const last=messages[index]!;if(last.role!=="assistant"||last.stopReason!=="stop")continue;
  const round=messages.slice(start,index+1),users=round.filter(message=>message.role==="user");start=index+1;
  const end=all.findIndex((message,i)=>i>=allStart&&message===last),tools=all.slice(allStart,end+1).filter(message=>message.role==="tool");allStart=end+1;
  const text=round.filter(message=>message.role==="assistant").map(message=>message.text).filter(Boolean).join("\n\n");if(!text.trim()||!users.length)continue;
  const user={...users.at(-1)!,text:users.map(message=>message.text).join("\n\n")};
  out.push({assistant:{...last,text},user,users,messages:round,tools,hash:hashText(JSON.stringify(round.map(message=>[message.entryId,message.role,message.hash])))});
 }return out;
}
export function conclusionSnapshot(messages:EvidenceMessage[],entryId?:string):ReturnType<typeof completedRounds>[number]|undefined {
 const rounds=completedRounds(messages);return entryId?rounds.find(round=>round.assistant.entryId===entryId):rounds.at(-1);
}
export function bindConclusion(snapshot:NonNullable<ReturnType<typeof conclusionSnapshot>>,context:Omit<MemoryConclusion,"ref"|"entryId"|"timestamp"|"hash"|"anchorRef">):MemoryConclusion {
 return {...context,ref:`conclusion:${context.sessionId}:${snapshot.assistant.entryId}`,entryId:snapshot.assistant.entryId,timestamp:snapshot.assistant.timestamp,hash:snapshot.hash,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
  toolEntryIds:snapshot.tools.filter(message=>["bash","powershell","read","edit","web_fetch"].includes(message.toolName ?? "")).slice(-2).map(message=>message.entryId),messageEntryIds:snapshot.messages.map(message=>message.entryId),userEntryIds:snapshot.users.map(message=>message.entryId),...(snapshot.user?{anchorRef:`user:${context.sessionId}:${snapshot.users[0]!.entryId}`}:{})};
}
