import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import type {Store} from "../store";
import type {MemoryPort} from "./client";
import {MemoryDatabase} from "./database";
import {MemoryService,type MemorySessionContext} from "./service";
import {readConclusionEntries,resolveSessionSource} from "./source-reader";
import {bindConclusion,conclusionSnapshot,evidenceMessages} from "./source";
vi.mock("../session-cache",()=>({readCache:()=>undefined}));
// Only deterministic projection helpers; no SDK session or provider is created.
vi.mock("../pi-sdk",()=>({getSessionDataHelpers:async()=>({currentVersion:3,buildSessionProjection:(entries:any[])=>({entries:entries.map(sourceEntry=>({sourceEntry,messages:sourceEntry.type==="message"?[sourceEntry.message]:[]}))})})}));
const fixtures:Array<{root:string;db:MemoryDatabase;service:MemoryService}>=[];
afterEach(async()=>{for(const f of fixtures.splice(0)){await f.service.close();f.db.close();fs.rmSync(f.root,{recursive:true,force:true});}vi.restoreAllMocks();});
function setup(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"em-source-relocation-")),current=path.join(root,"current-sessions"),old=path.join(root,"old-sessions"),other=path.join(root,"other-sessions");
 const project={id:"p",name:"Moved",path:path.join(root,"new-project")},db=new MemoryDatabase(path.join(root,"home","memory","memory.sqlite"));
 const store={getDataDir:()=>path.join(root,"home"),getSettings:()=>({memory:{enabled:true,background:false}}),getProjects:()=>[project,{id:"other",name:"Other",path:path.join(root,"other-project")}]} as unknown as Store;
 const reads:string[]=[],port={call:async(method:string,...args:unknown[])=>{if(method==="readSource"){reads.push((args[0] as any).sessionFile);return readConclusionEntries(args[0] as never,args[1] as boolean);}return (db as any)[method](...args);}} as MemoryPort;
 const backend=vi.fn(async()=>{throw new Error("No provider is allowed in relocation tests");});
 const service=new MemoryService(store,{port,busy:()=>false,getBackend:backend,sessionDirectory:async cwd=>cwd===path.join(root,"other-project")?other:current});
 const write=(file:string,id:string,entries:unknown[])=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,[{type:"session",version:3,id,cwd:path.join(root,"old-project")},...entries].map(row=>JSON.stringify(row)).join("\n")+"\n");};
 const entries=[{type:"message",id:"u",parentId:null,timestamp:"2026-11-17T00:00:00Z",message:{role:"user",content:"已验证的来源事实",timestamp:1}},{type:"message",id:"a",parentId:"u",timestamp:"2026-11-17T00:00:01Z",message:{role:"assistant",content:"本轮结论",stopReason:"stop",timestamp:2}}];
 const context:MemorySessionContext={sessionId:"reader",projectPath:project.path,entries:[],projection:[]};
 fixtures.push({root,db,service});return {root,current,old,other,project,db,service,write,entries,context,reads,backend,port};
}
it("relocates retained evidence by current project and header ID, including a nested child",async()=>{
 const f=setup(),prior=path.join(f.old,"parent","subagents","child.jsonl"),file=path.join(f.current,"parent","subagents","renamed.jsonl");f.write(prior,"child",f.entries);f.write(file,"child",f.entries);
 // A filename match in another project must never supply this source.
 f.write(path.join(f.other,"child.jsonl"),"child",f.entries);
 await f.service.initialize();const user=(await evidenceMessages(f.entries,true))[0]!;
 const item=f.db.save({kind:"activity",text:"来源对应事实"},{projectId:"p",confirmed:true,source:{ref:"source",type:"session",projectId:"p",sessionId:"child",sessionFile:prior,entryId:"u",hash:user.hash}}).item;
 expect(await f.service.evidence(f.context,item)).toBe("已验证的来源事实");expect(f.reads).toEqual([file]);expect(f.backend).not.toHaveBeenCalled();
});
it("does not let a valid old copy hide a changed current branch",async()=>{
 const f=setup(),prior=path.join(f.old,"source.jsonl"),file=path.join(f.current,"source.jsonl");f.write(prior,"source",f.entries);
 const changed=structuredClone(f.entries);changed[0]!.message.content="来源已被更正";f.write(file,"source",changed);
 await f.service.initialize();const user=(await evidenceMessages(f.entries,true))[0]!;
 const item=f.db.save({kind:"activity",text:"旧来源事实"},{projectId:"p",confirmed:true,source:{ref:"source",type:"session",projectId:"p",sessionId:"source",sessionFile:prior,entryId:"u",hash:user.hash}}).item;
 await expect(f.service.evidence(f.context,item)).rejects.toThrow("原来源已变化");expect(f.reads).toEqual([file]);
});
it("loads a pending child's relocated session and owner before analysis",async()=>{
 const f=setup(),parent=[{type:"message",id:"owner",parentId:null,timestamp:"2026-11-17T00:00:00Z",message:{role:"assistant",content:[{type:"toolCall",id:"task-call",name:"task",arguments:{task:"bounded"}}],stopReason:"toolUse",timestamp:1}}];
 const owner=(await evidenceMessages(parent,true))[0]!,snapshot=conclusionSnapshot(await evidenceMessages(f.entries,true),"a")!;
 const parentFile=path.join(f.current,"parent.jsonl"),childFile=path.join(f.current,"parent","subagents","child.jsonl");f.write(parentFile,"parent",parent);f.write(childFile,"child",f.entries);
 await f.service.initialize();const job=bindConclusion(snapshot,{sessionId:"child",sessionFile:path.join(f.old,"child.jsonl"),projectId:"p",projectPath:path.join(f.root,"old-project"),version:3,execution:{permissionSessionId:"parent",ownerEntryId:owner.entryId,ownerHash:owner.hash,ownerMessageEntryId:"owner",ownerSessionFile:path.join(f.old,"parent.jsonl")}});
 expect((await (f.service as any).load(job))?.hash).toBe(snapshot.hash);expect(f.reads).toEqual([parentFile,childFile]);expect(f.backend).not.toHaveBeenCalled();
 f.write(parentFile,"parent",[]);expect(await (f.service as any).load(job)).toBeUndefined();
});
it("rejects duplicate or substituted IDs and ignores linked directories",async()=>{
 const f=setup(),file=path.join(f.current,"wanted.jsonl");f.write(file,"different",f.entries);f.write(path.join(f.other,"wanted.jsonl"),"wanted",f.entries);fs.symlinkSync(f.other,path.join(f.current,"linked"));
 expect(await resolveSessionSource(f.current,"wanted")).toBeUndefined();
 await expect(readConclusionEntries({ref:"x",sessionId:"wanted",sessionFile:file,entryId:"a",projectPath:f.project.path,timestamp:1,hash:"x"})).rejects.toThrow("身份不匹配");
 f.write(file,"wanted",f.entries);f.write(path.join(f.current,"nested","duplicate.jsonl"),"wanted",f.entries);await expect(resolveSessionSource(f.current,"wanted")).rejects.toThrow("重复");
});

