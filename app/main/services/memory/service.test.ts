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
import {readConclusionEntries} from "./source-reader";

const cache=vi.hoisted(()=>new Map<string,{permissionMode?:string;memoryMode?:"record"|"use"|"off"}>());
vi.mock("../session-cache",()=>({readCache:(id:string)=>cache.get(id)}));
const fixtures:Array<{service:MemoryService;db:MemoryDatabase;root:string}>=[];
const usage={input:100,output:30,cacheRead:0,cacheWrite:0};
const reply=(items:unknown[])=>({role:"assistant",content:[{type:"text",text:JSON.stringify({items})}],stopReason:"stop",usage});
function entries(id="s",text="已确认回答偏好，未改程序") {
  return [{type:"message",id:`${id}-u`,parentId:null,timestamp:new Date().toISOString(),message:{role:"user",content:"目前主要研究转录数据的跨平台验证，尚未开始真实设备实验。",timestamp:Date.now()}},
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
    return reply(payload.conclusions.map((source:any)=>({sourceRef:source.ref,kind:"attention",text:"当前关注跨平台验证，实机实验尚未开始",scope:"global",basis:"explicit",quote:"目前主要研究转录数据的跨平台验证，尚未开始真实设备实验。"})));
  });
  const extra={readSource:readConclusionEntries};
  const port={call:async(method:string,...args:unknown[])=>{
    const custom=(extra as any)[method];return custom?custom(...args):(db as any)[method](...args);
  }} as MemoryPort;
  const getBackend=vi.fn(async(_sessionId:string)=>({model:{id:"fake",contextWindow:100000},runtime:{completeSimple:complete}} as any));
  const changed = vi.fn();
  const service=new MemoryService(store,{sessionDirectory:async()=>root,port,busy:()=>false,getSession:id=>sources.has(id)?{entries:sources.get(id)!}:undefined,getBackend,changed});
  const context=(id="s",text?:string):MemorySessionContext=>{
    const list=entries(id,text);sources.set(id,list);return {sessionId:id,projectPath:path.join(root,"project"),entries:list,projection:[],usage:{tokens:1000,contextWindow:100_000}};
  };
  fixtures.push({service,db,root});return {service,db,root,context,sources,complete,getBackend,store,changed,port};
}
beforeEach(()=>cache.clear());
afterEach(async()=>{for(const fixture of fixtures.splice(0)){await fixture.service.close();fixture.db.close();fs.rmSync(fixture.root,{recursive:true,force:true});}vi.useRealTimers();});

it("captures only rounds that start after the persistent first-launch boundary",async()=>{
  const f=setup();await f.service.initialize();
  const epoch=f.db.metadata<number>("recordingStartedAt")!;
  expect(epoch).toBeGreaterThan(0);
  const round=(id:string,userAt:number,assistantAt:number)=>{
    const context=f.context(id);
    (context.entries[0] as any).message.timestamp=userAt;
    (context.entries[1] as any).message.timestamp=assistantAt;
    return context;
  };
  await f.service.capture(round("old",epoch-1000,epoch-500),"fake");
  await f.service.capture(round("crossed",epoch-1000,epoch+1000),"fake");
  expect(f.db.status().pending).toBe(0);
  await f.service.capture(round("fresh",epoch+1,epoch+1000),"fake");
  expect(f.db.status().pending).toBe(1);expect(f.complete).not.toHaveBeenCalled();
});

it("starts the initial background window now without enabling a user's disabled switches",async()=>{
  const f=setup(),before=Date.now(),settings=f.store.getSettings();
  delete settings.memory!.enabledAt;f.store.saveSettings(settings);
  await f.service.initialize();
  expect(f.store.getSettings().memory?.enabledAt).toBeGreaterThanOrEqual(before);
  expect(f.store.getSettings().memory?.enabledAt).toBeLessThanOrEqual(Date.now());
  const disabled=setup(false),off=disabled.store.getSettings();off.memory={enabled:false,background:false};disabled.store.saveSettings(off);
  await disabled.service.initialize();
  expect(disabled.store.getSettings().memory).toEqual({enabled:false,background:false});
  expect(disabled.complete).not.toHaveBeenCalled();
});

