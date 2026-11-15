import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Store } from "../store";
import type { MemoryPort } from "./client";
import type { MemorySettings } from "../../../shared/memory";
import { MemoryDatabase } from "./database";
import { migrateExperiences } from "./migration";
import { adoptDocuments,documentStatus,generateDocuments,previewDocuments } from "./documents";
import { MemoryService,type MemorySessionContext } from "./service";
import { memoryDay } from "./codec";
import {writeSummary,readSummary,type SummaryProject} from "./summary";
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
  let settings={memory:{enabled:true,background,dailyTokens:100_000,enabledAt:0} as MemorySettings};
  const store={getDataDir:()=>root,getSettings:()=>settings,saveSettings:(value:typeof settings)=>{settings=value;},getProjects:()=>[{id:"p",name:"测试项目",path:path.join(root,"project"),createdAt:new Date(0).toISOString()}]} as unknown as Store;
  const sources=new Map<string,unknown[]>();
  const complete=vi.fn(async(_model:unknown,context:any)=>{
    const payload=JSON.parse(context.messages[0].content);
    return reply(payload.conclusions.map((source:any)=>({sourceRef:source.ref,kind:"preference",text:"以后使用中文回答",scope:"global",basis:"explicit",quote:"以后所有回答都使用中文，并保留重要决策的理由。"})));
  });
  const extra={writeSummary:(projects:SummaryProject[],force=false)=>writeSummary(db,path.join(root,"memory","MEMORY.md"),projects,force),readSummary:(projects:SummaryProject[],id?:string)=>readSummary(db,path.join(root,"memory","MEMORY.md"),projects,id),readSource:readConclusionEntries,migrate:(directory:string,projectId?:string)=>migrateExperiences(db,directory,path.join(root,"backups"),projectId),
    documentStatus:(id:string)=>documentStatus(db,id),generateDocuments:(id:string,project:string)=>generateDocuments(db,id,project),previewDocuments,
    adoptDocuments:(id:string,project:string,directory:string,hash:string)=>adoptDocuments(db,id,project,directory,hash,path.join(root,"backups"))};
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
  f.db.save({kind:"preference",text:"以后使用中文回答",tags:["communication"]},{source:{ref:"manual:language",type:"manual"},confirmed:true,pinned:true});
  f.db.save({kind:"background",text:"用户研究五线谱识别"},{source:{ref:"manual:research",type:"manual"},confirmed:true,pinned:true});
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

it("automatically adopts only a new empty-project choice, preserving any first-run handwritten logs",async()=>{
  const f=setup(false),projectPath=path.join(f.root,"project"),docs=path.join(projectPath,"docs");
  fs.mkdirSync(path.join(docs,"开发记录"),{recursive:true});
  const original="首轮已有记录\n\n[原有日期](开发记录/2026-01-01.md)\n";
  fs.writeFileSync(path.join(docs,"开发记录.md"),original);fs.writeFileSync(path.join(docs,"开发记录","2026-01-01.md"),"原有日期明细");
  (f.service as any).store.getProjects=()=>[{id:"p",path:projectPath,createdAt:new Date().toISOString(),autoMemoryRecords:true}];
  await f.service.saveFromAgent(f.context(),{kind:"decision",text:"决定保留完整理由"},"project","以后所有回答都使用中文，并保留重要决策的理由。","explicit");
  const state=documentStatus(f.db,"p")!;
  expect(state.error).toBeUndefined();expect(path.dirname(state.legacy!)).toBe(".");
  expect(fs.readFileSync(path.join(docs,state.legacy!),"utf8")).toBe(original);
  expect(fs.readFileSync(path.join(docs,"开发记录","2026-01-01.md"),"utf8")).toBe("原有日期明细");
});

