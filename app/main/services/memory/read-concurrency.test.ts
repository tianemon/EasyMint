import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import type {Store} from "../store";
import type {MemoryPort} from "./client";
import {MemoryDatabase} from "./database";
import {MemoryService,type MemorySessionContext} from "./service";
import {createMemoryTool} from "../tools/memory-tool";
import {evidenceMessages} from "./source";

const cache=vi.hoisted(()=>new Map<string,{permissionMode?:string;memoryMode?:"record"|"use"|"off"}>());
vi.mock("../session-cache",()=>({readCache:(id:string)=>cache.get(id)}));
// Projection only: these tests never create an SDK session or invoke a provider.
vi.mock("../pi-sdk",()=>({getDefineToolFn:async()=>((value:unknown)=>value),getSessionDataHelpers:async()=>({currentVersion:3,buildSessionProjection:(entries:any[])=>({entries:entries.map(sourceEntry=>({sourceEntry,messages:sourceEntry.type==="message"?[sourceEntry.message]:[]}))})})}));
const fixtures:Array<{service:MemoryService;db:MemoryDatabase;root:string}>=[];
function setup(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"em-read-concurrency-")),db=new MemoryDatabase(path.join(root,"memory","memory.sqlite"));
 let settings={memory:{enabled:true,background:false}};
 const projects=[{id:"p",name:"Current",path:root,createdAt:new Date().toISOString()}];
 const store={getDataDir:()=>root,getSettings:()=>settings,saveSettings:(next:typeof settings)=>{settings=next;},getProjects:()=>projects} as unknown as Store;
 const sources=new Map<string,unknown[]>(),readSource=vi.fn(async()=>[] as unknown[]),backend=vi.fn(async()=>{throw new Error("No provider is allowed in a read test");});
 const port={call:async(method:string,...args:unknown[])=>method==="readSource"?readSource():(db as any)[method](...args)} as MemoryPort;
 const service=new MemoryService(store,{sessionDirectory:async()=>root,port,busy:()=>false,getBackend:backend,getSession:id=>sources.has(id)?{entries:sources.get(id)!}:undefined});
 const context=(id="reader",text="当前关注受控测试"):MemorySessionContext=>{
  const entries=[{type:"message",id:`${id}-u`,parentId:null,timestamp:new Date().toISOString(),message:{role:"user",content:text,timestamp:Date.now()}}];sources.set(id,entries);
  return {sessionId:id,projectPath:root,entries,projection:[],usage:{tokens:100,contextWindow:100000}};
 };
 const gate=(method:string)=>{const original=port.call.bind(port);let entered!:()=>void,release!:()=>void,first=true;const ready=new Promise<void>(resolve=>{entered=resolve;}),pending=new Promise<void>(resolve=>{release=resolve;});
  vi.spyOn(port,"call").mockImplementation((async(name:string,...args:unknown[])=>{const result=await (original as any)(name,...args);if(name===method&&first){first=false;entered();await pending;}return result;}) as MemoryPort["call"]);return {ready,release};
 };
 const save=()=>db.save({kind:"activity",text:"PRIVATE_SAVED_FACT"},{confirmed:true,source:{type:"manual",ref:"fixture"}}).item;
 const forget=async(key:string)=>{const cleanup=context("cleanup","请忘记这条记忆");await service.forgetFromAgent(cleanup,key,"请忘记这条记忆");};
 fixtures.push({service,db,root});return {service,db,root,context,sources,port,readSource,backend,projects,gate,save,forget};
}
afterEach(async()=>{vi.restoreAllMocks();for(const f of fixtures.splice(0)){await f.service.close();f.db.close();fs.rmSync(f.root,{recursive:true,force:true});}cache.clear();});

