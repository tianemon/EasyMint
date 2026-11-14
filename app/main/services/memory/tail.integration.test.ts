import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect,it,vi } from "vitest";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { fauxProvider,fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { MemoryDatabase } from "./database";
import { MemoryService } from "./service";
import { migrateExperiences } from "./migration";
import { documentStatus } from "./documents";
import type { MemoryPort } from "./client";
vi.mock("electron",()=>({app:{isPackaged:false,getPath:()=>os.tmpdir()},BrowserWindow:{getAllWindows:()=>[]}}));
vi.mock("../pi-init",async original=>({...await original<object>(),getModelRuntime:vi.fn()}));
vi.mock("../mcp-runtime",()=>({createMcpSessionExtensions:async()=>[],disposeMcpSession:async()=>{}}));

it("sends real memory-service references after the current user, with unchanged prior input and no duplicate delivery",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"em-memory-tail-"));
  let session:any,service:MemoryService|undefined,db:MemoryDatabase|undefined;
  vi.stubEnv("EASYMINT_HOME",root);vi.stubEnv("PI_CODING_AGENT_DIR",path.join(root,"agent"));
  try {
    const runtime=await ModelRuntime.create({modelsPath:null,authPath:path.join(root,"auth.json"),allowModelNetwork:false});
    const faux=fauxProvider({provider:"memory-tail-fixture",models:[{id:"fixture"}],tokensPerSecond:0});
    runtime.registerNativeProvider(faux.provider);await runtime.refresh({allowNetwork:false});
    const {getModelRuntime}=await import("../pi-init");vi.mocked(getModelRuntime).mockResolvedValue(runtime);
    const {Store}=await import("../store"),{createPiSession}=await import("../pi-session");
    fs.mkdirSync(path.join(root,"agent"),{recursive:true});
    const store=new Store(root);store.saveSettings({...store.getSettings(),memory:{enabled:true,background:false,dailyTokens:30_000}});
    db=new MemoryDatabase(path.join(root,"memory","memory.sqlite"));
    const port={call:async(method:string,...args:unknown[])=>{
      if(method==="migrate")return migrateExperiences(db!,args[0] as string,path.join(root,"backups"),args[1] as string|undefined);
      if(method==="documentStatus")return documentStatus(db!,args[0] as string);
      return (db as any)[method](...args);
    }} as MemoryPort;
    const backend=vi.fn();service=new MemoryService(store,{port,busy:()=>false,getBackend:backend});
    await service.initialize();
    const item=db.save({kind:"decision",text:"历史决定 MEMORY_REV1"},{source:{ref:"manual:test",type:"manual"},confirmed:true}).item;
    const requests:any[][]=[];
    faux.setResponses([0,1,2].map(()=>context=>{requests.push(structuredClone(context.messages));return fauxAssistantMessage("DONE");}));
    session=await createPiSession({cwd:root,agentDir:path.join(root,"agent"),store,model:runtime.getModel("memory-tail-fixture","fixture")!,
      systemPrompt:"STABLE_HOST_PREFIX",permissionMode:"standard",canUseTool:async()=>({behavior:"allow"}),
      getMemoryReference:prompt=>service!.reference({sessionId:session.sessionId,projectPath:root,entries:session.sessionManager.getEntries(),
        projection:session.sessionManager.buildSessionProjection().entries,usage:{tokens:1000,contextWindow:100_000}},prompt)});
    await session.prompt("USER_FIRST 历史决定");await session.prompt("USER_SECOND 历史决定");
    db.update(item.key,undefined,1,{text:"历史决定 MEMORY_REV2_SUPERSEDES_REV1"});
    await session.prompt("USER_THIRD 历史决定");
    expect(requests).toHaveLength(3);
    expect(getCurrentSystemPrompt(requests[1])).toBe(getCurrentSystemPrompt(requests[0]));
    expect(getCurrentSystemPrompt(requests[2])).toBe(getCurrentSystemPrompt(requests[0]));
    expect(requests[1]!.slice(0,requests[0]!.length)).toEqual(requests[0]);
    expect(requests[2]!.slice(0,requests[1]!.length)).toEqual(requests[1]);
    const first=JSON.stringify(requests[0]),second=JSON.stringify(requests[1]),third=JSON.stringify(requests[2]);
    expect(first.indexOf("MEMORY_REV1")).toBeGreaterThan(first.indexOf("USER_FIRST"));
    expect(second.match(/MEMORY_REV1/g)).toHaveLength(1);
    expect(third.indexOf("MEMORY_REV2_SUPERSEDES_REV1")).toBeGreaterThan(third.indexOf("USER_THIRD"));
    expect(getCurrentSystemPrompt(requests[0])).not.toContain("MEMORY_REV1");
    const {getSessionMessages}=await import("../session-service");
    const history=JSON.stringify(await getSessionMessages(session.sessionId,root));
    expect(history).toContain("USER_FIRST");
    expect(history).not.toContain("MEMORY_REV1");expect(history).not.toContain("MEMORY_REV2_SUPERSEDES_REV1");
    expect(backend).not.toHaveBeenCalled();
  } finally {
    if(session)await(await import("../pi-session")).disposePiSession(session);
    await service?.close();db?.close();vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});
  }
},25_000);