it("resumes a closed chat from only its targeted conclusion and user evidence",async()=>{
  const f=setup(),context=f.context(),file=path.join(f.root,"session.jsonl");
  fs.writeFileSync(file,[{type:"session",version:3,id:"s",cwd:context.projectPath},...context.entries].map(value=>JSON.stringify(value)).join("\n")+"\n");
  await f.service.capture(context,file);f.sources.clear();await f.service.pump(true);
  expect(f.complete).toHaveBeenCalledTimes(1);expect(f.db.status().pending).toBe(0);
  expect(f.db.query({scope:"global"}).items).toHaveLength(1);
});
it("retries failed new conclusions only on an explicit request and does not re-run completed work",async()=>{
  const f=setup();f.complete.mockImplementation(async()=>({role:"assistant",content:[{type:"text",text:"not-json"}],stopReason:"stop",usage}));
  await f.service.capture(f.context(),"fake");
  for(let attempt=0;attempt<3;attempt++){f.db.db.exec("UPDATE jobs SET retry_at=0");await f.service.pump(true);}
  expect(f.db.status().failed).toBe(1);
  f.complete.mockImplementation(async()=>reply([]));await f.service.requestAnalysis();
  expect(f.db.status().failed).toBe(0);expect(f.db.status().pending).toBe(0);expect(f.complete).toHaveBeenCalledTimes(4);
  await f.service.requestAnalysis();expect(f.complete).toHaveBeenCalledTimes(4);
  expect((await f.service.state()).status.error).toBeUndefined();
});
it("preserves old experience data when importing a project after startup, without enabling analysis",async()=>{
  const f=setup(false);await f.service.initialize();await f.service.configure({enabled:false});
  const project=path.join(f.root,"project"),dir=path.join(project,".easymint","experiences");fs.mkdirSync(dir,{recursive:true});
  const original=Buffer.from("# 原经验\r\n\r\n完整的旧规则\r\n");fs.writeFileSync(path.join(dir,"old.md"),original);
  fs.writeFileSync(path.join(dir,"index.json"),JSON.stringify({items:[{id:"import-id",title:"旧约定",file:"old.md",kind:"convention"}]}));
  await f.service.importProject("p",project);
  expect(f.db.get("import-id","p")?.details).toBe(original.toString());expect(fs.readFileSync(path.join(dir,"old.md"))).toEqual(original);
  expect(f.service.settings().enabled).toBe(false);expect(f.complete).not.toHaveBeenCalled();
});

it("does not mistake a request to retain information for permission to forget it",async()=>{
  const f=setup(false);await f.service.initialize();const context=f.context();
  (context.entries[0] as any).message.content="千万别忘记我的回答偏好。";
  const saved=f.db.save({kind:"preference",text:"长期保留的偏好"},{source:{ref:"manual:retain",type:"manual"},confirmed:true}).item;
  await expect(f.service.forgetFromAgent(context,saved.key,"千万别忘记我的回答偏好。")).rejects.toThrow("明确原话");
  expect(f.db.get(saved.key)?.text).toBe("长期保留的偏好");
});


it.each(["readonly","use","off"])("invalidates cross-chat memories immediately after a human source change in %s mode",async(mode)=>{
  const f=setup(),a=f.context("a");await f.service.capture(a,"fake");await f.service.pump(true);
  expect((await f.service.reference(f.context("b"),"语言偏好"))?.content).toContain("以后使用中文回答");
  await f.service.capture(f.context("queued"),"fake");
  cache.set("a",mode==="readonly"?{permissionMode:"readonly"}:{memoryMode:mode as "use"|"off"});
  const changed=[...a.entries,{type:"context_edit",id:"drop",parentId:"a-a",timestamp:new Date().toISOString(),targetId:"a-u",replacement:null}];
  f.sources.set("a",changed);await f.service.sourceChanged("a",a.projectPath,changed);
  expect(f.db.query({scope:"global"}).items).toHaveLength(0);
  expect(f.db.query({scope:"global",state:"candidate"}).items).toHaveLength(1);
  expect((await f.service.reference(f.context("b"),"语言偏好"))?.content ?? "").not.toContain("以后使用中文回答");
  expect(f.complete).toHaveBeenCalledTimes(1);
});
it("skips pending and running jobs from a withdrawn conclusion",async()=>{
  const f=setup(),a=f.context("a");await f.service.capture(a,"fake");f.db.claim();
  await f.service.sourceChanged("a",a.projectPath,[]);
  expect(f.db.db.prepare("SELECT state FROM jobs").get()).toEqual({state:"skipped"});
});
it("settles an interrupted request and releases its lease before close returns",async()=>{
  const f=setup();await f.service.capture(f.context(),"fake");
  let start!:()=>void;const ready=new Promise<void>(resolve=>{start=resolve;});
  f.complete.mockImplementation(async()=>{start();return new Promise<any>(()=>{});});
  const run=f.service.pump(true);await ready;
  expect(f.db.status().usedTokens).toBeGreaterThan(0);
  await f.service.close();await run;
  expect(f.db.status().usedTokens).toBeGreaterThan(0);
  expect(f.db.db.prepare("SELECT state,lease_until FROM jobs").get()).toEqual({state:"pending",lease_until:0});
});