it.each(["file","parent"])("rejects an outside %s link substituted between source location and the final worker read",async(target)=>{
 const f=setup(),directory=path.join(f.current,"parent"),file=path.join(directory,"source.jsonl"),outside=path.join(f.other,"private","source.jsonl");
 f.write(file,"source",f.entries);const secret=structuredClone(f.entries);secret[0]!.message.content="OTHER_PROJECT_PRIVATE";f.write(outside,"source",secret);
 await f.service.initialize();const user=(await evidenceMessages(f.entries,true))[0]!;
 const item=f.db.save({kind:"activity",text:"原项目事实"},{projectId:"p",confirmed:true,source:{ref:"source",type:"session",projectId:"p",sessionId:"source",sessionFile:file,entryId:"u",hash:user.hash}}).item;
 expect(await f.service.evidence(f.context,item)).toBe("已验证的来源事实");
 const original=f.port.call.bind(f.port);let replaced=false;
 vi.spyOn(f.port,"call").mockImplementation((async(method:string,...args:unknown[])=>{
  if(method==="readSource"&&!replaced){
   replaced=true;expect((args[0] as {sourceRoot:string}).sourceRoot).toBe(fs.realpathSync(f.current));
   if(target==="file"){fs.unlinkSync(file);fs.symlinkSync(outside,file);}
   else{fs.renameSync(directory,path.join(f.current,"retained-parent"));fs.symlinkSync(path.dirname(outside),directory,"dir");}
  }
  return (original as any)(method,...args);
 }) as any);
 await expect(f.service.evidence(f.context,item,0,true)).rejects.toThrow(/来源会话|ELOOP|symbolic/iu);
 expect(replaced).toBe(true);expect(f.backend).not.toHaveBeenCalled();expect(f.db.get(item.key,"p")?.text).toBe("原项目事实");
});