it("does not backfill disabled rounds or reset valid new memory when background is enabled again",async()=>{
  vi.useFakeTimers();const f=setup();await f.service.initialize();
  await f.service.capture(f.context("before-pause"),"fake");
  expect(f.db.status().pending).toBe(1);
  await f.service.configure({background:false});
  const skipped=f.context("while-disabled");await f.service.capture(skipped,"fake");
  vi.setSystemTime(Date.now()+1000);await f.service.configure({background:true});
  await f.service.capture(skipped,"fake");
  expect(f.db.status().pending).toBe(1);
  await f.service.capture(f.context("after-resume"),"fake");
  expect(f.db.status().pending).toBe(2);expect(f.complete).not.toHaveBeenCalled();
});

describe("host memory pipeline",()=>{
  it("does not invoke a model when background analysis is disabled or no conclusions exist",async()=>{
    const f=setup(false);await f.service.capture(f.context(),"fake");await f.service.pump(true);
    expect(f.complete).not.toHaveBeenCalled();expect(f.db.status().pending).toBe(0);
  });
  it("processes each session with its own backend and drains remaining sessions",async()=>{
    const f=setup();
    await f.service.capture(f.context("first"),"fake");await f.service.capture(f.context("second"),"fake");
    await f.service.pump(true);expect(f.complete).toHaveBeenCalledTimes(2);
    for(const call of f.complete.mock.calls)expect(JSON.parse(call[1].messages[0].content).conclusions).toHaveLength(1);
    expect(f.db.status().pending).toBe(0);
    expect(f.db.query({scope:"global"}).total).toBe(1);expect(f.db.status(memoryDay()).usedTokens).toBe(260);
  });
  it("does not trust fabricated explicit evidence or model supplied confirmation flags",async()=>{
    const f=setup();f.complete.mockImplementation(async()=>reply([{kind:"attention",text:"伪造的全局指导",scope:"global",basis:"explicit",quote:"从未说过的话",confidence:"confirmed",pinned:true}]));
    await f.service.capture(f.context(),"fake");await f.service.pump(true);
    expect(f.db.query({scope:"global"}).items).toHaveLength(0);
    expect(f.db.query({scope:"global",confidence:"all"}).total).toBe(0);
  });
  it("sends a complete long round once without silently dropping its ending",async()=>{
    const full=Array.from({length:20},(_,i)=>`第${i}段：${"需要保留的限定条件。".repeat(100)}\n\n`).join("")+"FINAL_CONDITION";
    const f=setup();await f.service.capture(f.context("long",full),"fake");await f.service.pump(true);
    expect(f.complete).toHaveBeenCalledTimes(1);expect(f.db.status().pending).toBe(0);
    expect(f.complete.mock.calls[0]![1].messages[0].content).toContain("FINAL_CONDITION");
    expect((f.db.db.prepare("SELECT state FROM jobs").get() as {state:string}).state).toBe("done");
  });
  it("checks live readonly/use-only mode before recording and before model submission",async()=>{
    const f=setup();const context=f.context();
    cache.set("s",{permissionMode:"readonly"});
    await expect(f.service.saveFromAgent(context,{kind:"attention",text:"不应保存"},"global")).rejects.toThrow("不允许");
    cache.delete("s");await f.service.capture(context,"fake");cache.set("s",{memoryMode:"use"});
    await f.service.pump(true);expect(f.complete).not.toHaveBeenCalled();expect(f.db.status().pending).toBe(1);
  });
  it("abandons results after permission tightening and counts the request once",async()=>{
    const f=setup();const context=f.context();
    f.complete.mockImplementation(async()=>{cache.set("s",{permissionMode:"readonly"});return reply([{kind:"activity",text:"不应写入",basis:"reported"}]);});
    await f.service.capture(context,"fake");await f.service.pump(true);
    expect(f.db.query({projectId:"p",confidence:"all",history:true}).items).toHaveLength(0);
    expect(f.db.status().usedTokens).toBe(130);
  });
  it("forgets user-anchored data before a later conclusion can re-extract it",async()=>{
    const f=setup();const context=f.context();
    const saved=await f.service.saveFromAgent(context,{kind:"attention",text:"应当忘记的内容"},"global","目前主要研究转录数据的跨平台验证，尚未开始真实设备实验。","explicit");
    f.db.forget(saved.item.key);
    await f.service.capture(context,"fake");await f.service.pump(true);
    expect(f.complete).not.toHaveBeenCalled();expect(f.db.status().pending).toBe(0);
  });
  it("preempts an in-flight background request without waiting for an uncooperative runtime",async()=>{
    const f=setup();await f.service.capture(f.context(),"fake");
    let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
    f.complete.mockImplementation(async()=>{started();return new Promise<any>(()=>{});});
    const run=f.service.pump(true);await ready;f.service.frontActivity();await run;
    expect(f.db.status().pending).toBe(1);expect(f.db.query({projectId:"p",confidence:"all"}).items).toHaveLength(0);
    expect(f.db.status().usedTokens).toBeGreaterThan(0);
  });
});

