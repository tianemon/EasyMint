import { ipcMain,shell } from "electron";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { MemoryService } from "./service";
import { MEMORY_KINDS, MEMORY_TEXT_LIMIT, MEMORY_DETAILS_LIMIT, MEMORY_SUMMARY_LIMIT } from "../../../shared/memory";
import { readCache,writeCache } from "../session-cache";
import { withSessionCreationLock } from "../session-permission-gate";
import { broadcast } from "../ipc-broadcast";
import { isSafeSessionId } from "../../../shared/session-id";

const writeShape={kind:z.enum(MEMORY_KINDS),text:z.string().trim().min(1).max(MEMORY_TEXT_LIMIT),details:z.string().max(MEMORY_DETAILS_LIMIT).optional(),
  tags:z.array(z.string().max(100)).max(20).optional(),occurredAt:z.number().finite().optional(),expiresAt:z.number().finite().nullable().optional(),effectiveAt:z.number().finite().nullable().optional(),summary:z.string().max(MEMORY_SUMMARY_LIMIT).optional(),importance:z.enum(["normal","high"]).optional()};
export function registerMemoryIpc(service:MemoryService):void {
  const projectFor=(projectPath?:string)=>{
    if(!projectPath) return undefined;
    const project=service.project(projectPath);
    if(!project) throw new Error("当前项目未登记，无法操作其项目记忆");
    return project;
  };
  const management=async()=>{const db=await service.management(true);if(!db)throw new Error("记忆服务不可用");return db;};
  const exportHuman=async()=>{
    const digest=await service.summary();return digest.error || undefined;
  };
  const scopeForKey=(key:string,projectPath?:string)=>{
    const match=/^project:([^/]+)\//u.exec(key);
    const project=match ? service.projectById(match[1]!) : key.startsWith("global/") ? undefined : projectPath ? service.project(projectPath) : undefined;
    return {projectId:match?.[1] ?? project?.id,project};
  };
  ipcMain.handle("memory:state",(_event,payload)=>service.state(z.string().optional().parse(payload?.projectPath)));
  ipcMain.handle("memory:configure",(_event,payload)=>service.configure(z.object({enabled:z.boolean().optional(),background:z.boolean().optional()}).strict().parse(payload)));
  ipcMain.handle("memory:query",async(_event,payload)=>{
    const input=z.object({projectPath:z.string().optional(),query:z.string().max(2000).optional(),scope:z.enum(["global","project","both","recent"]).optional(),state:z.enum(["confirmed","candidate","rejected","all"]).optional(),lifecycle:z.enum(["active","archived","retired","all"]).optional(),view:z.enum(["current","history","all"]).optional(),history:z.boolean().optional(),kind:z.enum(MEMORY_KINDS).optional(),from:z.number().finite().optional(),to:z.number().finite().optional(),offset:z.number().int().min(0).max(1_000_000).optional(),limit:z.number().int().min(1).max(50).optional()}).strict().parse(payload);
    const db=await service.management();if(!db)return {items:[],total:0};
    const page=await db.call("query",{...input,projectId:input.projectPath?service.project(input.projectPath)?.id:undefined});
    return {...page,items:page.items.map(item=>({...item,projectName:item.projectId?service.projectById(item.projectId)?.name:undefined}))};
  });
  ipcMain.handle("memory:read",async(_event,payload)=>{
    const input=z.object({key:z.string().min(1),projectPath:z.string().optional()}).strict().parse(payload),scope=scopeForKey(input.key,input.projectPath),db=await service.management();
    if(!db)return {item:undefined,revisions:[]};
    return {item:await db.call("get",input.key,scope.projectId),revisions:await db.call("revisions",input.key,scope.projectId)};
  });
  ipcMain.handle("memory:save",async(_event,payload)=>{
    const input=z.object({...writeShape,scope:z.enum(["global","project"]),projectPath:z.string().optional(),pinned:z.boolean().optional()}).strict().parse(payload);
    const project=input.scope==="project"?projectFor(input.projectPath):undefined;
    if(input.scope==="project" && !project) throw new Error("请选择项目范围");
    const db=await management();
    const {item}=await db.call("save",input,{projectId:project?.id,source:{ref:`manual:${randomUUID()}`,type:"manual"},confirmed:true,pinned:input.pinned===true});
    const warning=await exportHuman();
    broadcast("memory:changed",{});
    return {...item,warning};
  });
  ipcMain.handle("memory:update",async(_event,payload)=>{
    const input=z.object({key:z.string().min(1),revision:z.number().int().positive(),projectPath:z.string().optional(),patch:z.object({...writeShape,state:z.enum(["confirmed","candidate","rejected"]).optional(),lifecycle:z.enum(["active","archived","retired"]).optional(),pinned:z.boolean().optional(),cancelPending:z.boolean().optional()}).partial().strict()}).strict().parse(payload);
    const {projectId}=scopeForKey(input.key,input.projectPath),db=await management();
    const prior=await db.call("get",input.key,projectId);
    if(!prior) throw new Error("记忆不存在或不属于当前范围");
    const confirmsContent=(input.patch.text!==undefined && input.patch.text!==prior.text) || (input.patch.details!==undefined && input.patch.details!==prior.details) || (input.patch.kind!==undefined && input.patch.kind!==prior.kind) || (input.patch.state==="confirmed" && prior.state!=="confirmed");
    const sources=confirmsContent?[...prior.sources,{ref:`manual:${randomUUID()}`,type:"manual" as const}]:prior.sources;
    const item=await db.call("update",input.key,projectId,input.revision,{...input.patch,sources,...(prior.mergedInto && input.patch.lifecycle==="active"?{unmerge:true}:{})});
    const warning=await exportHuman();
    broadcast("memory:changed",{});
    return {...item,warning};
  });
  ipcMain.handle("memory:forget",async(_event,payload)=>{
    const input=z.object({key:z.string().min(1),projectPath:z.string().optional()}).strict().parse(payload),scope=scopeForKey(input.key,input.projectPath);
    service.frontActivity();
    const db=await management();await db.call("forget",input.key,scope.projectId);
    await exportHuman();
    broadcast("memory:changed",{});
  });
  ipcMain.handle("memory:open-backups",async()=>{
    const directory=service.backupDirectory();await fs.promises.mkdir(directory,{recursive:true,mode:0o700});
    const error=await shell.openPath(directory);if(error)throw new Error(error);
  });
  ipcMain.handle("memory:summary",(_event,payload)=>service.summary(z.boolean().optional().parse(payload?.refresh) ?? false));
  ipcMain.handle("memory:read-document",()=>service.readDocument());
  ipcMain.handle("memory:save-document",(_event,payload)=>{const input=z.object({content:z.string().max(128*1024),hash:z.string().length(64)}).strict().parse(payload);return service.saveDocument(input.content,input.hash);});
  ipcMain.handle("memory:analyze",()=>service.requestAnalysis());
  ipcMain.handle("memory:session-mode",(_event,payload)=>withSessionCreationLock(async()=>{
    const input=z.object({sessionId:z.string().refine(isSafeSessionId),mode:z.enum(["record","use","off"]).optional()}).strict().parse(payload);
    if(input.mode) {service.frontActivity();writeCache(input.sessionId,{memoryMode:input.mode});broadcast("memory:changed",{session:{sessionId:input.sessionId,mode:input.mode}});}
    return readCache(input.sessionId)?.memoryMode ?? "record";
  }));
}
