import fs from "node:fs/promises";
import {constants} from "node:fs";
import path from "node:path";
import type {FileHandle} from "node:fs/promises";
import type {MemoryConclusion} from "../../../shared/memory";
import {hashText} from "./codec";
type Entry=Record<string,unknown> & {id:string;parentId?:string|null};
interface Position {offset:number;length:number;parentId?:string|null;type:string;targetId?:string}
interface FileIndex {identity:string;size:number;mtime:number;indexed:number;tailHash:string;version?:number;sessionId?:string;leaf?:string;entries:Map<string,Position>}
const indexes=new Map<string,FileIndex>();
const CHUNK=64*1024;
async function bytes(file:FileHandle,start:number,length:number):Promise<Buffer>{const buffer=Buffer.alloc(length);const read=await file.read(buffer,0,length,start);return buffer.subarray(0,read.bytesRead);}
async function indexFile(file:FileHandle,name:string):Promise<FileIndex>{
 const stat=await file.stat(),identity=`${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;let index=indexes.get(name);
 if(index && (index.identity!==identity || stat.size<index.size || stat.size===index.size && stat.mtimeMs!==index.mtime))index=undefined;
 if(index && stat.size>index.size && index.indexed){const tail=await bytes(file,Math.max(0,index.indexed-4096),Math.min(4096,index.indexed));if(hashText(tail.toString("base64"))!==index.tailHash)index=undefined;}
 index ??= {identity,size:0,mtime:0,indexed:0,tailHash:"",entries:new Map()};
 let start=index.indexed,offset=start,carry=Buffer.alloc(0);
 const add=(line:Buffer,length:number)=>{
  const text=line.toString("utf8").trim();if(!text){start+=length;return;}
  const raw=JSON.parse(text) as Entry;
  if(raw.type==="session"){if(raw.version!==3)throw new Error("来源会话版本不受支持，原始文件保留");if(typeof raw.id!=="string")throw new Error("来源日志缺少合法会话身份");index!.version=3;index!.sessionId=raw.id;start+=length;return;}
  if(index!.version!==3 || typeof raw.id!=="string")throw new Error("来源日志缺少合法会话身份");
  index!.entries.set(raw.id,{offset:start,length:line.length,parentId:raw.parentId,type:String(raw.type),...(typeof raw.targetId==="string"?{targetId:raw.targetId}:{})});index!.leaf=raw.id;start+=length;
 };
 while(offset<stat.size){const chunk=await bytes(file,offset,Math.min(CHUNK,stat.size-offset));if(!chunk.length)break;offset+=chunk.length;carry=Buffer.concat([carry,chunk]);let newline:number;
  while((newline=carry.indexOf(10))>=0){add(carry.subarray(0,newline),newline+1);carry=carry.subarray(newline+1);}
 }
 if(carry.length){try{add(carry,carry.length);carry=Buffer.alloc(0);}catch(error){if(!(error instanceof SyntaxError))throw error;}}
 index.indexed=start;index.size=stat.size;index.mtime=stat.mtimeMs;
 index.tailHash=hashText((await bytes(file,Math.max(0,start-4096),Math.min(4096,start))).toString("base64"));
 indexes.delete(name);indexes.set(name,index);while(indexes.size>8)indexes.delete(indexes.keys().next().value!);return index;
}

/** 仅搜索当前项目的权威会话树，包含嵌套子会话；旧绝对路径不能优先于当前分支。 */
export async function resolveSessionSource(root:string,sessionId:string):Promise<string|undefined> {
 const directory=await fs.lstat(root).catch((error:NodeJS.ErrnoException)=>{if(error.code==="ENOENT")return undefined;throw error;});
 if(!directory)return;if(!directory.isDirectory()||directory.isSymbolicLink())throw new Error("来源会话目录不是普通目录");
 const canonical=await fs.realpath(root);let found:string|undefined;
 const walk=async(dir:string):Promise<void>=>{
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
   const file=path.join(dir,entry.name);
   if(entry.isSymbolicLink())continue;
   if(entry.isDirectory()){await walk(file);continue;}
   if(!entry.isFile()||!entry.name.endsWith(".jsonl"))continue;
   const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW ?? 0));
   try{
    const actual=await fs.realpath(file),relative=path.relative(canonical,actual);if(relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error("来源会话越出当前项目目录");
    const opened=await handle.stat(),current=await fs.stat(actual);if(opened.dev!==current.dev||opened.ino!==current.ino)throw new Error("来源会话在定位期间已替换");
    let prefix=Buffer.alloc(0);while(prefix.length<CHUNK){const chunk=await bytes(handle,prefix.length,1024);if(!chunk.length)break;prefix=Buffer.concat([prefix,chunk]);if(prefix.includes(10))break;}
    const line=prefix.toString("utf8").split("\n",1)[0]!;
    let header:{type?:string;version?:number;id?:string};try{header=JSON.parse(line) as typeof header;}catch{continue;}
    if(header.type!=="session"||header.version!==3||header.id!==sessionId)continue;
    if(found)throw new Error("当前项目存在重复的来源会话身份，请先核对会话副本");found=file;
   }finally{await handle.close();}
  }
 };
 await walk(root);return found;
}
function textContent(content:unknown):unknown {
 return Array.isArray(content)?content.filter(value=>value?.type==="text" && typeof value.text==="string" || value?.type==="toolCall" && typeof value.id==="string").map(value=>value.type==="toolCall"?{type:"toolCall",id:value.id,name:value.name,arguments:value.arguments}:{type:"text",text:value.text}):typeof content==="string"?content:[];
}
async function verifySourceHandle(file:FileHandle,name:string,root:string):Promise<void> {
 if(!path.isAbsolute(root))throw new Error("来源会话缺少权威目录");
 // root 是定位前捕获的真实权威根；不能在此重新解析 root，否则会跟随已被替换的父目录。
 const actual=await fs.realpath(name),relative=path.relative(root,actual);
 if(relative===".."||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error("来源会话越出当前项目目录");
 const opened=await file.stat(),current=await fs.stat(actual);
 if(!opened.isFile()||!current.isFile()||opened.dev!==current.dev||opened.ino!==current.ino)throw new Error("来源会话在读取期间已替换");
}
/** Index append-only metadata once; subsequent reads scan new bytes and seek only the requested complete round. */
export async function readConclusionEntries(job:MemoryConclusion & {sourceRoot?:string},history=false):Promise<unknown[]> {
 const file=await fs.open(job.sessionFile,constants.O_RDONLY|(constants.O_NOFOLLOW ?? 0));
 try {
  if(job.sourceRoot)await verifySourceHandle(file,job.sessionFile,job.sourceRoot);
  const index=await indexFile(file,job.sessionFile);if(index.sessionId!==job.sessionId)throw new Error("来源会话身份不匹配");if(job.version!==undefined && index.version!==job.version)throw new Error("来源版本已变化");
  const userId=job.anchorRef?.startsWith(`user:${job.sessionId}:`)?job.anchorRef.slice(`user:${job.sessionId}:`.length):undefined;
  const targets=new Set([...(job.messageEntryIds ?? []),...(job.toolEntryIds ?? []),job.entryId,...(job.userEntryIds ?? []),...(userId?[userId]:[])]);
  const branch:string[]=[],seen=new Set<string>();let cursor=index.leaf;
  while(cursor && !seen.has(cursor)){seen.add(cursor);branch.push(cursor);cursor=index.entries.get(cursor)?.parentId ?? undefined;}
  if(!history && [...targets].some(target=>!seen.has(target)))return [];
  const selected=(history?[...index.entries.keys()]:branch.reverse()).filter(id=>{const row=index.entries.get(id)!;return targets.has(id) || !history && row.type==="context_edit" && Boolean(row.targetId && targets.has(row.targetId));});
  const entries:Entry[]=[];
  for(const id of selected){const row=index.entries.get(id)!;const raw=JSON.parse((await bytes(file,row.offset,row.length)).toString("utf8")) as Entry;
   let entry:Entry={id,parentId:entries.at(-1)?.id ?? null,timestamp:raw.timestamp,type:"custom",customType:"memory-source-index"};
   if(row.type==="message"){
    const message=raw.message as {role:string;content:unknown;timestamp?:number;stopReason?:string;isError?:boolean;toolName?:string;toolCallId?:string;details?:{memoryUserEvidence?:string;memoryUserAnswers?:Array<{question:string;answer:string}>}};
    entry={...entry,type:"message",message:{role:message.role,content:textContent(message.content),timestamp:message.timestamp,stopReason:message.stopReason,isError:message.isError,...(message.role==="toolResult"?{toolName:message.toolName,toolCallId:message.toolCallId,details:{memoryUserEvidence:message.details?.memoryUserEvidence,memoryUserAnswers:message.details?.memoryUserAnswers}}:{})}};
   }else if(row.type==="context_edit"){const replacement=raw.replacement as {content?:unknown}|null;entry={...entry,type:"context_edit",targetId:raw.targetId,replacement:replacement===null?null:{content:textContent(replacement?.content)}};}
   entries.push(entry);
  }if(job.sourceRoot)await verifySourceHandle(file,job.sessionFile,job.sourceRoot);return entries;
 }finally{await file.close();}
}