it("applies a newer grounded correction to the original key and preserves its prior revision",async()=>{
  const f=setup();
  const original=f.db.save({kind:"attention",text:"转录数据的跨平台验证尚未开始"},{source:{ref:"manual:old",type:"manual"},confirmed:true,evidenceAt:1}).item;
  f.complete.mockImplementation(async(_model:unknown,context:any)=>{
    const frame=JSON.parse(context.messages[0].content);
    return reply([{sourceRef:frame.conclusions[0].ref,kind:"attention",text:"当前重点验证跨平台转录数据",scope:"global",basis:"explicit",quote:"目前主要研究转录数据的跨平台验证，尚未开始真实设备实验。",updateKey:original.key,revision:1}]);
  });
  await f.service.capture(f.context(),"fake");await f.service.pump(true);
  expect(f.db.get(original.key)?.text).toBe("当前重点验证跨平台转录数据");
  expect(f.db.get(original.key)?.revision).toBe(2);
  expect(f.db.getRevision(original.key,1)?.text).toBe("转录数据的跨平台验证尚未开始");
  expect(f.db.getRevision(original.key,1)?.sources[0]?.ref).toBe("manual:old");
});

it("loads the selected lightweight profile without running a topic query each turn",async()=>{
  const f=setup(false);await f.service.initialize();
  const first=f.db.save({kind:"attention",text:"当前关注跨平台验证，实机实验尚未开始",tags:["communication"]},{source:{ref:"manual:language",type:"manual"},confirmed:true,pinned:true}).item;
  const second=f.db.save({kind:"background",text:"用户研究五线谱识别"},{source:{ref:"manual:research",type:"manual"},confirmed:true,pinned:true}).item;
  // 文件是注入的正文来源：绕过 service 直接写库的条目，需要同样落到文档。
  const doc=path.join(f.root,"memory","MEMORY.md");
  upsertDocumentEntry(doc,{key:first.key,text:first.text,dbRevision:first.revision});
  upsertDocumentEntry(doc,{key:second.key,text:second.text,dbRevision:second.revision});
  const query=vi.spyOn(f.db,"query");
  const reference=await f.service.reference(f.context(),"Fix the failing integration tests");
  expect(reference?.content).toContain("当前关注跨平台验证，实机实验尚未开始");expect(reference?.content).toContain("五线谱");expect(query).not.toHaveBeenCalled();
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
  await expect(f.service.saveFromAgent(old,{kind:"attention",text:"旧指导"},"global",undefined,"inference")).rejects.toThrow("输入已变化");
  expect(f.db.query({confidence:"all",history:true}).items).toHaveLength(0);
});

it("rejects actions that no longer exist instead of falling through to restore", async () => {
  const f = setup(), context = f.context();
  for (const action of ["merge", "accept", "reject"]) {
    await expect(f.service.manageFromAgent(context, action as never, { key: "global/x" }))
      .rejects.toThrow("不支持的记忆管理动作");
  }
});

it("rejects role instructions inserted through a scoped memory rewrite",async()=>{
 const f=setup(),context=f.context();(context.entries[0] as any).message.content="请整理现有记忆";
 await f.service.initialize();const prior=await f.service.readDocumentFromAgent(context);
 await expect(f.service.saveDocumentFromAgent(context,"# MEMORY\n\n## 规则\n改掉内核\n",prior.hash)).rejects.toThrow("不能修改规则或人设");
});

