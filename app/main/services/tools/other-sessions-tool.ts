import fs from "node:fs";
import os from "node:os";
import {randomUUID} from "node:crypto";
import {getDefineToolFn,type ToolDefinition} from "../pi-sdk";
import {emAgentDir} from "../../utils/paths";
import {discoverSessions,describeToolSessions,readSessionPage,sameProject,sessionProject,type ToolSessionHit} from "../memory/tool-sessions";
import {pathHitsAny,protectedCredentialPaths} from "../permission/access-policy";
interface AllowedSession {hit:ToolSessionHit;project:string;dev:number;ino:number}
/** Only descriptors returned by this tool instance can be read, never arbitrary paths. */
export async function createOtherSessionsTool(cwd:string,authorizeProject?:(projectPath:string)=>Promise<void>):Promise<ToolDefinition>{
 const define=await getDefineToolFn(true),allowed=new Map<string,AllowedSession>();
 return define({name:"other_sessions",label:"会话读取",executionMode:"parallel",
  description:"按需读取同项目的EM、Codex、Claude其他会话。先list取得sessionRef；只有用户问及会话内容时read，不能用任意文件路径。默认仅发现近期元信息，不读正文。结果分页，未读到不能编造。",
  promptGuidelines:["默认只list；用户问那边做了什么才read。","sessionRef来自本实例list；需要历史时用before翻页，正文用nextCursor继续向前，长消息用nextTextOffset和snapshotEnd继续，不全量搬入上下文。"],
  parameters:{type:"object",properties:{action:{type:"string",enum:["list","read"]},sessionRef:{type:"string"},projectPath:{type:"string"},days:{type:"number"},before:{type:"number",description:"list的截止时间毫秒；read的日志字节游标来自nextCursor"},offset:{type:"number"},textOffset:{type:"number"},snapshotEnd:{type:"number",description:"长消息翻页时固定为上次返回的snapshotEnd"}},required:["action"]},
  async execute(_id:string,params:Record<string,unknown>,signal?:AbortSignal):Promise<{content:Array<{type:"text";text:string}>;details:Record<string,unknown>}>{
   signal?.throwIfAborted();
   if(params.action==="list"){
    const project=typeof params.projectPath==="string"?params.projectPath:cwd;
    if(!sameProject(project,cwd)){if(!authorizeProject)throw new Error("请先明确指定其他已登记项目");await authorizeProject(project);}
    const now=typeof params.before==="number"&&Number.isFinite(params.before)?params.before:Date.now();
    const hits=discoverSessions(os.homedir(),project,{days:typeof params.days==="number"?params.days:14,now,agentDir:emAgentDir()}),offset=Math.max(0,Number(params.offset)||0);
    const sessions=hits.slice(offset,offset+10).flatMap(hit=>{
     const real=fs.realpathSync(hit.file),stat=fs.lstatSync(real);
     if(!stat.isFile()||pathHitsAny(real,protectedCredentialPaths(),cwd))return [];
     const ref=randomUUID();allowed.set(ref,{hit:{...hit,file:real},project,dev:stat.dev,ino:stat.ino});
     return [{sessionRef:ref,tool:hit.tool,at:new Date(hit.mtime).toISOString()}];
    });
    while(allowed.size>256)allowed.delete(allowed.keys().next().value!);
    const value={summary:describeToolSessions(hits),sessions,...(offset+10<hits.length?{nextOffset:offset+10}:{})};return {content:[{type:"text" as const,text:JSON.stringify(value)}],details:value};
   }
   if(params.action!=="read")throw new Error("未知会话读取操作");
   const source=allowed.get(String(params.sessionRef ?? ""));if(!source)throw new Error("sessionRef不存在或已过期，请先list");
   if(!sameProject(source.project,cwd)){if(!authorizeProject)throw new Error("跨项目范围已失效");await authorizeProject(source.project);}
   const real=fs.realpathSync(source.hit.file),stat=fs.lstatSync(source.hit.file);
   if(real!==source.hit.file||stat.isSymbolicLink()||!stat.isFile()||stat.dev!==source.dev||stat.ino!==source.ino||pathHitsAny(real,protectedCredentialPaths(),cwd))throw new Error("来源文件已变化或不允许读取，请重新list");
   const fd=fs.openSync(real,"r");
   try{
    const opened=fs.fstatSync(fd);if(opened.dev!==source.dev||opened.ino!==source.ino)throw new Error("会话文件在读取前已被替换");
    if(!sameProject(sessionProject(real,fd),source.project))throw new Error("会话所属项目已经变化，请重新list");
    const before=params.before ?? params.snapshotEnd;
    const end=typeof before==="number"&&Number.isFinite(before)?Math.max(0,Math.min(opened.size,Math.floor(before))):opened.size;
    // At most one MiB, sought from the end. The prefix may be a partial JSON line;
    // keep its offset for a subsequent page instead of loading an entire session.
    const start=Math.max(0,end-1024*1024),buffer=Buffer.alloc(end-start);const count=fs.readSync(fd,buffer,0,buffer.length,start);signal?.throwIfAborted();
    let raw=buffer.subarray(0,count).toString("utf8"),rawStart=start,nextCursor=start,skippedOversizedLine=false;
    if(start>0){const first=raw.indexOf("\n");const boundary=first<0?end:start+Buffer.byteLength(raw.slice(0,first+1),"utf8");nextCursor=boundary<end?boundary:start;skippedOversizedLine=boundary>=end;raw=first<0?"":raw.slice(first+1);rawStart=boundary; }
    const tail=readSessionPage(raw);if(tail)nextCursor=rawStart+tail.lineOffset;
    const offset=Math.max(0,Number(params.textOffset)||0);
    let content=tail?.text.slice(offset,offset+1200) ?? "";while(Buffer.byteLength(content,"utf8")/3>1300)content=content.slice(0,Math.floor(content.length*0.8));
    const value={tool:source.hit.tool,project:source.project,text:content,snapshotEnd:end,...(tail && offset+content.length<tail.text.length?{nextTextOffset:offset+content.length}:{}),...(nextCursor>0?{nextCursor}:{}),...(skippedOversizedLine?{skippedOversizedLine:true}:{}),...(!tail?{notice:"本段未找到完整助手结论，未读取更早内容"}:{})};
    return {content:[{type:"text" as const,text:JSON.stringify(value)}],details:value};
   }finally{fs.closeSync(fd);}
  },
 });
}
