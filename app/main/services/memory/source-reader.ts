import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { MemoryConclusion } from "../../../shared/memory";

type Entry=Record<string,any> & {id:string;parentId?:string|null};
function textContent(content:unknown):unknown {
  return Array.isArray(content)?content.filter(value=>value?.type==="text" && typeof value.text==="string").map(value=>({type:"text",text:value.text})):typeof content==="string"?content:[];
}
/** Decode the append-only envelope in the worker; SDK projection still owns message/edit semantics. */
export async function readConclusionEntries(job:MemoryConclusion,history=false):Promise<unknown[]> {
  const userId=job.anchorRef?.startsWith(`user:${job.sessionId}:`)?job.anchorRef.slice(`user:${job.sessionId}:`.length):undefined;
  const targets=new Set([job.entryId,...(userId?[userId]:[])]),entries=new Map<string,Entry>();
  const stream=createReadStream(job.sessionFile,{encoding:"utf8"}),lines=createInterface({input:stream,crlfDelay:Infinity});
  let leaf:string|undefined,header=false,count=0;
  try {
    for await(const line of lines) {
      if(!line.trim())continue;
      let raw:Entry;
      try {raw=JSON.parse(line.trim()) as Entry;}catch {throw new Error("来源日志尚未完整或已损坏，未分析原文");}
      if(raw.type==="session") {
        if(raw.version!==3 || (job.version!==undefined && raw.version!==job.version))throw new Error("来源日志版本不受当前记忆读取器支持，原文保留");
        header=true;continue;
      }
      if(!header || typeof raw.id!=="string")throw new Error("来源日志缺少可定位的条目身份");
      let entry:Entry={id:raw.id,parentId:raw.parentId,timestamp:raw.timestamp,type:"custom",customType:"memory-source-index"};
      if(raw.type==="message" && targets.has(raw.id)) {
        const message=raw.message;
        if(!message || typeof message.role!=="string")throw new Error("目标来源消息无效");
        entry={...entry,type:"message",message:{role:message.role,content:textContent(message.content),timestamp:message.timestamp,stopReason:message.stopReason,
          ...(message.role==="toolResult"?{toolName:message.toolName,toolCallId:message.toolCallId,details:{memoryUserEvidence:message.details?.memoryUserEvidence}}:{})}};
      } else if(raw.type==="context_edit" && targets.has(raw.targetId)) {
        entry={...entry,type:"context_edit",targetId:raw.targetId,replacement:raw.replacement===null?null:{content:textContent(raw.replacement?.content)}};
      }
      entries.set(entry.id,entry);leaf=entry.id;
      if(++count%500===0)await new Promise<void>(resolve=>setImmediate(resolve));
    }
  } finally {lines.close();stream.destroy();}
  const branch:Entry[]=[],seen=new Set<string>();
  let cursor=leaf?entries.get(leaf):undefined;
  while(cursor && !seen.has(cursor.id)){seen.add(cursor.id);branch.push(cursor);cursor=cursor.parentId?entries.get(cursor.parentId):undefined;}
  if(history)return [...entries.values()].filter(entry=>targets.has(entry.id)).map((entry,index,all)=>({...entry,parentId:index?all[index-1]!.id:null}));
  if(!seen.has(job.entryId) || (userId && !seen.has(userId)))return [];
  const selected=branch.reverse().filter(entry=>targets.has(entry.id)||entry.type==="context_edit");
  return selected.map((entry,index)=>({...entry,parentId:index?selected[index-1]!.id:null}));
}
