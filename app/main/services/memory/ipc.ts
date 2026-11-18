import {ipcMain} from "electron";
import {z} from "zod";
import type {MemoryService} from "./service";
import {readCache,writeCache} from "../session-cache";
import {withSessionCreationLock} from "../session-permission-gate";
import {broadcast} from "../ipc-broadcast";
import {isSafeSessionId} from "../../../shared/session-id";
/** User-facing controls are settings and a read-only document. Record management belongs to the agent. */
export function registerMemoryIpc(service:MemoryService):void {
 ipcMain.handle("memory:state",()=>service.state());
 ipcMain.handle("memory:configure",(_event,payload)=>service.configure(z.object({enabled:z.boolean().optional(),background:z.boolean().optional()}).strict().parse(payload)));
 ipcMain.handle("memory:read-document",()=>service.readDocument());
 // Keep stored per-chat privacy choices effective for existing sessions; no GUI mode picker.
 ipcMain.handle("memory:session-mode",(_event,payload)=>withSessionCreationLock(async()=>{
  const input=z.object({sessionId:z.string().refine(isSafeSessionId),mode:z.enum(["record","use","off"]).optional()}).strict().parse(payload);
  if(input.mode){service.frontActivity();writeCache(input.sessionId,{memoryMode:input.mode});broadcast("memory:changed",{session:{sessionId:input.sessionId,mode:input.mode}});}
  return readCache(input.sessionId)?.memoryMode ?? "record";
 }));
}
