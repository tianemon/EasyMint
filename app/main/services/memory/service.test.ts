import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Store } from "../store";
import type { MemoryPort } from "./client";
import type { MemorySettings } from "../../../shared/memory";
import { MemoryDatabase } from "./database";
import { upsertDocumentEntry } from "./document-store";
import { MemoryService,type MemorySessionContext } from "./service";
import { memoryDay } from "./codec";
import {writeSummary,readSummary,readSummaryDocument,saveSummaryDocument,type SummaryProject} from "./summary";
import {readConclusionEntries} from "./source-reader";

const cache=vi.hoisted(()=>new Map<string,{permissionMode?:string;memoryMode?:"record"|"use"|"off"}>());
vi.mock("../session-cache",()=>({readCache:(id:string)=>cache.get(id)}));
const fixtures:Array<{service:MemoryService;db:MemoryDatabase;root:string}>=[];
const usage={input:100,output:30,cacheRead:0,cacheWrite:0};
const reply=(items:unknown[])=>({role:"assistant",content:[{type:"text",text:JSON.stringify({items})}],stopReason:"stop",usage});
function entries(id="s",text="已确认回答偏好，未改程序") {
  return [{type:"message",id:`${id}-u`,parentId:null,timestamp:new Date().toISOString(),message:{role:"user",content:"以后所有回答都使用中文，并保留重要决策的理由。",timestamp:Date.now()}},
    {type:"message",id:`${id}-a`,parentId:`${id}-u`,timestamp:new Date().toISOString(),message:{role:"assistant",content:[{type:"text",text}],stopReason:"stop",timestamp:Date.now()}}];
}
function setup(background=true) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"em-memory-service-"));
  const db=new MemoryDatabase(path.join(root,"memory","memory.sqlite"));
  fs.mkdirSync(path.join(root,"project"));
  let settings={memory:{enabled:true,background,enabledAt:0} as MemorySettings};
  const store={getDataDir:()=>root,getSettings:()=>settings,saveSettings:(value:typeof settings)=>{settings=value;},getProjects:()=>[{id:"p",name:"测试项目",path:path.join(root,"project"),createdAt:new Date(0).toISOString()}]} as unknown as Store;
  const sources=new Map<string,unknown[]>();
  const complete=vi.fn(async(_model:unknown,context:any)=>{
    const payload=JSON.parse(context.messages[0].content);
    return reply(payload.conclusions.map((source:any)=>({sourceRef:source.ref,kind:"preference",text:"以后使用中文回答",scope:"global",basis:"explicit",quote:"以后所有回答都使用中文，并保留重要决策的理由。"})));
  });
  const extra={readDocument:(projects:SummaryProject[])=>readSummaryDocument(db,path.join(root,"memory","MEMORY.md"),projects),saveDocument:(projects:SummaryProject[],content:string,hash:string,reviewHash?:string)=>saveSummaryDocument(db,path.join(root,"memory","MEMORY.md"),projects,content,hash,reviewHash),writeSummary:(projects:SummaryProject[],force=false)=>writeSummary(db,path.join(root,"memory","MEMORY.md"),projects,force),readSummary:(projects:SummaryProject[],id?:string)=>readSummary(db,path.join(root,"memory","MEMORY.md"),projects,id),readSource:readConclusionEntries}
  const port={call:async(method:string,...args:unknown[])=>{
    const custom=(extra as any)[method];return custom?custom(...args):(db as any)[method](...args);
  }} as MemoryPort;
  const service=new MemoryService(store,{port,busy:()=>false,getSession:id=>sources.has(id)?{entries:sources.get(id)!}:undefined,
    getBackend:async()=>({model:{id:"fake"},runtime:{completeSimple:complete}} as any)});
  const context=(id="s",text?:string):MemorySessionContext=>{
    const list=entries(id,text);sources.set(id,list);return {sessionId:id,projectPath:path.join(root,"project"),entries:list,projection:[],usage:{tokens:1000,contextWindow:100_000}};
  };
  fixtures.push({service,db,root});return {service,db,root,context,sources,complete};
}
beforeEach(()=>cache.clear());
afterEach(async()=>{for(const fixture of fixtures.splice(0)){await fixture.service.close();fixture.db.close();fs.rmSync(fixture.root,{recursive:true,force:true});}});