it.each(["history","all"] as const)("honors the explicit %s view for archived unconfirmed content",async view=>{
 const f=setup();await f.service.initialize();
 const item=f.db.save({kind:"activity",text:"RETAINED_HISTORICAL_FACT"},{confirmed:true,source:{type:"session",ref:"user:historical:old",sessionId:"historical",entryId:"old",hash:"prior-source"}}).item;
 f.db.invalidateSession("historical",[]);
 const page=await f.service.query(f.context(),{view});
 expect(page.items.map(row=>row.key)).toContain(item.key);
 expect(page.items[0]?.confidence).toBe("unconfirmed");
});

it.each([false,true])("does not deliver a forgotten read snapshot, history=%s",async(history)=>{
 const f=setup();await f.service.initialize();const item=f.save(),tool=await createMemoryTool(f.service,()=>f.context()),gate=f.gate("get");
 const read=tool.execute("read",{action:"read",key:item.key,history},new AbortController().signal,undefined,{} as never);const rejected=expect(read).rejects.toThrow(/移除|变化/u);
 await gate.ready;await f.forget(item.key);gate.release();await rejected;expect(f.backend).not.toHaveBeenCalled();
});
it("filters a query snapshot after the live source was replaced",async()=>{
 const f=setup();await f.service.initialize();const context=f.context(),user=(await evidenceMessages(context.entries,true))[0]!;
 const item=f.db.save({kind:"activity",text:"PRIVATE_SAVED_FACT"},{confirmed:true,source:{type:"session",ref:"user:reader:reader-u",sessionId:"reader",entryId:user.entryId,hash:user.hash}}).item;
 let current=context;context.current=()=>current;const gate=f.gate("query"),read=f.service.query(context,{query:"PRIVATE_SAVED_FACT"});
 await gate.ready;const entries=structuredClone(context.entries);(entries[0] as any).message.content="来源更正";current={...context,entries};f.sources.set("reader",entries);await f.service.sourceChanged("reader",f.root,entries);gate.release();
 expect((await read).items).toHaveLength(0);expect(f.db.get(item.key)?.confidence).toBe("unconfirmed");
});
it("uses live current source entries even before index invalidation completes",async()=>{
 const f=setup();await f.service.initialize();const context=f.context(),user=(await evidenceMessages(context.entries,true))[0]!;
 const item=f.db.save({kind:"activity",text:"PRIVATE_SAVED_FACT"},{confirmed:true,source:{type:"session",ref:"user:reader:reader-u",sessionId:"reader",entryId:user.entryId,hash:user.hash}}).item;
 let current=context;context.current=()=>current;const tool=await createMemoryTool(f.service,()=>context),gate=f.gate("get"),read=tool.execute("read",{action:"read",key:item.key},new AbortController().signal,undefined,{} as never),rejected=expect(read).rejects.toThrow(/撤回|修订|变化/u);
 await gate.ready;const entries=structuredClone(context.entries);(entries[0] as any).message.content="新的来源正文";current={...context,entries};gate.release();await rejected;expect(f.db.get(item.key)?.confidence).toBe("confirmed");
});
it.each(["read_summary","reference"])("does not deliver an old scoped document after forget: %s",async(action)=>{
 const f=setup();await f.service.initialize();const item=f.save(),context=f.context(),gate=f.gate("lookupReferences");
 for(const name of ["cachedMachine","cachedEvidence","cachedToolHint","recentProjects"])(f.service as any)[name]=()=>undefined;
 (f.service as any).cachedLastSession=async()=>undefined;
 const read=action==="reference"?f.service.reference(context,""):f.service.readDocumentFromAgent(context);
 const outcome=read.then(value=>JSON.stringify(value) ?? "",error=>{expect(String(error)).toMatch(/移除|变化/u);return "";});
 await gate.ready;await f.forget(item.key);gate.release();expect(await outcome).not.toContain(item.text);
});
it.each([false,true])("does not deliver evidence after forget during its file read, history=%s",async(history)=>{
 const f=setup();await f.service.initialize();const context=f.context("source"),user=(await evidenceMessages(context.entries,true))[0]!,file=path.join(f.root,"source.jsonl");fs.writeFileSync(file,JSON.stringify({type:"session",version:3,id:"source"})+"\n");
 const item=f.db.save({kind:"activity",text:"PRIVATE_SAVED_FACT"},{confirmed:true,source:{type:"session",ref:"user:source:source-u",sessionId:"source",entryId:user.entryId,hash:user.hash,sessionFile:file}}).item;
 f.readSource.mockResolvedValue(context.entries);f.sources.delete("source");const gate=f.gate("readSource"),read=f.service.evidence(f.context("reader"),item,0,history),rejected=expect(read).rejects.toThrow(/移除|变化/u);
 await gate.ready;await f.forget(item.key);gate.release();await rejected;
});
it("rechecks eligibility if a final lookup response crosses a completed forget",async()=>{
 const f=setup();await f.service.initialize();const item=f.save(),context=f.context(),gate=f.gate("lookupReferences"),read=f.service.deliverRead(context,[item],()=>item.text),rejected=expect(read).rejects.toThrow(/移除|变化/u);
 await gate.ready;await f.forget(item.key);gate.release();await rejected;
});
it("checks the parent's live off mode after an asynchronous qualification lookup",async()=>{
 const f=setup();await f.service.initialize();const item=f.save(),context={...f.context(),permissionSessionId:"parent"},gate=f.gate("lookupReferences"),read=f.service.deliverRead(context,[item],()=>item.text),rejected=expect(read).rejects.toThrow("已关闭记忆");
 await gate.ready;cache.set("parent",{memoryMode:"off"});gate.release();await rejected;
});
it("rejects a child read after its actual owner tool call leaves the parent branch",async()=>{
 const f=setup();await f.service.initialize();const parent=f.context("parent"),stamp=Date.now();
 const ownerMessage={type:"message",id:"owner",parentId:"parent-u",timestamp:new Date(stamp).toISOString(),message:{role:"assistant",stopReason:"toolUse",timestamp:stamp,content:[{type:"toolCall",id:"task-owner",name:"task",arguments:{task:"bounded task"}}]}};
 const ownerEntries=[...parent.entries,ownerMessage];f.sources.set("parent",ownerEntries);const owner=(await evidenceMessages(ownerEntries,true)).find(entry=>entry.entryId==="toolcall:task-owner")!;
 const item=f.save(),context={...f.context("child"),limited:true,permissionSessionId:"parent",ownerEntryId:owner.entryId,ownerHash:owner.hash,ownerMessageEntryId:"owner",ownerSessionFile:path.join(f.root,"owner.jsonl")};
 const gate=f.gate("lookupReferences"),read=f.service.deliverRead(context,[item],()=>item.text),rejected=expect(read).rejects.toThrow("委派来源已撤回");
 await gate.ready;f.sources.set("parent",parent.entries);gate.release();await rejected;
});
it("does not deliver evidence after global disable during its targeted read",async()=>{
 const f=setup();await f.service.initialize();const context=f.context("source"),user=(await evidenceMessages(context.entries,true))[0]!,file=path.join(f.root,"source.jsonl");fs.writeFileSync(file,JSON.stringify({type:"session",version:3,id:"source"})+"\n");
 const item=f.db.save({kind:"activity",text:"PRIVATE_SAVED_FACT"},{confirmed:true,source:{type:"session",ref:"user:source:source-u",sessionId:"source",entryId:user.entryId,hash:user.hash,sessionFile:file}}).item;
 f.readSource.mockResolvedValue(context.entries);f.sources.delete("source");const gate=f.gate("readSource"),read=f.service.evidence(f.context("reader"),item,0),rejected=expect(read).rejects.toThrow("已关闭记忆");
 await gate.ready;await f.service.configure({enabled:false});gate.release();await rejected;
});
it("permits readonly reads and explicitly requested retained history",async()=>{
 const f=setup();await f.service.initialize();const item=f.save();f.db.update(item.key,undefined,item.revision,{text:"NEW_CURRENT_FACT"});cache.set("reader",{permissionMode:"readonly"});
 const tool=await createMemoryTool(f.service,()=>f.context());const read=await tool.execute("history",{action:"read",key:item.key,revision:1,history:true},new AbortController().signal,undefined,{} as never);
 expect(JSON.stringify(read)).toContain(item.text);expect(f.backend).not.toHaveBeenCalled();
});
it("does not deliver a forgotten historical revision whose body read was already pending",async()=>{
 const f=setup();await f.service.initialize();const item=f.save();f.db.update(item.key,undefined,item.revision,{text:"NEW_CURRENT_FACT"});
 const tool=await createMemoryTool(f.service,()=>f.context()),gate=f.gate("getRevision"),read=tool.execute("history",{action:"read",key:item.key,revision:1,history:true},new AbortController().signal,undefined,{} as never),rejected=expect(read).rejects.toThrow(/移除|变化/u);
 await gate.ready;await f.forget(item.key);gate.release();await rejected;
});
it("does not describe deleted historical sources as still available",async()=>{
 const f=setup();await f.service.initialize();const source=f.context("source"),user=(await evidenceMessages(source.entries,true))[0]!;
 const item=f.db.save({kind:"activity",text:"PRIVATE_SAVED_FACT"},{confirmed:true,source:{type:"session",ref:"user:source:source-u",sessionId:"source",entryId:user.entryId,hash:user.hash}}).item;f.db.update(item.key,undefined,item.revision,{text:"NEW_CURRENT_FACT"});
 const tool=await createMemoryTool(f.service,()=>f.context("reader")),gate=f.gate("getRevision"),read=tool.execute("history",{action:"read",key:item.key,revision:1,history:true,section:"sources"},new AbortController().signal,undefined,{} as never),rejected=expect(read).rejects.toThrow(/来源资格已变化/u);
 await gate.ready;await f.service.detach("source",false,f.root);gate.release();await rejected;
});
it("rechecks only requested IDs and retains explicitly selected project scope",async()=>{
 const f=setup();await f.service.initialize();f.projects.push({id:"other",name:"Other",path:path.join(f.root,"other"),createdAt:new Date().toISOString()});
 const item=f.db.save({kind:"activity",text:"OTHER_PROJECT_FACT"},{projectId:"other",confirmed:true,source:{type:"manual",ref:"other"}}).item;
 const call=vi.spyOn(f.port,"call"),context=f.context("reader","查看Other项目");expect(await f.service.deliverRead(context,[item],()=>item.text,false,undefined,"other")).toBe(item.text);
 expect(call.mock.calls.filter(args=>args[0]==="lookupReferences").map(args=>args.slice(1))).toEqual([[[item.key],"other"]]);
});