it("preserves confirmation and sources during authorized wording maintenance, and requires explicit candidate acceptance",async()=>{
  const f=setup(false),context=f.context();
  (context.entries[0] as any).message.content="请整理记忆，合并重复偏好，修正表达。";
  const first=f.db.save({kind:"preference",text:"使用简洁中文"},{source:{type:"manual",ref:"manual:first"},confirmed:true}).item;
  const second=f.db.save({kind:"preference",text:"中文回答简洁些"},{source:{type:"manual",ref:"manual:second"},confirmed:true}).item;
  const merged=await f.service.manageFromAgent(context,"merge",{entries:[{key:first.key,revision:1},{key:second.key,revision:1}],input:{kind:"preference",text:"使用简洁的中文回答"},quote:"请整理记忆，合并重复偏好，修正表达。"});
  expect(merged.item.state).toBe("confirmed");expect(merged.item.sources.map(s=>s.ref)).toEqual(["manual:first","manual:second"]);
  const candidate=f.db.save({kind:"preference",text:"推导出来的偏好"},{source:{type:"session",ref:"infer"},confirmed:false}).item;
  await expect(f.service.manageFromAgent(context,"accept",{key:candidate.key,revision:1,quote:"请整理记忆，合并重复偏好，修正表达。"})).rejects.toThrow("明确选择");
  (context.entries[0] as any).message.content="请确认接受这条候选记忆。";
  const accepted=await f.service.manageFromAgent(context,"accept",{key:candidate.key,revision:1,quote:"请确认接受这条候选记忆。"});
  expect(accepted.item.state).toBe("confirmed");
});
it("only inspects in read-only or inspection-only requests, and does not turn maintenance into a new fact",async()=>{
  const f=setup(false),context=f.context();(context.entries[0] as any).message.content="只检查这些记忆，先别改。";
  const item=f.db.save({kind:"preference",text:"保留的偏好"},{source:{type:"manual",ref:"manual:original"},confirmed:true}).item;
  await expect(f.service.manageFromAgent(context,"archive",{key:item.key,revision:1,quote:"只检查这些记忆，先别改。"})).rejects.toThrow();
  (context.entries[0] as any).message.content="请把这条记忆收进历史。";cache.set("s",{permissionMode:"readonly"});
  await expect(f.service.manageFromAgent(context,"archive",{key:item.key,revision:1,quote:"请把这条记忆收进历史。"})).rejects.toThrow("不允许");
  expect(f.db.get(item.key)?.revision).toBe(1);
});
it("reads targeted source text instead of expanding a summary into supposed quotations",async()=>{
  const f=setup(false),context=f.context();
  const source=f.db.save({kind:"preference",text:"中文回答"},{source:{type:"session",ref:"source:u",sessionId:"s",entryId:"s-u",projectId:"p"},confirmed:true}).item;
  expect(await f.service.evidence(context,source)).toContain("以后所有回答都使用中文");
  source.sources[0]!.deleted=true;
  await expect(f.service.evidence(context,source)).rejects.toThrow("编造原话");
});
it("requires a named cross-project request before opening another project's details",async()=>{
  const f=setup(false),context=f.context();
  (f.service as any).store.getProjects=()=>[{id:"p",name:"当前项目",path:context.projectPath},{id:"other",name:"另一个项目",path:"/synthetic/other"}];
  await expect(f.service.selectedProject(context,"other")).rejects.toThrow("明确指定");
  (context.entries[0] as any).message.content="查一下另一个项目之前的决定。";
  expect((await f.service.selectedProject(context,"other"))?.id).toBe("other");
});

