import {describe,it,expect,vi} from "vitest";
import {createMemoryTool} from "./memory-tool";
import type {MemoryService,MemorySessionContext} from "../memory/service";
import type {MemoryDocument} from "../../../shared/memory";
import {estimateMemoryTokens} from "../memory/context";
vi.mock("../pi-sdk",()=>({getDefineToolFn:async()=>(definition:unknown)=>definition}));
const context:MemorySessionContext={sessionId:"test",projectPath:"/project",entries:[],projection:[],usage:{tokens:1000,contextWindow:100000}};
const document:MemoryDocument={file:"/synthetic/MEMORY.md",content:"用户原文。".repeat(8000),hash:"a".repeat(64),reviewHash:"b".repeat(64),available:"",protectedLines:[],changes:"新确认的摘要",removed:[],needsReview:true};
describe("agent memory document tool boundaries",()=>{
 it("rechecks consent after an asynchronous document read",async()=>{
  let readable=true,release!:(value:MemoryDocument)=>void;const pending=new Promise<MemoryDocument>(resolve=>{release=resolve;});
  const service={maintenanceAllowed:async()=>false,canRead:()=>readable,readDocument:()=>pending} as unknown as MemoryService;
  const tool=await createMemoryTool(service,()=>context),run=tool.execute("read",{action:"read_summary"},new AbortController().signal,undefined,{} as never);
  readable=false;release(document);await expect(run).rejects.toThrow("已关闭记忆");
 });
 it("pages document text and grounded changes within the same context budget",async()=>{
  const service={maintenanceAllowed:async()=>false,canRead:()=>true,readDocument:async()=>document} as unknown as MemoryService;
  const tool=await createMemoryTool(service,()=>context);
  const result=await tool.execute("read",{action:"read_summary"},new AbortController().signal,undefined,{} as never);
  const text=result.content.find(block=>block.type==="text");if(!text||text.type!=="text")throw new Error("missing text");
  const payload=JSON.parse(text.text);expect(payload.nextOffset).toBeGreaterThan(0);expect(payload.nextOffset).toBeLessThan(document.content.length);expect(payload.reviewHash).toBe(document.reviewHash);expect(estimateMemoryTokens(text.text)).toBeLessThanOrEqual(1500);
  const changes=await tool.execute("changes",{action:"read_summary",section:"changes"},new AbortController().signal,undefined,{} as never);
  expect(JSON.stringify(changes.content)).toContain("新确认的摘要");
 });
});
