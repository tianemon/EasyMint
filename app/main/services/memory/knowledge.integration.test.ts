import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {expect,it,vi} from "vitest";
import {ModelRuntime} from "@earendil-works/pi-coding-agent";
import {getCurrentSystemPrompt,getCurrentTools} from "@earendil-works/pi-ai";
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from "@earendil-works/pi-ai/providers/faux";
import type {MemoryPort} from "./client";
const caches=vi.hoisted(()=>new Map<string,{permissionMode?:string;memoryMode?:string}>());
vi.mock("../session-cache",()=>({readCache:(id:string)=>caches.get(id),writeCache:(id:string,value:unknown)=>caches.set(id,value as never)}));
vi.mock("electron",()=>({app:{isPackaged:false,getPath:()=>os.tmpdir()},BrowserWindow:{getAllWindows:()=>[]}}));
vi.mock("../pi-init",async original=>({...await original<object>(),getModelRuntime:vi.fn()}));
vi.mock("../mcp-runtime",()=>({createMcpSessionExtensions:async()=>[],disposeMcpSession:async()=>{}}));
const submission={action:"save",title:"配置缓存下的验证需区分进程",when:"本任务的配置缓存模块出现重复结果时",do:"分别在热进程和新进程运行同一小样，先比较结果再改配置",verification:"合成对照材料记录了热进程与新进程结果不同",limits:"只适用于该加载模块，根因没有完全确定",basis:"observed",scope:"project"};
it.each([false,true])("binds a real SDK experience call and observed tool evidence; readonly tightening=%s",async(tighten)=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"em-knowledge-native-"));let session:import("../pi-sdk").AgentSession|undefined,service:import("./service").MemoryService|undefined,db:import("./database").MemoryDatabase|undefined;
 vi.stubEnv("EASYMINT_HOME",root);vi.stubEnv("PI_CODING_AGENT_DIR",path.join(root,"agent"));caches.clear();
 try{
  const runtime=await ModelRuntime.create({modelsPath:null,authPath:path.join(root,"auth.json"),allowModelNetwork:false}),faux=fauxProvider({provider:"knowledge-fixture",models:[{id:"fixture"}],tokensPerSecond:0});runtime.registerNativeProvider(faux.provider);await runtime.refresh({allowNetwork:false});
  vi.mocked((await import("../pi-init")).getModelRuntime).mockResolvedValue(runtime);
  const {Store}=await import("../store"),{createPiSession,disposePiSession}=await import("../pi-session"),{MemoryService}=await import("./service"),{MemoryDatabase}=await import("./database"),{createMemoryTool}=await import("../tools/memory-tool");
  const store=new Store(root);store.saveSettings({...store.getSettings(),memory:{enabled:true,background:false}});store.saveProjects([{id:"p",path:root,name:"合成项目",createdAt:new Date().toISOString(),lastOpenedAt:new Date().toISOString(),status:"development",description:""}]);
  db=new MemoryDatabase(path.join(root,"memory","memory.sqlite"));const port={call:async(method:string,...args:unknown[])=>(db as any)[method](...args)} as MemoryPort,backend=vi.fn();service=new MemoryService(store,{port,busy:()=>false,getBackend:backend,getSession:()=>session?{entries:session.sessionManager.getEntries(),file:session.sessionManager.getSessionFile()}:undefined});await service.initialize();
  const context=():import("./service").MemorySessionContext=>{if(!session)throw new Error("not ready");return {sessionId:session.sessionId,projectPath:root,entries:session.sessionManager.getEntries(),projection:session.sessionManager.buildSessionProjection().entries,sessionFile:session.sessionManager.getSessionFile(),usage:{tokens:1000,contextWindow:100000},current:context};};
  const tool=await createMemoryTool(service,context,"experience"),requests:Array<unknown[]>=[],visibleTools=new Map<string,string>();
  const task=await(await import("../task/tool")).createTaskTool({cwd:root,agentDir:path.join(root,"agent"),store,parentSessionId:"fixture"}),todo=await(await import("../tools/todo-tool")).createTodoWriteTool(root,"fixture"),memory=await createMemoryTool(service,context);fs.writeFileSync(path.join(root,"probe.txt"),"合成对照记录：热进程得到旧值，新进程得到新值。只验证了该配置加载模块。\n");
  faux.setResponses([
   ctx=>{
    for(const tool of getCurrentTools(ctx.messages))visibleTools.set(tool.name,tool.description);
    requests.push(structuredClone(ctx.messages));return fauxAssistantMessage(fauxToolCall("read",{path:"probe.txt"}),{stopReason:"toolUse"});
   },
   ctx=>{requests.push(structuredClone(ctx.messages));if(tighten)caches.set(session!.sessionId,{permissionMode:"readonly"});return fauxAssistantMessage(fauxToolCall("experience",submission),{stopReason:"toolUse"});},
   ctx=>{requests.push(structuredClone(ctx.messages));return fauxAssistantMessage("DONE");}
  ]);
  session=await createPiSession({cwd:root,agentDir:path.join(root,"agent"),store,model:runtime.getModel("knowledge-fixture","fixture")!,systemPrompt:"CUSTOM_ROLE_ONLY",extraTools:[tool,memory,task,todo],permissionMode:"standard",canUseTool:async()=>({behavior:"allow"})});
  await session.prompt("检查合成验证材料，提炼适用范围明确的经验。");expect(getCurrentSystemPrompt(requests[0] as never)).toContain("不必等待用户说");expect(fs.existsSync(path.join(root,"AGENTS.md"))).toBe(false);expect(backend).not.toHaveBeenCalled();
  expect(visibleTools.get("experience")).toContain("做法有效而原因未知");expect(visibleTools.get("experience")).toContain("保存前查近似条目");
  expect(visibleTools.get("memory")).toContain("一次重要事件也可记");expect(visibleTools.get("memory")).toContain("事实archive/restore/cancel");
  expect(visibleTools.get("task")).toContain("不倒退原任务终态");expect(visibleTools.get("todo_write")).toContain("不按读、改、测、提交");
  expect(visibleTools.get("write")).toContain("分块写入");
  const rows=db.query({projectId:"p",family:"experience"});
  if(tighten){expect(rows.total).toBe(0);expect(JSON.stringify(requests.at(-1))).toContain("不允许");}
  else{
   expect(rows.total,JSON.stringify(requests.at(-1))).toBe(1);const item=db.get(rows.items[0]!.key,"p")!;expect(item.details).toContain("根因没有完全确定");expect(item.sources[0]?.entryId).toMatch(/^toolcall:/u);expect(item.sources[0]?.evidence?.length).toBeGreaterThan(0);
   const source=item.sources[0]!;await tool.execute(source.submissionId!,submission,new AbortController().signal,undefined,{} as never);expect(db.query({projectId:"p",family:"experience"}).total).toBe(1);
   const manager=session.sessionManager;
   const author=manager.getEntries().find(entry=>entry.type==="message"&&entry.message.role==="assistant"&&entry.message.content.some(part=>part.type==="toolCall"&&part.id===source.submissionId));
   if(author?.type!=="message"||author.message.role!=="assistant")throw new Error("Missing original experience call");
   const content=author.message.content.map(part=>part.type==="toolCall"&&part.id===source.submissionId
    ? {...part,arguments:{...part.arguments,do:"来源已改写"}}
    : part);
   manager.appendContextEdit(author.id,{content});
   await service.sourceChanged(session.sessionId,root,manager.getEntries());expect(db.query({projectId:"p",family:"experience"}).total).toBe(0);expect(db.get(item.key,"p")?.lifecycle).toBe("archived");
  }
  await disposePiSession(session);session=undefined;
 }finally{if(session)await(await import("../pi-session")).disposePiSession(session);await service?.close();db?.close();vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});}
},25000);
