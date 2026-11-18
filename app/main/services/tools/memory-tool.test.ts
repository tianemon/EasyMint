import {describe,it,expect,vi} from "vitest";
import {createMemoryTool} from "./memory-tool";
import type {MemoryService,MemorySessionContext} from "../memory/service";
import type {MemoryDocument} from "../../../shared/memory";
import {estimateMemoryTokens} from "../memory/context";
vi.mock("../pi-sdk",()=>({getDefineToolFn:async()=>(definition:unknown)=>definition}));
const context:MemorySessionContext={sessionId:"test",projectPath:"/project",entries:[],projection:[],usage:{tokens:1000,contextWindow:100000}};
const document:MemoryDocument={file:"/synthetic/MEMORY.md",content:"用户原文。".repeat(8000),hash:"a".repeat(64)};
describe("agent memory document tool boundaries",()=>{
 it.each([
  {registered:true,kind:"background",scope:undefined,expected:"project"},
  {registered:true,kind:"preference",scope:undefined,expected:"project"},
  {registered:false,kind:"background",scope:undefined,expected:"global"},
  {registered:true,kind:"background",scope:"global",expected:"global"},
 ])("keeps the declared scope default for $kind, registered=$registered, explicit=$scope",async({registered,kind,scope,expected})=>{
  const saveFromAgent=vi.fn(async(..._args:unknown[])=>({item:{key:"fixture",revision:1,confidence:"unconfirmed",lifecycle:"active",text:"RECENT_FACT"},existing:false}));
  const service={project:()=>registered?{id:"project"}:undefined,saveFromAgent} as unknown as MemoryService;
  const tool=await createMemoryTool(service,()=>context);
  await tool.execute("save",{action:"save",kind,text:"RECENT_FACT",...(scope?{scope}:{})},new AbortController().signal,undefined,{} as never);
  expect(saveFromAgent.mock.calls[0]?.[2]).toBe(expected);
 });
 it.each(["both","recent"])("does not silently reinterpret the search-only save scope %s",async scope=>{
  const saveFromAgent=vi.fn(),tool=await createMemoryTool({saveFromAgent} as unknown as MemoryService,()=>context);
  await expect(tool.execute("save",{action:"save",kind:"background",text:"RECENT_FACT",scope},new AbortController().signal,undefined,{} as never)).rejects.toThrow("仅用于搜索");
  expect(saveFromAgent).not.toHaveBeenCalled();
 });
 it("marks insufficient context as a failed tool result without reading or acknowledging content",async()=>{
  const readDocumentFromAgent=vi.fn();
  const service={maintenanceAllowed:async()=>false,canRead:()=>true,readDocumentFromAgent} as unknown as MemoryService;
  const tool=await createMemoryTool(service,()=>({...context,usage:{tokens:10000,contextWindow:10000}}));
  const result=await tool.execute("read",{action:"read_summary"},new AbortController().signal,undefined,{} as never);
  expect(result.isError).toBe(true);expect(result.details).toMatchObject({memoryDelivery:{items:[]}});expect(readDocumentFromAgent).not.toHaveBeenCalled();
 });
 it("marks oversized metadata as a failed result instead of displaying successful reading",async()=>{
  const service={maintenanceAllowed:async()=>false,canRead:()=>true,readDocumentFromAgent:async()=>({...document,file:"X".repeat(10000),content:"short"}),deliverRead:async(_context:unknown,_expected:unknown,deliver:()=>unknown)=>deliver()} as unknown as MemoryService;
  const tool=await createMemoryTool(service,()=>context),result=await tool.execute("read",{action:"read_summary"},new AbortController().signal,undefined,{} as never);
  expect(result.isError).toBe(true);expect(result.details).toMatchObject({memoryDelivery:{items:[]}});
 });
 it.each([false,true])("preserves the database cursor after source filtering, empty=%s",async empty=>{
  const item={key:"global/item",revision:1,text:"condensed",scope:"global",confidence:"confirmed",lifecycle:"active",occurredAt:1,updatedAt:1};
  const service={maintenanceAllowed:async()=>false,canRead:()=>true,query:async()=>({items:empty?[]:[item],total:8,next:6,offsets:empty?[]:[4]}),deliverRead:async(_context:unknown,_items:unknown,deliver:()=>unknown)=>deliver()} as unknown as MemoryService;
  const tool=await createMemoryTool(service,()=>context),result=await tool.execute("search",{action:"search",query:"topic",offset:3},new AbortController().signal,undefined,{} as never);
  const block=result.content.find(part=>part.type==="text");if(!block||block.type!=="text")throw new Error("missing output");
  expect(JSON.parse(block.text).nextOffset).toBe(6);
 });
 it("resumes at the first unread original row when the context budget truncates a filtered page",async()=>{
  const item={key:"global/first",revision:1,text:"必要的历史核心".repeat(500),scope:"global",confidence:"confirmed",lifecycle:"active",occurredAt:1,updatedAt:1};
  const service={maintenanceAllowed:async()=>false,canRead:()=>true,query:async()=>({items:[item,{...item,key:"global/second"}],total:8,next:7,offsets:[3,5]}),deliverRead:async(_context:unknown,_items:unknown,deliver:()=>unknown)=>deliver()} as unknown as MemoryService;
  const tool=await createMemoryTool(service,()=>context),result=await tool.execute("search",{action:"search",query:"topic",offset:2},new AbortController().signal,undefined,{} as never);
  const block=result.content.find(part=>part.type==="text");if(!block||block.type!=="text")throw new Error("missing output");
  const page=JSON.parse(block.text);expect(page.items).toHaveLength(1);expect(page.items[0].requiresRead).toBe(true);expect(page.nextOffset).toBe(5);
 });
 it("advertises only implemented actions for each content family",async()=>{
  const service={} as MemoryService;
  const memory=await createMemoryTool(service,()=>context),experience=await createMemoryTool(service,()=>context,"experience");
  const actions=(tool:typeof memory)=>(tool.parameters as unknown as {properties:{action:{enum:string[]}}}).properties.action.enum;
  const kinds=(tool:typeof memory)=>(tool.parameters as unknown as {properties:{kind:{enum:string[]}}}).properties.kind.enum;
  expect(actions(memory)).not.toContain("invalidate");
  for(const action of ["edit","cancel","read_summary","write_summary"])expect(actions(experience)).not.toContain(action);
  for(const action of ["save","read","search","update","forget"])expect(actions(memory)).toContain(action);
  expect(actions(experience)).toContain("invalidate");expect(actions(experience)).toContain("restore");
  expect(kinds(memory)).not.toContain("lesson");expect(kinds(experience)).toEqual(["lesson"]);
 });
 it("rechecks consent after an asynchronous document read",async()=>{
  let readable=true,release!:(value:MemoryDocument)=>void;const pending=new Promise<MemoryDocument>(resolve=>{release=resolve;});
  const service={maintenanceAllowed:async()=>false,canRead:()=>readable,readDocumentFromAgent:()=>pending} as unknown as MemoryService;
  const tool=await createMemoryTool(service,()=>context),run=tool.execute("read",{action:"read_summary"},new AbortController().signal,undefined,{} as never);
  readable=false;release(document);await expect(run).rejects.toThrow("已关闭记忆");
 });
 it("pages the canonical document within the context budget",async()=>{
  const service={maintenanceAllowed:async()=>false,canRead:()=>true,readDocumentFromAgent:async()=>document,deliverRead:async(_context:unknown,_expected:unknown,deliver:()=>unknown)=>deliver()} as unknown as MemoryService;
  const tool=await createMemoryTool(service,()=>context);
  const result=await tool.execute("read",{action:"read_summary"},new AbortController().signal,undefined,{} as never);
  const text=result.content.find(block=>block.type==="text");if(!text||text.type!=="text")throw new Error("missing text");
  const payload=JSON.parse(text.text);expect(payload.nextOffset).toBeGreaterThan(0);expect(payload.nextOffset).toBeLessThan(document.content.length);expect(payload.hash).toBe(document.hash);expect(estimateMemoryTokens(text.text)).toBeLessThanOrEqual(1500);

 });
});
