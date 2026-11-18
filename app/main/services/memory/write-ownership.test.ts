import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import type {MemoryConclusion} from "../../../shared/memory";
import type {Store} from "../store";
import type {MemoryPort} from "./client";
import {MemoryDatabase} from "./database";
import {MemoryService,type MemorySessionContext} from "./service";

// Projection is a deterministic fixture; these tests never create an SDK session.
vi.mock("../session-cache",()=>({readCache:()=>undefined}));
vi.mock("../pi-sdk",()=>({getSessionDataHelpers:async()=>({currentVersion:3,buildSessionProjection:(entries:any[])=>({entries:entries.map(sourceEntry=>({sourceEntry,messages:sourceEntry.type==="message"?[sourceEntry.message]:[]}))})})}));
const fixtures:Array<{root:string;db:MemoryDatabase;service?:MemoryService}>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const fixture of fixtures.splice(0)){await fixture.service?.close();fixture.db.close();fs.rmSync(fixture.root,{recursive:true,force:true});}});
function setup(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"em-write-owner-")),db=new MemoryDatabase(path.join(root,"memory","memory.sqlite"));const fixture={root,db,service:undefined as MemoryService|undefined};fixtures.push(fixture);return fixture;}
const conclusion=(root:string,hash="first"):MemoryConclusion=>({ref:"conclusion:s:a",sessionId:"s",entryId:"a",sessionFile:"fixture.jsonl",projectPath:root,timestamp:1,hash});
function state(db:MemoryDatabase,ref="conclusion:s:a"):string|undefined {return (db.db.prepare("SELECT state FROM jobs WHERE ref=?").get(ref) as {state:string}|undefined)?.state;}

it("does not issue ownership for an unchanged existing capture",()=>{
  const {db,root}=setup(),job=conclusion(root),first=db.enqueue(job)!;
  expect(first.generation).toBeTruthy();expect(db.enqueue(job)).toBeUndefined();
  db.cancelCapture([]);expect(state(db)).toBe("pending");
  db.cancelCapture([first]);expect(state(db)).toBe("skipped");
});

it("does not let an old generation cancel a replacement or adopt its earlier lease",()=>{
  const {db,root}=setup(),first=db.enqueue(conclusion(root))!,oldLease=db.claim()!;
  const replacement=db.enqueue(conclusion(root,"replacement"))!;expect(replacement.generation).not.toBe(first.generation);
  const current=db.claim()!;expect(current.generation).toBe(replacement.generation);
  db.cancelCapture([first]);expect(state(db)).toBe("running");
  expect(db.finishJob(oldLease,[],0,"2026-11-17")).toBe(false);expect(state(db)).toBe("running");
  expect(db.finishJob(current,[],0,"2026-11-17")).toBe(true);
  db.cancelCapture([replacement]);expect(state(db)).toBe("done");
});

it("cancels a claimed task from this generation and rejects its late result",()=>{
  const {db,root}=setup(),ticket=db.enqueue(conclusion(root))!,claimed=db.claim()!;
  db.cancelCapture([ticket]);expect(state(db)).toBe("skipped");
  expect(db.finishJob(claimed,[{input:{kind:"activity",text:"不应采用的迟到结果"},context:{confirmed:true,source:{ref:claimed.ref,type:"session"}}}],0,"2026-11-17")).toBe(false);
  expect(db.query().total).toBe(0);
});

it("leaves a previously queued unchanged round intact when a later capture is cancelled",async()=>{
  const fixture=setup(),{root,db}=fixture;
  const store={getDataDir:()=>root,getProjects:()=>[],getSettings:()=>({memory:{enabled:true,background:true,enabledAt:0}})} as unknown as Store;
  const port={call:async(method:string,...args:unknown[])=>{const fn=(db as any)[method];return fn.apply(db,args);}} as MemoryPort;
  const service=new MemoryService(store,{port,busy:()=>false,getBackend:async()=>{throw new Error("No model is used by capture");}});fixture.service=service;await service.initialize();
  const round=(id:string,parentId:string|null)=>[
    {type:"message",id:`${id}-u`,parentId,timestamp:new Date().toISOString(),message:{role:"user",content:"本轮已完成的任务",timestamp:Date.now()}},
    {type:"message",id:`${id}-a`,parentId:`${id}-u`,timestamp:new Date().toISOString(),message:{role:"assistant",content:[{type:"text",text:"已得到本轮结论"}],stopReason:"stop",timestamp:Date.now()}}
  ];
  const first:MemorySessionContext={sessionId:"s",projectPath:root,entries:round("first",null),projection:[]};await service.capture(first,"fixture.jsonl");
  const ref="conclusion:s:first-a";expect(state(db,ref)).toBe("pending");
  const controller=new AbortController(),next={...first,entries:[...first.entries,...round("second","first-a")],signal:controller.signal};
  const original=port.call.bind(port);let enter!:()=>void,release!:()=>void,once=true;
  const ready=new Promise<void>(resolve=>{enter=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  vi.spyOn(port,"call").mockImplementation((async(method:string,...args:unknown[])=>{
    const result=await (original as any)(method,...args);if(method==="enqueue"&&once){once=false;enter();await gate;}return result;
  }) as any);
  const capture=service.capture(next,"fixture.jsonl");await ready;controller.abort();release();await capture;
  expect(state(db,ref)).toBe("pending");
  await service.capture({...next,signal:undefined},"fixture.jsonl");expect(state(db,ref)).toBe("pending");expect(state(db,"conclusion:s:second-a")).toBe("pending");
});
