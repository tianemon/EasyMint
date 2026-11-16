import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach,it,expect,vi } from "vitest";
vi.mock("electron",()=>({app:{isPackaged:false,getPath:()=>os.tmpdir()},BrowserWindow:{getAllWindows:()=>[]}}));
let root:string|undefined,service:any;
afterEach(async()=>{
  if(service)await service.shutdown();service=undefined;vi.restoreAllMocks();vi.unstubAllEnvs();
  if(root)fs.rmSync(root,{recursive:true,force:true});root=undefined;
});
it("keeps first-turn memory off across the temporary SDK identity and does not overwrite it on resume",async()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),"em-memory-mode-"));vi.stubEnv("EASYMINT_HOME",root);vi.resetModules();
  const {Store}=await import("./store"),{AgentService}=await import("./agent-service"),sessions=await import("./pi-session"),cache=await import("./session-cache");
  const model={id:"fixture",provider:"fixture",contextWindow:100_000,reasoning:false};
  const session={sessionId:"real-sdk-session",model,thinkingLevel:"off",isStreaming:false,abort:async()=>{},getAvailableThinkingLevels:()=>["off"],getContextUsage:()=>({tokens:0,contextWindow:100_000,percent:0})};
  vi.spyOn(sessions,"createPiSession").mockResolvedValue(session as never);
  vi.spyOn(sessions,"resumePiSession").mockResolvedValue(session as never);
  vi.spyOn(sessions,"listPiSessions").mockResolvedValue([{id:session.sessionId,path:path.join(root,"fake.jsonl")} as never]);
  vi.spyOn(sessions,"disposePiSession").mockResolvedValue();
  const store=new Store(root);service=new AgentService(store);
  vi.spyOn(service,"getModel").mockResolvedValue(model);vi.spyOn(service,"buildExtraTools").mockResolvedValue({tools:[],canUseTool:async()=>({behavior:"allow"}),memoryInstalled:false});
  vi.spyOn(service,"launchPrompt").mockImplementation(()=>{});vi.spyOn(service,"rebindToCurrentProvider").mockResolvedValue(undefined);
  const first=await service.sendMessage(root,"first",null,"standard",{} as never,undefined,false,undefined,"off",undefined,undefined,[],"off");
  expect(first.sessionId).toBe(session.sessionId);
  expect(cache.readCache(session.sessionId)?.memoryMode).toBe("off");
  store.saveSettings({...store.getSettings(),memory:{enabled:true,background:false}});
  expect(service.memory.canRecord(session.sessionId)).toBe(false);
  service.activeChats.clear();
  await service.sendMessage(root,"resume",session.sessionId,"standard",{} as never,undefined,false,undefined,"off",undefined,undefined,[],"record");
  expect(cache.readCache(session.sessionId)?.memoryMode).toBe("off");
  expect(service.memory.canRecord(session.sessionId)).toBe(false);
});

it.each(["omit","rewind"])("synchronizes memory sources before a successful %s operation returns",async(action)=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),"em-memory-mutation-"));vi.stubEnv("EASYMINT_HOME",root);vi.resetModules();
  const {Store}=await import("./store"),{AgentService}=await import("./agent-service"),{getSessionManagerClass}=await import("./pi-sdk"),{evidenceMessages}=await import("./memory/source");
  const SM=await getSessionManagerClass(),mgr=SM.inMemory(root);
  const u=mgr.appendMessage({role:"user",content:"以后使用中文",timestamp:Date.now()});
  service=new AgentService(new Store(root));
  const session={sessionId:"mutation",sessionManager:mgr,messages:[],isCompacting:false,refreshContext:vi.fn()};
  service.activeChats.set("mutation",{sessionId:"mutation",projectPath:root,session});
  const memory: import("./memory/service").MemoryService=service.memory;
  const sync=vi.spyOn(memory,"sourceChanged").mockImplementation(async(_id,_project,entries)=>{
    expect(await evidenceMessages(entries as unknown[])).toHaveLength(0);
  });
  const result=action==="omit"?await service.setEntryInContext("mutation",u,false):await service.rewindToNode("mutation",u);
  expect(result.ok).toBe(true);expect(sync).toHaveBeenCalledOnce();expect(sync.mock.calls[0]?.slice(0,2)).toEqual(["mutation",root]);
  service.activeChats.clear();
});