describe("host memory pipeline",()=>{
  it("does not invoke a model when background analysis is disabled or no conclusions exist",async()=>{
    const f=setup(false);await f.service.capture(f.context(),"fake");await f.service.pump(true);
    expect(f.complete).not.toHaveBeenCalled();expect(f.db.status().pending).toBe(0);
  });
  it("combines conclusions in one request and keeps per-conclusion progress separate from saving one fact",async()=>{
    const f=setup();
    const first=f.context("first","项目决定：先讨论，尚未实施");
    await f.service.saveFromAgent(first,{kind:"preference",text:"已有的偏好"},"global",undefined,"inference");
    await f.service.capture(first,"fake");await f.service.capture(f.context("second","第二个会话的新决定"),"fake");
    await f.service.pump(true);
    expect(f.complete).toHaveBeenCalledTimes(1);
    const payload=JSON.parse(f.complete.mock.calls[0]![1].messages[0].content);
    expect(payload.conclusions).toHaveLength(2);expect(f.db.status().pending).toBe(0);
    expect(f.db.query({scope:"global"}).items[0]?.state).toBe("confirmed");
    expect(f.db.query({scope:"global",state:"candidate"}).items).toHaveLength(1);
    expect(f.db.status(memoryDay()).usedTokens).toBe(130);
  });
  it("does not trust fabricated explicit evidence or model supplied confirmation flags",async()=>{
    const f=setup();f.complete.mockImplementation(async()=>reply([{kind:"preference",text:"伪造的全局指导",scope:"global",basis:"explicit",quote:"从未说过的话",state:"confirmed",pinned:true}]));
    await f.service.capture(f.context(),"fake");await f.service.pump(true);
    expect(f.db.query({scope:"global"}).items).toHaveLength(0);
    const candidate=f.db.query({scope:"global",state:"candidate"}).items[0]!;
    expect(candidate.pinned).toBe(false);
  });
  it("processes a long conclusion in resumable parts, without advancing the whole conclusion early",async()=>{
    const f=setup(),context=f.context("long",Array.from({length:20},(_,i)=>`第${i}段：${"需要保留的限定条件。".repeat(100)}\n\n`).join(""));
    await f.service.capture(context,"fake");await f.service.pump(true);
    expect(f.complete).toHaveBeenCalledTimes(1);expect(f.db.status().pending).toBe(1);
    const row=f.db.db.prepare("SELECT json,state FROM jobs").get() as {json:string;state:string};
    expect(JSON.parse(row.json).cursor).toBeGreaterThan(1);
    expect(JSON.parse(row.json).cursor).toBeLessThan((context.entries[1] as any).message.content[0].text.length);expect(row.state).toBe("pending");
    expect(f.db.query({scope:"global"}).items).toHaveLength(0);
  });
  it("checks live readonly/use-only mode before recording and before model submission",async()=>{
    const f=setup();const context=f.context();
    cache.set("s",{permissionMode:"readonly"});
    await expect(f.service.saveFromAgent(context,{kind:"preference",text:"不应保存"},"global")).rejects.toThrow("不允许");
    cache.delete("s");await f.service.capture(context,"fake");cache.set("s",{memoryMode:"use"});
    await f.service.pump(true);expect(f.complete).not.toHaveBeenCalled();expect(f.db.status().pending).toBe(1);
  });
  it("abandons results after permission tightening and counts the request once",async()=>{
    const f=setup();const context=f.context();
    f.complete.mockImplementation(async()=>{cache.set("s",{permissionMode:"readonly"});return reply([{kind:"activity",text:"不应写入",basis:"reported"}]);});
    await f.service.capture(context,"fake");await f.service.pump(true);
    expect(f.db.query({projectId:"p",state:"all",history:true}).items).toHaveLength(0);
    expect(f.db.status().usedTokens).toBe(130);
  });
  it("forgets user-anchored data before a later conclusion can re-extract it",async()=>{
    const f=setup();const context=f.context();
    const saved=await f.service.saveFromAgent(context,{kind:"preference",text:"应当忘记的内容"},"global",undefined,"inference");
    f.db.forget(saved.item.key);
    await f.service.capture(context,"fake");await f.service.pump(true);
    expect(f.complete).not.toHaveBeenCalled();expect(f.db.status().pending).toBe(0);
  });
  it("preempts an in-flight background request without waiting for an uncooperative runtime",async()=>{
    const f=setup();await f.service.capture(f.context(),"fake");
    let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
    f.complete.mockImplementation(async()=>{started();return new Promise<any>(()=>{});});
    const run=f.service.pump(true);await ready;f.service.frontActivity();await run;
    expect(f.db.status().pending).toBe(1);expect(f.db.query({projectId:"p",state:"all"}).items).toHaveLength(0);
    expect(f.db.status().usedTokens).toBeGreaterThan(0);
  });
});