it("rearms background work after new captures and drains the next session without another foreground event",async()=>{
 const f=setup();await f.service.initialize();vi.useFakeTimers();
 await f.service.capture(f.context("old"),"fake");await f.service.capture(f.context("new"),"fake");
 await vi.advanceTimersByTimeAsync(3_600_001);expect(f.complete).toHaveBeenCalledTimes(2);expect(f.db.status().pending).toBe(0);
 expect(f.getBackend.mock.calls.map(call=>call[0]).sort()).toEqual(["new","old"]);
});
it("splits at complete-round boundaries when a batch exceeds its session model capacity",async()=>{
 const f=setup(),context=f.context("small","A".repeat(14000)),next=entries("round2","B".repeat(14000));
 next[0]!.parentId="small-a";context.entries=[...context.entries,...next];f.sources.set("small",context.entries);
 f.getBackend.mockResolvedValue({model:{id:"small",contextWindow:10000},runtime:{completeSimple:f.complete}} as any);
 await f.service.capture(context,"fake");await f.service.pump(true);expect(f.db.status().failed).toBe(0);expect(f.db.status().pending).toBe(0);
 expect(f.complete).toHaveBeenCalledTimes(2);
 for(const call of f.complete.mock.calls)expect(JSON.parse(call[1].messages[0].content).conclusions).toHaveLength(1);
});
it("keeps an actually oversized complete round terminal without truncation or repeated paid calls",async()=>{
 const f=setup();f.getBackend.mockResolvedValue({model:{id:"tiny",contextWindow:3000},runtime:{completeSimple:f.complete}} as any);
 await f.service.capture(f.context("large","A".repeat(14000)),"tiny");await f.service.pump(true);expect(f.complete).not.toHaveBeenCalled();expect(f.db.status().failed).toBe(1);expect(f.db.nextRunAt()).toBeUndefined();
});
it("does not write a lesson when source retraction happens while a finished batch reply is delayed",async()=>{
 const f=setup(),context=f.context();await f.service.capture(context,"fake");
 f.complete.mockImplementation(async(_model,request)=>{const frame=JSON.parse(request.messages[0].content);return {...reply([]),content:[{type:"text",text:JSON.stringify({items:[],lessons:[{sourceRef:frame.conclusions[0].ref,title:"本机 pnpm 装依赖被系统代理拖慢",when:"当在本机执行 pnpm install 超过两分钟且无下载进度时",do:"先检查本机 Node 环境变量与代理，再尝试更换 npm 安装"}]})}]};});
 const port=(f.service as any).port as MemoryPort,original=port.call.bind(port);let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});
 vi.spyOn(port,"call").mockImplementation((async(method:string,...args:unknown[])=>{const result=await (original as any)(method,...args);if(method==="finishBatch"){entered();await gate;}return result;}) as any);
 const running=f.service.pump(true);await ready;f.sources.set("s",[]);await f.service.sourceChanged("s",context.projectPath,[]);release();await running;expect(fs.existsSync(path.join(f.root,"experiences","index.json"))).toBe(false);
});

it("discards one invalid extracted item without retrying or losing a valid item from the same round",async()=>{
 const f=setup();f.complete.mockImplementation(async(_model,request)=>{const frame=JSON.parse(request.messages[0].content),base={sourceRef:frame.conclusions[0].ref,kind:"attention",scope:"global",basis:"explicit",quote:"目前主要研究转录数据的跨平台验证，尚未开始真实设备实验。"};return reply([{...base,text:"x".repeat(601)},{...base,text:"当前关注跨平台验证，实机实验尚未开始"}]);});
 await f.service.capture(f.context(),"fake");await f.service.pump(true);expect(f.db.query().items.map(item=>item.text)).toEqual(["当前关注跨平台验证，实机实验尚未开始"]);expect(f.db.status().pending).toBe(0);expect(f.db.status().failed).toBe(0);expect(f.complete).toHaveBeenCalledOnce();
});

it("applies explicit expiry without a background model call when automatic collection is off",async()=>{
 const f=setup(false);await f.service.initialize();const item=f.db.save({kind:"attention",text:"EXPIRED_TEMPORARY_MATTER",expiresAt:Date.now()-1},{confirmed:true,source:{type:"manual",ref:"expire"}}).item;
 const reference=await f.service.reference(f.context(),"现在的事项");expect(reference?.content ?? "").not.toContain("EXPIRED_TEMPORARY_MATTER");expect(f.db.get(item.key)?.lifecycle).toBe("archived");expect(fs.readFileSync(path.join(f.root,"memory","MEMORY.md"),"utf8")).not.toContain("EXPIRED_TEMPORARY_MATTER");expect(f.complete).not.toHaveBeenCalled();
});