it("does not let an old capture invalidate a fact saved after a newer source change",async()=>{
 const f=setup();await f.service.initialize();await f.service.configure({background:true});
 const original=f.context("source","旧事实条件"),stamp=Date.now();original.entries.push({type:"message",id:"source-a",parentId:"source-u",timestamp:new Date(stamp).toISOString(),message:{role:"assistant",content:"已完成这一轮",stopReason:"stop",timestamp:stamp}});
 let current=original;original.current=()=>current;f.sources.set("source",original.entries);const gate=f.gate("sourceEntryIds"),capture=f.service.capture(original,"synthetic.jsonl");await gate.ready;
 const latest=structuredClone(original.entries);(latest[0] as any).message.content="新的事实条件";current={...original,entries:latest};f.sources.set("source",latest);await f.service.sourceChanged("source",f.root,latest);
 const fresh=await f.service.saveFromAgent(current,{kind:"attention",text:"新的已确认事实"},"global","新的事实条件","explicit");gate.release();await capture;
 expect(f.db.get(fresh.item.key)?.confidence).toBe("confirmed");expect(f.db.status().pending).toBe(0);
});
it("does not apply an older sourceChanged after a newer sourceChanged and save",async()=>{
 const f=setup();await f.service.initialize();const old=f.context("source","旧事实条件"),gate=f.gate("sourceEntryIds"),first=f.service.sourceChanged("source",f.root,old.entries);await gate.ready;
 const latest=structuredClone(old.entries);(latest[0] as any).message.content="新的事实条件";const current={...old,entries:latest};f.sources.set("source",latest);await f.service.sourceChanged("source",f.root,latest);
 const fresh=await f.service.saveFromAgent(current,{kind:"attention",text:"新的已确认事实"},"global","新的事实条件","explicit");gate.release();await first;expect(f.db.get(fresh.item.key)?.confidence).toBe("confirmed");
});
it("does not invalidate a new structured submission absent from the earlier source ID catalog",async()=>{
 const f=setup();await f.service.initialize();await f.service.configure({background:true});const old=f.context("source","旧事实条件"),stamp=Date.now();
 old.entries.push({type:"message",id:"source-a",parentId:"source-u",timestamp:new Date(stamp).toISOString(),message:{role:"assistant",content:"已完成这一轮",stopReason:"stop",timestamp:stamp}});
 let current=old;old.current=()=>current;f.sources.set("source",old.entries);const gate=f.gate("sourceEntryIds"),capture=f.service.capture(old,"synthetic.jsonl");await gate.ready;
 const latest=[...old.entries,{type:"message",id:"new-u",parentId:"source-a",timestamp:new Date(stamp+1).toISOString(),message:{role:"user",content:"新的事实条件",timestamp:stamp+1}},{type:"message",id:"new-call",parentId:"new-u",timestamp:new Date(stamp+2).toISOString(),message:{role:"assistant",stopReason:"toolUse",timestamp:stamp+2,content:[{type:"toolCall",id:"save-new",name:"memory",arguments:{action:"save",kind:"attention",text:"新的结构化事实",scope:"global",basis:"explicit",quote:"新的事实条件"}}]}}];
 current={...old,entries:latest};f.sources.set("source",latest);const fresh=await f.service.saveFromAgent(current,{kind:"attention",text:"新的结构化事实"},"global","新的事实条件","explicit",undefined,{toolCallId:"save-new"});
 gate.release();await capture;expect(f.db.get(fresh.item.key)?.confidence).toBe("confirmed");
 expect(f.db.db.prepare("SELECT ref FROM jobs").all()).toEqual([{ref:"conclusion:source:source-a"}]);
});
it.each([false,true])("source catalogs include existing jobs and do not revoke later jobs, owner=%s",(owner)=>{
 const f=setup(),job=(id:string)=>({ref:`job:${id}`,sessionId:owner?`child-${id}`:"source",entryId:`end-${id}`,hash:`hash-${id}`,sessionFile:"synthetic.jsonl",projectPath:f.root,timestamp:1,...(owner?{execution:{permissionSessionId:"source",ownerEntryId:`toolcall:${id}`,ownerHash:`owner-${id}`,ownerMessageEntryId:`call-${id}`,ownerSessionFile:"owner.jsonl"}}:{})});
 f.db.enqueue(job("old"));f.db.claim();const known=f.db.sourceEntryIds("source");expect(known).toContain(owner?"toolcall:old":"end-old");f.db.enqueue(job("new"));
 f.db.invalidateSession("source",[],known);expect(f.db.db.prepare("SELECT state FROM jobs WHERE ref='job:old'").get()).toEqual({state:"skipped"});expect(f.db.db.prepare("SELECT state FROM jobs WHERE ref='job:new'").get()).toEqual({state:"pending"});
 // The explicit legacy two-argument API still invalidates all matching sources.
 f.db.invalidateSession("source",[]);expect(f.db.db.prepare("SELECT state FROM jobs WHERE ref='job:new'").get()).toEqual({state:"skipped"});
});