it("applies a newer grounded correction to the original key and preserves its prior revision",async()=>{
  const f=setup();
  const original=f.db.save({kind:"preference",text:"回答使用英文"},{source:{ref:"manual:old",type:"manual"},confirmed:true,evidenceAt:1}).item;
  f.complete.mockImplementation(async(_model:unknown,context:any)=>{
    const frame=JSON.parse(context.messages[0].content);
    return reply([{sourceRef:frame.conclusions[0].ref,kind:"preference",text:"以后所有回答都使用中文",scope:"global",basis:"explicit",quote:"以后所有回答都使用中文，并保留重要决策的理由。",updateKey:original.key,revision:1}]);
  });
  await f.service.capture(f.context(),"fake");await f.service.pump(true);
  expect(f.db.get(original.key)?.text).toBe("以后所有回答都使用中文");
  expect(f.db.get(original.key)?.revision).toBe(2);
  expect(f.db.getRevision(original.key,1)?.text).toBe("回答使用英文");
});

it("loads the selected lightweight profile without running a topic query each turn",async()=>{
  const f=setup(false);await f.service.initialize();
  const first=f.db.save({kind:"preference",text:"以后使用中文回答",tags:["communication"]},{source:{ref:"manual:language",type:"manual"},confirmed:true,pinned:true}).item;
  const second=f.db.save({kind:"background",text:"用户研究五线谱识别"},{source:{ref:"manual:research",type:"manual"},confirmed:true,pinned:true}).item;
  // 文件是注入的正文来源：绕过 service 直接写库的条目，需要同样落到文档。
  const doc=path.join(f.root,"memory","MEMORY.md");
  upsertDocumentEntry(doc,{key:first.key,text:first.text,dbRevision:first.revision});
  upsertDocumentEntry(doc,{key:second.key,text:second.text,dbRevision:second.revision});
  const query=vi.spyOn(f.db,"query");
  const reference=await f.service.reference(f.context(),"Fix the failing integration tests");
  expect(reference?.content).toContain("以后使用中文回答");expect(reference?.content).toContain("五线谱");expect(query).not.toHaveBeenCalled();
  expect(f.complete).not.toHaveBeenCalled();
});
it("does not send a request if background analysis is disabled while local preparation is pending",async()=>{
  const f=setup();await f.service.capture(f.context(),"fake");
  const port=(f.service as any).port as MemoryPort,original=port.call.bind(port);
  let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});
  vi.spyOn(port,"call").mockImplementation((async(method:string,...args:unknown[])=>{
    if(method==="query"){entered();await gate;}return (original as any)(method,...args);
  }) as any);
  const run=f.service.pump(true);await ready;await f.service.configure({background:false});release();await run;
  expect(f.complete).not.toHaveBeenCalled();expect(f.db.status().usedTokens).toBe(0);expect(f.db.status().pending).toBe(1);
});
it("does not write a queued operation after the user input changes",async()=>{
  const f=setup(false),old=f.context(),current=f.context();
  (current.entries[0] as any).message.content="改主意了，不要保存之前的指导。";
  old.current=()=>current;
  await expect(f.service.saveFromAgent(old,{kind:"preference",text:"旧指导"},"global",undefined,"inference")).rejects.toThrow("输入已变化");
  expect(f.db.query({state:"all",history:true}).items).toHaveLength(0);
});