it("rebuilds a failed runtime worker once for concurrent ordinary accesses without changing switches",async()=>{
 const f=setup();await f.service.initialize();const service=f.service as any,original=service.port as MemoryPort;let unavailable=true;const close=vi.fn(async()=>{});
 service.port={call:original.call.bind(original),get unavailable(){return unavailable;},close};const replacement={call:original.call.bind(original)} as MemoryPort;const create=vi.fn(()=>replacement);service.deps.createPort=create;
 await Promise.all([f.service.readDatabase(),f.service.state()]);expect(create).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();expect(f.service.settings()).toMatchObject({enabled:true,background:true});
 unavailable=false;await f.service.capture(f.context(),"fake");await f.service.pump(true);expect(f.complete).toHaveBeenCalledOnce();
});
it("bounds repeated worker recovery failures rather than respawning on every state read",async()=>{
 const f=setup();await f.service.initialize();const service=f.service as any,original=service.port as MemoryPort;service.port={...original,call:original.call.bind(original),unavailable:true,close:async()=>{}};
 const create=vi.fn(()=>({call:async()=>{throw new Error("synthetic worker failure");},unavailable:true,close:async()=>{}}));service.deps.createPort=create;
 await expect(f.service.readDatabase()).rejects.toThrow("synthetic worker failure");await Promise.all([f.service.state(),f.service.state()]);expect(create).toHaveBeenCalledOnce();
 let now=Date.now();const clock=vi.spyOn(Date,"now").mockImplementation(()=>now);
 try{for(let i=0;i<2;i++){now+=31000;await expect(f.service.readDatabase()).rejects.toThrow("synthetic worker failure");}now+=31000;await expect(f.service.readDatabase()).rejects.toThrow("多次启动失败");expect(create).toHaveBeenCalledTimes(3);}finally{clock.mockRestore();}
});
it("does not deliver a prepared default reference after the user switches memory off",async()=>{
 const f=setup(false);await f.service.initialize();f.db.save({kind:"attention",text:"DO_NOT_DELIVER_AFTER_OFF"},{confirmed:true,source:{type:"manual",ref:"off"}});
 const port=(f.service as any).port as MemoryPort,original=port.call.bind(port);let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 vi.spyOn(port,"call").mockImplementation((async(method:string,...args:unknown[])=>{const result=await (original as any)(method,...args);if(method==="lookupReferences"){entered();await gate;}return result;}) as any);
 const reference=f.service.reference(f.context(),"下一步");await ready;await f.service.configure({enabled:false});release();expect(await reference).toBeUndefined();
});

it("does not seed an experience directory instruction into fact memory",async()=>{
 const f=setup(false);await f.service.initialize();const file=path.join(f.root,"memory","MEMORY.md");expect(fs.existsSync(file)?fs.readFileSync(file,"utf8"):"").not.toContain("experiences");
});