it.each(["不要整理记忆，我只是在描述整理记忆功能。","我确认仍偏好中文回答，但不要整理记忆。"])("does not authorize maintenance from a quoted substring of a denial: %s",async text=>{
 const f=setup(false),context=f.context();(context.entries[0] as {message:{content:string}}).message.content=text;
 const item=f.db.save({kind:"preference",text:"原有事实"},{confirmed:true,source:{type:"manual",ref:"base"}}).item;
 expect(await f.service.maintenanceAllowed(context,"整理记忆")).toBe(false);
 await expect(f.service.manageFromAgent(context,"archive",{key:item.key,revision:1,quote:"整理记忆"})).rejects.toThrow();
 expect(f.db.get(item.key)?.lifecycle).toBe("active");
});
it("restores a merged original under its original ID while preserving the merged record",async()=>{
 const f=setup(false),context=f.context();(context.entries[0] as {message:{content:string}}).message.content="请恢复这条记忆。";
 const a=f.db.save({kind:"preference",text:"简洁中文"},{source:{type:"manual",ref:"a"},confirmed:true}).item;
 const b=f.db.save({kind:"preference",text:"中文简洁"},{source:{type:"manual",ref:"b"},confirmed:true}).item;
 f.db.merge([{key:a.key,revision:1},{key:b.key,revision:1}],undefined,{kind:"preference",text:"简洁地使用中文"});
 const result=await f.service.manageFromAgent(context,"restore",{key:b.key,revision:2,quote:"请恢复这条记忆。"});
 expect(result.item.key).toBe(b.key);expect(result.item.mergedInto).toBeUndefined();expect(f.db.get(a.key)).toBeDefined();
});
it("reports a committed write separately from a failed summary refresh and clears the warning after recovery",async()=>{
 const f=setup(false),context=f.context();fs.mkdirSync(path.join(f.root,"memory","MEMORY.md"));
 const result=await f.service.saveFromAgent(context,{kind:"preference",text:"使用中文"},"global","以后所有回答都使用中文，并保留重要决策的理由。","explicit");
 expect(result.item.state).toBe("confirmed");expect(result.warning).toContain("摘要待刷新");
 fs.rmdirSync(path.join(f.root,"memory","MEMORY.md"));
 const fixed=await f.service.saveFromAgent(context,{kind:"preference",text:"使用中文"},"global","以后所有回答都使用中文，并保留重要决策的理由。","explicit");
 expect(fixed.warning).toBeUndefined();
});
it("allows a bounded inspection task to page summaries without authorizing maintenance writes",async()=>{
 const f=setup(false),context=f.context();(context.entries[0] as {message:{content:string}}).message.content="请检查所有记忆，先别改。";
 expect(await f.service.maintenanceAllowed(context,"请检查所有记忆",true)).toBe(true);
 expect(await f.service.maintenanceAllowed(context,"请检查所有记忆")).toBe(false);
});
it("does not lift the read budget for a denied inspection by quoting only its positive substring",async()=>{
 const f=setup(false),context=f.context();(context.entries[0] as {message:{content:string}}).message.content="不要检查所有记忆。";
 expect(await f.service.maintenanceAllowed(context,"检查所有记忆",true)).toBe(false);
});
it("exposes historical timestamps, reasons and matched revisions through the registered memory tool",async()=>{
 const f=setup(false),context=f.context();await f.service.initialize();
 const when=Date.UTC(2025,0,2);
 const item=f.db.save({kind:"decision",text:"旧决定",details:"独有的旧理由",occurredAt:when},{confirmed:true,source:{type:"manual",ref:"manual:history"},now:when}).item;
 f.db.update(item.key,undefined,1,{text:"新决定",details:"新理由",reason:"明确替代"},Date.UTC(2026,10,1));
 const {createMemoryTool}=await import("../tools/memory-tool");
 const tool=await createMemoryTool(f.service,()=>context);
 const execute=tool.execute as unknown as (id:string,params:Record<string,unknown>)=>Promise<{content:Array<{text:string}>}>;
 const search=JSON.parse((await execute("search-history",{action:"search",query:"独有的旧理由",history:true,view:"history"})).content[0]!.text);
 expect(search.items[0]).toMatchObject({key:item.key,matchedRevision:1,occurredAt:"2025-01-02T00:00:00.000Z",timeBasis:"occurred",reason:"明确替代"});
 const previous=JSON.parse((await execute("read-history",{action:"read",key:item.key,revision:1,history:true})).content[0]!.text);
 expect(previous.content).toBe("旧决定");expect(previous.occurredAt).toBe("2025-01-02T00:00:00.000Z");
});
