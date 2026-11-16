import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MemoryDigest, MemoryDocument, MemoryRecord } from "../../../shared/memory";
import { MemoryDatabase } from "./database";
import { hashText, memoryDay } from "./codec";

export interface SummaryProject { id:string;name:string;status?:string }
const clean=(value:string)=>value.replace(/[\r\n]+/gu," ").replaceAll("<!--","&lt;!--").replaceAll("-->","--&gt;");
export function digestText(item:MemoryRecord):string|undefined {
  if(item.state!=="confirmed" || item.lifecycle==="retired" || item.mergedInto || item.invalidatedAt || (item.expiresAt!==undefined && item.expiresAt<=Date.now()) || (item.effectiveAt!==undefined && item.effectiveAt>Date.now()))return;
  if(item.projectId && item.kind!=="activity")return;
  if(!item.projectId && (item.lifecycle!=="active" || !["background","preference","attention"].includes(item.kind)))return;
  const value=item.summary ?? (!item.projectId && item.pinned && ["preference","background"].includes(item.kind)?item.text:"");
  return value.trim() && value.length<=160?value.trim():undefined;
}
function render(db:MemoryDatabase,projects:SummaryProject[]):string {
  const selection=`state='confirmed' AND lifecycle!='retired' AND json_extract(json,'$.mergedInto') IS NULL AND json_extract(json,'$.invalidatedAt') IS NULL
    AND (json_extract(json,'$.expiresAt') IS NULL OR json_extract(json,'$.expiresAt')>${Date.now()})
    AND (json_extract(json,'$.effectiveAt') IS NULL OR json_extract(json,'$.effectiveAt')<=${Date.now()})
    AND ((json_type(json,'$.summary')='text' AND length(json_extract(json,'$.summary'))<=160 AND length(trim(json_extract(json,'$.summary')))>0) OR (project_id IS NULL AND json_extract(json,'$.summary') IS NULL AND json_extract(json,'$.pinned')=1 AND kind IN ('background','preference') AND length(json_extract(json,'$.text'))<=160 AND length(trim(json_extract(json,'$.text')))>0))`;
  const projectIds=projects.filter(project=>project.status!=="completed").map(project=>project.id);
  const rows=[...db.db.prepare(`SELECT json FROM memory WHERE ${selection} AND project_id IS NULL AND lifecycle='active' AND kind IN ('background','preference','attention') ORDER BY occurred_at DESC,key LIMIT 40`).all(),
    ...(projectIds.length?db.db.prepare(`SELECT json FROM (SELECT json,occurred_at,key,row_number() OVER(PARTITION BY project_id ORDER BY occurred_at DESC,key) pos FROM memory WHERE ${selection} AND project_id IN (${projectIds.map(()=>"?").join(",")}) AND kind='activity') WHERE pos=1 ORDER BY occurred_at DESC,key LIMIT 5`).all(...projectIds):[])];
  const items=rows.map(row=>JSON.parse((row as {json:string}).json) as MemoryRecord).filter(item=>digestText(item));
  const line=(item:MemoryRecord,label:string)=>`- ${clean(label)} <!-- memory:${item.key} r:${item.revision} -->`;
  const globals=items.filter(item=>!item.projectId),projectLines:string[]=[];
  const seen=new Set<string>();
  for(const item of items.filter(item=>item.projectId)) {
    const project=projects.find(p=>p.id===item.projectId);
    if(!project || project.status==="completed" || seen.has(project.id))continue;
    const reported=item.text.startsWith("助手报告，未经独立核实：")?"助手报告：":"";
    seen.add(project.id);projectLines.push(line(item,`${project.name}（记录于 ${memoryDay(new Date(item.occurredAt),item.sources[0]?.timezone)}）：${reported}${digestText(item)!}`));
    if(projectLines.length===5)break;
  }
  return `# 记忆摘要\n\n记录重要背景、关注方向和近期项目，由智能体持续维护。\n\n## 关于用户\n${globals.filter(i=>i.kind!=="attention").slice(0,4).map(i=>line(i,digestText(i)!)).join("\n") || "暂无已确认摘要。"}\n\n## 当前关注\n${globals.filter(i=>i.kind==="attention").slice(0,2).map(i=>line(i,`${digestText(i)!}（记录于 ${memoryDay(new Date(i.occurredAt),i.sources[0]?.timezone)}）`)).join("\n") || "暂无关注入口。"}\n\n## 近期项目\n${projectLines.join("\n") || "暂无项目入口。"}\n`;
}
function read(db:MemoryDatabase,file:string,content:string,projectId?:string):MemoryDigest {
  const items:MemoryDigest["items"]=[];
  const lines=content.split("\n").filter(line=>{
    const match=/<!-- memory:(\S+) r:(\d+) -->/u.exec(line);
    if(!match)return true;
    const project=/^project:([^/]+)\//u.exec(match[1]!);
    if(project && projectId && project[1]!==projectId)return false;
    const item=db.get(match[1]!,project?.[1]);
    if(!item || item.revision!==Number(match[2]) || !digestText(item))return false;
    items.push({key:item.key,revision:item.revision});return true;
  });
  const text=lines.join("\n");return {file,content:text,hash:hashText(text),items};
}
/** MEMORY.md is a document: seed it once, then let the agent maintain it. */
const MAX_DOCUMENT_BYTES=128*1024;
function snapshot(content:string):Record<string,string> {
 return Object.fromEntries(content.split("\n").flatMap(line=>{const key=/<!-- memory:(\S+) r:\d+ -->/u.exec(line)?.[1];return key?[[key,hashText(line)]]:[];}));
}
function current(db:MemoryDatabase,projects:SummaryProject[]) {const suggested=render(db,projects);return {suggested,entries:snapshot(suggested)};}
function replaceFile(file:string,content:string):void {
 if(Buffer.byteLength(content,"utf8")>MAX_DOCUMENT_BYTES)throw new Error("MEMORY.md is too large");
 const stat=fs.lstatSync(file,{throwIfNoEntry:false});
 if(stat && (!stat.isFile() || stat.isSymbolicLink()))throw new Error("MEMORY.md must be a regular file");
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const temporary=`${file}.${randomUUID()}.tmp`;let created=false;
 try {
  const fd=fs.openSync(temporary,"wx",0o600);created=true;
  try{fs.writeFileSync(fd,content);}finally{fs.closeSync(fd);}
  fs.renameSync(temporary,file);
 }finally{if(created && fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
function rawFile(file:string):string {
 if(!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())throw new Error("MEMORY.md must be a regular file");
 if(fs.statSync(file).size>MAX_DOCUMENT_BYTES)throw new Error("MEMORY.md is too large");
 return fs.readFileSync(file,"utf8");
}
export function writeSummary(db:MemoryDatabase,file:string,projects:SummaryProject[],_force=false):MemoryDigest {
 db.activateDue();const generated=current(db,projects);
 try {
  if(!fs.existsSync(file))replaceFile(file,generated.suggested);
  const content=rawFile(file);
  // An existing file is preserved on upgrade, including edits made outside EM.
  // No watcher, reverse-sync or extra document copy is introduced.
  let reviewed=db.metadata<Record<string,string>>("summaryReviewedEntries");
  if(!reviewed){reviewed=generated.entries;db.setMetadata("summaryReviewedEntries",reviewed);}
  const needsReview=JSON.stringify(reviewed)!==JSON.stringify(generated.entries);
  const result=read(db,file,content);
  db.setMetadata("summaryError",null);
  return {...result,needsReview,hash:hashText(JSON.stringify([result.content,needsReview?generated.entries:null]))};
 }catch(error){const message=(error as Error).message;db.setMetadata("summaryError",message);return {...read(db,file,generated.suggested),error:message};}
}
export function readSummaryDocument(db:MemoryDatabase,file:string,projects:SummaryProject[]):MemoryDocument {
 const digest=writeSummary(db,file,projects);if(digest.error)throw new Error(digest.error);
 const content=rawFile(file),generated=current(db,projects),reviewed=db.metadata<Record<string,string>>("summaryReviewedEntries") ?? {};
 const changes=generated.suggested.split("\n").filter(line=>{const key=/<!-- memory:(\S+) r:\d+ -->/u.exec(line)?.[1];return key && reviewed[key]!==generated.entries[key];}).join("\n");
 const boilerplate=new Set(generated.suggested.split("\n").filter(line=>!line.includes("<!-- memory:")));
 const protectedLines=content.split("\n").filter(line=>{if(!line.trim())return false;const key=/<!-- memory:(\S+) r:\d+ -->/u.exec(line)?.[1];return key?hashText(line)!==reviewed[key]:!boilerplate.has(line);});
 return {file,content,hash:hashText(content),reviewHash:hashText(JSON.stringify(generated.entries)),needsReview:digest.needsReview,changes,available:generated.suggested,protectedLines,removed:Object.keys(reviewed).filter(key=>!generated.entries[key])};
}
export function saveSummaryDocument(db:MemoryDatabase,file:string,projects:SummaryProject[],content:string,expectedHash:string,reviewHash?:string):MemoryDocument {
 const prior=readSummaryDocument(db,file,projects);
 if(prior.hash!==expectedHash)throw new Error("MEMORY.md changed. Reopen it before saving.");
 if(reviewHash!==undefined && prior.reviewHash!==reviewHash)throw new Error("记忆摘要变化已有更新，请重新读取changes后保存");
 replaceFile(file,content);if(reviewHash!==undefined)db.setMetadata("summaryReviewedEntries",current(db,projects).entries);
 return readSummaryDocument(db,file,projects);
}
export function readSummary(db:MemoryDatabase,file:string,projects:SummaryProject[],projectId?:string):MemoryDigest {
 const result=writeSummary(db,file,projects),filtered=read(db,file,result.content,projectId);
 return {...filtered,hash:hashText(JSON.stringify([filtered.content,result.hash])),needsReview:result.needsReview,...(result.error?{error:result.error}:{})};
}