import {withSessionCreationLock} from "../session-permission-gate";
it("rejects stale observed evidence changed after parsing while waiting for the commit lock",async()=>{
 const f=setup(),c=f.context();
 const stamp=Date.now();const progress={type:"message",id:"progress",parentId:"s-u",timestamp:new Date(stamp).toISOString(),message:{role:"assistant",stopReason:"toolUse",content:[{type:"toolCall",id:"read-call",name:"read",arguments:{path:"fixture.txt"}}],timestamp:stamp}};
 const tool={type:"message",id:"verification",parentId:"progress",timestamp:new Date(stamp).toISOString(),message:{role:"toolResult",toolCallId:"read-call",toolName:"read",isError:false,content:[{type:"text",text:"已验证条件：热进程保留旧值，新进程读取新值。"}],timestamp:stamp}};
 (c.entries[1] as any).parentId="verification";c.entries=[c.entries[0]!,progress,tool,c.entries[1]!];f.sources.set("s",c.entries);await f.service.capture(c,"fake");
 let modelReady!:()=>void,deliver!:(v:any)=>void,parsed!:()=>void;
 const ready=new Promise<void>(r=>modelReady=r),parsedReady=new Promise<void>(r=>parsed=r);
 f.complete.mockImplementation(async()=>{modelReady();return new Promise<any>(r=>deliver=r);});
 const run=f.service.pump(true);await ready;
 let held!:()=>void,release!:()=>void;const lockReady=new Promise<void>(r=>held=r),gate=new Promise<void>(r=>release=r);
 const hold=withSessionCreationLock(async()=>{held();await gate;});await lockReady;
 const observed={sourceRef:"conclusion:s:s-a",kind:"activity",text:"已验证：热进程保留旧值，新进程读取新值",scope:"project",basis:"observed",evidenceEntryIds:["verification"]};
 deliver({role:"assistant",get content(){parsed();return [{type:"text",text:JSON.stringify({items:[observed]})}];},stopReason:"stop",usage});await parsedReady;
 const changed=structuredClone(c.entries);(changed[2] as any).message.content=[{type:"text",text:"原对照无效，未验证上述条件。"}];f.sources.set("s",changed);
 await f.service.sourceChanged("s",c.projectPath,changed);release();await hold;await run;
 const rows=f.db.query({projectId:"p",confidence:"all",history:true}).items;
 expect(rows).toHaveLength(0);

});
import {createMemoryTool} from "../tools/memory-tool";
it("blocks child global edits at the tool boundary",async()=>{
 const f=setup();await f.service.initialize();
 const global=f.db.save({kind:"attention",text:"全局原始事项"},{confirmed:true,source:{type:"manual",ref:"global-fixture"}}).item;
 const base=f.context("child");(base.entries[0] as any).message.content="请修改本项目记忆，保留必要条件。";
 const child={...base,limited:true,permissionSessionId:"parent",readOnly:false};
 const tool=await createMemoryTool(f.service,()=>child);
 await expect(tool.execute("child-edit-call",{action:"edit",key:global.key,revision:global.revision,kind:"attention",text:"子任务改写的全局事项",quote:"请修改本项目记忆"},new AbortController().signal,undefined,{} as never)).rejects.toThrow("执行Agent");
 expect(f.db.get(global.key)?.text).toBe("全局原始事项");
});

it("keeps an interrupted hourly pass due and resumes it at foreground idle",async()=>{
 const f=setup();await f.service.initialize();vi.useFakeTimers();await f.service.capture(f.context(),"fake");
 const before=f.db.metadata<any>("routineCheckpoint");vi.setSystemTime(before.nextDueAt);
 let started!:()=>void;const ready=new Promise<void>(r=>started=r);f.complete.mockImplementationOnce(async()=>{started();return new Promise<any>(()=>{});});
 const run=f.service.pump();await ready;f.service.frontActivity();await run;
 expect(f.db.metadata<any>("routineCheckpoint")).toEqual(before);
 const job=f.db.db.prepare("SELECT retry_at FROM jobs").get() as any;expect(job.retry_at).toBeLessThanOrEqual(Date.now());
 f.service.frontIdle();await vi.advanceTimersByTimeAsync(2);expect(f.complete).toHaveBeenCalledTimes(2);expect(f.db.status().pending).toBe(0);expect(f.db.metadata<any>("routineCheckpoint").lastRunAt).toBeGreaterThanOrEqual(before.nextDueAt);
});

it("refuses child maintenance edits even when a task asks it to modify global memory",async()=>{const f=setup();await f.service.initialize();const saved=f.db.save({kind:"background",text:"GLOBAL_ORIGINAL"},{confirmed:true,source:{type:"manual",ref:"global"}}).item,c=f.context();c.limited=true;(c.entries[0] as any).message.content="请编辑全局记忆";await expect(f.service.manageFromAgent(c,"edit",{key:saved.key,revision:saved.revision,input:{kind:"background",text:"CHILD_OVERRIDE"}})).rejects.toThrow("执行Agent");expect(f.db.get(saved.key)?.text).toBe("GLOBAL_ORIGINAL");});

it.each([false,true])("queues actual child rounds using the owner session model and permissions, parent becomes readonly=%s",async(tighten)=>{
 const f=setup(),parent=f.context("parent"),child=f.context("child");
 const stamp=Date.now();(parent.entries[1] as any).message.content=[{type:"toolCall",id:"task-call",name:"task",arguments:{prompt:"verify condition"}}];
 const call=await import("./source").then(module=>module.evidenceMessages(parent.entries,true)).then(messages=>messages.find(message=>message.entryId==="toolcall:task-call")!);
 const tool={type:"message",id:"verified",parentId:"child-u",timestamp:new Date(stamp).toISOString(),message:{role:"toolResult",toolCallId:"read",toolName:"read",isError:false,content:[{type:"text",text:"受控对照已完成，测试模块的两种进程读取结果不同"}],timestamp:stamp}};
 (child.entries[1] as any).parentId="verified";child.entries=[child.entries[0]!,tool,child.entries[1]!];f.sources.set("child",child.entries);
 Object.assign(child,{limited:true,permissionSessionId:"parent",ownerEntryId:call.entryId,ownerHash:call.hash,ownerMessageEntryId:call.messageEntryId,ownerSessionFile:"owner.jsonl"});
 f.complete.mockImplementation(async(_model:unknown,context:any)=>{const frame=JSON.parse(context.messages[0].content);return reply([{sourceRef:frame.conclusions[0].ref,kind:"activity",text:"对照验证了测试模块两种进程读取结果不同",scope:"global",basis:"observed",evidenceEntryIds:["verified"]}]);});
 await f.service.capture(child,"child.jsonl");expect(f.db.status().pending).toBe(1);
 if(tighten)cache.set("parent",{permissionMode:"readonly"});await f.service.pump(true);
 const rows=f.db.query({projectId:"p",history:true,confidence:"all"}).items;
 if(tighten){expect(rows).toHaveLength(0);expect(f.complete).not.toHaveBeenCalled();}
 else{expect(rows).toHaveLength(1);expect(rows[0]?.scope).toBe("project");expect(rows[0]?.sources[0]?.ownerSessionId).toBe("parent");expect(f.getBackend).toHaveBeenCalledWith("parent");}
});

async function childFixture(){
 const f=setup(),parent=f.context("parent"),child=f.context("child");
 (parent.entries[1] as any).message.content=[{type:"toolCall",id:"task-call",name:"task",arguments:{prompt:"verify condition"}}];
 const call=(await (await import("./source")).evidenceMessages(parent.entries,true)).find(message=>message.entryId==="toolcall:task-call")!;
 const stamp=Date.now(),tool={type:"message",id:"verified",parentId:"child-u",timestamp:new Date(stamp).toISOString(),message:{role:"toolResult",toolCallId:"read",toolName:"read",isError:false,content:[{type:"text",text:"受控对照已完成，测试模块的两种进程读取结果不同"}],timestamp:stamp}};
 (child.entries[1] as any).parentId="verified";child.entries=[child.entries[0]!,tool,child.entries[1]!];f.sources.set("child",child.entries);
 const parentFile=path.join(f.root,"owner.jsonl"),childFile=path.join(f.root,"child.jsonl");
 const write=(file:string,id:string,data:unknown[])=>fs.writeFileSync(file,[{type:"session",version:3,id,timestamp:new Date().toISOString(),cwd:child.projectPath},...data].map(row=>JSON.stringify(row)).join("\n")+"\n");
 write(parentFile,"parent",parent.entries);write(childFile,"child",child.entries);
 Object.assign(child,{limited:true,permissionSessionId:"parent",ownerEntryId:call.entryId,ownerHash:call.hash,ownerMessageEntryId:call.messageEntryId,ownerSessionFile:parentFile,sessionFile:childFile});
 f.complete.mockImplementation(async(_model:unknown,context:any)=>{const frame=JSON.parse(context.messages[0].content);return reply([{sourceRef:frame.conclusions[0].ref,kind:"activity",text:"对照验证了测试模块两种进程读取结果不同",scope:"global",basis:"observed",evidenceEntryIds:["verified"]}]);});
 return {...f,parent,child,childFile};
}
it("recovers an exhausted legacy child job offline using its main session's model",async()=>{
 const f=await childFixture();await f.service.capture(f.child,f.childFile);
 const stored=f.db.db.prepare("SELECT ref,json FROM jobs").get() as {ref:string;json:string};
 const job=JSON.parse(stored.json);job.execution.model={id:"removed-child-model",provider:"old-supplier"};
 job.attempts=3;job.revived=3;job.error="该会话未配置后台分析可用的模型";
 f.db.db.prepare("UPDATE jobs SET state='failed',retry_at=0,json=? WHERE ref=?").run(JSON.stringify(job),stored.ref);
 f.sources.clear();await f.service.pump(true);
 const rows=f.db.query({projectId:"p",confidence:"all",history:true}).items;expect(rows).toHaveLength(1);expect(rows[0]?.scope).toBe("project");expect(f.getBackend).toHaveBeenCalledWith("parent");
 expect(f.db.status().failed).toBe(0);expect((await f.service.state()).status.error).toBeUndefined();
});
it("defers an unavailable main model without using a retry or sending a request",async()=>{
 const f=setup();await f.service.initialize();await f.service.capture(f.context("model-wait"),"fixture.jsonl");
 f.changed.mockClear();
 f.getBackend.mockResolvedValueOnce({model:null,runtime:{completeSimple:f.complete}});
 await f.service.pump(true);
 const row=f.db.db.prepare("SELECT state,json,retry_at FROM jobs").get() as {state:string;json:string;retry_at:number};
 expect(row.state).toBe("pending");expect(JSON.parse(row.json).attempts).toBe(0);expect(row.retry_at).toBeGreaterThan(Date.now());
 expect(f.complete).not.toHaveBeenCalled();
 expect(f.changed).toHaveBeenCalled();expect((await f.service.state()).status.error).toContain("没有可用模型");
 f.db.db.prepare("UPDATE jobs SET retry_at=0").run();await f.service.pump(true);
 expect(f.complete).toHaveBeenCalledOnce();expect(f.db.status().pending).toBe(0);
});
it("releases the reservation without sending to an outdated supplier", async () => {
  const f = setup();
  await f.service.initialize();
  await f.service.capture(f.context("supplier-switch"), "fixture.jsonl");
  let supplier = "first";
  f.getBackend.mockImplementation(async () => {
    const selected = supplier;
    return { model: { id: selected, provider: selected, contextWindow: 100000 }, runtime: { completeSimple: f.complete }, isCurrent: () => selected === supplier };
  });
  const call = f.port.call.bind(f.port);
  let enter!: () => void, resume!: () => void;
  const reserved = new Promise<void>(resolve => { enter = resolve; });
  const waiting = new Promise<void>(resolve => { resume = resolve; });
  const reserve = vi.spyOn(f.port, "call").mockImplementation((async (method: string, ...args: any[]) => {
    if (method === "reserveUsage") { enter(); await waiting; }
    return (call as any)(method, ...args);
  }) as typeof f.port.call);
  const run = f.service.pump(true);
  await reserved;
  supplier = "second";
  resume();
  await run;
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.db.status()).toMatchObject({ pending: 1, usedTokens: 0 });
  reserve.mockRestore();
  await f.service.pump(true);
  expect(f.complete).toHaveBeenCalledOnce();
  expect(f.complete.mock.calls[0]?.[0]).toMatchObject({ provider: "second" });
});
it.each(["credentials", "route"] as const)("adopts results after only credentials refresh, discards after a route change (%s)", async change => {
  const f = setup();
  await f.service.initialize();
  await f.service.capture(f.context("revision-change"), "fixture.jsonl");
  let credentials = 0, route = 0;
  f.getBackend.mockResolvedValueOnce({
    model: { id: "fake", contextWindow: 100000 },
    runtime: { completeSimple: (model: unknown, context: unknown) => {
      if (change === "route") route++;
      else credentials++;
      return f.complete(model, context);
    } },
    isCurrent: (beforeRequest: boolean) => route === 0 && (!beforeRequest || credentials === 0),
  });
  await f.service.pump(true);
  expect(f.complete).toHaveBeenCalledOnce();
  expect(f.db.status().pending).toBe(change === "route" ? 1 : 0);
  expect(f.db.query({ confidence: "all" }).items).toHaveLength(change === "route" ? 0 : 1);
});
it("does not enqueue or adopt a child cancelled during asynchronous source validation",async()=>{
 const f=await childFixture(),controller=new AbortController();(f.child as any).signal=controller.signal;
 const port=(f.service as any).port as MemoryPort,original=port.call.bind(port);let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 vi.spyOn(port,"call").mockImplementation((async(method:string,...args:unknown[])=>{const result=await (original as any)(method,...args);if(method==="invalidateSession"&&args[0]==="child"){entered();await gate;}return result;}) as any);
 const capture=f.service.capture(f.child,f.childFile);await ready;controller.abort(new Error("child task cancelled"));release();await capture;
 expect(f.db.status().pending).toBe(0);await f.service.pump(true);const rows=f.db.query({projectId:"p",confidence:"all",history:true}).items;
 expect(rows).toHaveLength(0);expect(f.complete).not.toHaveBeenCalled();
});
