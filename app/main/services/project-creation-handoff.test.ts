import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import type {Store} from "./store";
import type {AgentService} from "./agent-service";

const state=vi.hoisted(()=>({cache:new Map<string,Record<string,unknown>>(),created:vi.fn(),disposed:vi.fn(),broadcast:vi.fn(),modes:[] as Array<{id:string;name:string;scenario:string;prompt:string;defaultEnabled:boolean;builtin:boolean}>}));
vi.mock("electron",()=>({app:{isPackaged:false,getPath:()=>os.tmpdir()},BrowserWindow:{getAllWindows:()=>[]}}));
vi.mock("./session-cache",()=>({readCache:(id:string)=>state.cache.get(id),writeCache:(id:string,value:Record<string,unknown>)=>state.cache.set(id,{...state.cache.get(id),...value}),deleteCache:(id:string)=>state.cache.delete(id)}));
vi.mock("./ipc-broadcast",()=>({broadcast:(...args:unknown[])=>state.broadcast(...args),broadcastEvent:()=>({sequence:1})}));
vi.mock("./system-prompt-manager",()=>({getConversationConfig:()=>({main:{nickname:"Fixture",userAddress:"",avatar:"",personality:"",rules:""},modes:state.modes}),conversationPromptBlocks:()=>({}),conversationSettingsUpdate:()=>undefined}));
vi.mock("./pi-session",()=>({createPiSession:(...args:unknown[])=>state.created(...args),resumePiSession:()=>{throw new Error("No real session is permitted");},listPiSessions:async()=>[],disposePiSession:(...args:unknown[])=>state.disposed(...args)}));
const fixtures:Array<{root:string;service:AgentService}>=[];
afterEach(async()=>{for(const fixture of fixtures.splice(0)){await fixture.service.shutdown();fs.rmSync(fixture.root,{recursive:true,force:true});}vi.unstubAllEnvs();vi.restoreAllMocks();state.cache.clear();state.created.mockReset();state.disposed.mockReset();state.broadcast.mockReset();state.modes=[];});
async function setup(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"em-creation-handoff-"));vi.stubEnv("EASYMINT_HOME",root);
 const {AgentService}=await import("./agent-service");const store={getDataDir:()=>root,getSettings:()=>({memory:{enabled:false,background:false}}),getProjects:()=>[]} as unknown as Store;
 let projects:unknown[]=[];store.getProjects=()=>structuredClone(projects) as ReturnType<Store["getProjects"]>;store.saveProjects=value=>{projects=structuredClone(value);};
 const service=new AgentService(store),internals=service as unknown as {getModel:()=>Promise<unknown>;buildExtraTools:()=>Promise<unknown>;buildSystemPrompt:()=>string;launchPrompt:(...args:unknown[])=>void;activeChats:Map<string,unknown>};
 const model=vi.spyOn(internals,"getModel").mockResolvedValue({id:"fixture",provider:"fixture",contextWindow:10000});vi.spyOn(internals,"buildExtraTools").mockResolvedValue({tools:[],canUseTool:async()=>({behavior:"allow"}),memoryInstalled:false});vi.spyOn(internals,"buildSystemPrompt").mockReturnValue("FIXTURE");const launch=vi.spyOn(internals,"launchPrompt").mockImplementation(()=>{});
 const session={sessionId:"synthetic-created-session",model:{id:"fixture",provider:"fixture"},abort:vi.fn(async()=>{}),clearQueue:()=>({steering:[],followUp:[]})};state.created.mockResolvedValue(session);state.disposed.mockResolvedValue(undefined);fixtures.push({root,service});
 const send=(ready:()=>void)=>service.sendMessage(root,"CREATION_REQUEST",null,"standard",{} as never,undefined,undefined,undefined,undefined,{customType:"system_message",display:true,content:"CREATION_REQUEST",details:{kind:"project-created"}},undefined,undefined,"record",ready);
 return {root,service,store,internals,session,model,launch,send};
}
it("finishes the durable handoff after registration and before identity or prompt",async()=>{
 const f=await setup();let sealed=false;const ready=vi.fn(()=>{expect(f.service.findActiveChat(f.session.sessionId)).toBeDefined();expect(state.broadcast.mock.calls.some(call=>call[0]==="agent:chat-session")).toBe(false);expect(f.launch).not.toHaveBeenCalled();sealed=true;});
 f.launch.mockImplementation(()=>{expect(sealed).toBe(true);});expect(await f.send(ready)).toMatchObject({sessionId:f.session.sessionId});expect(ready).toHaveBeenCalledOnce();expect(f.launch).toHaveBeenCalledOnce();
});
it("disposes the unstarted session and caches when durable handoff fails",async()=>{
 const f=await setup();await expect(f.send(()=>{throw new Error("synthetic seal persistence failure");})).rejects.toThrow("synthetic seal");expect(f.launch).not.toHaveBeenCalled();expect(state.disposed).toHaveBeenCalledWith(f.session);expect(f.session.abort).toHaveBeenCalledOnce();expect(f.internals.activeChats.size).toBe(0);expect(state.cache.size).toBe(0);expect(state.broadcast.mock.calls.some(call=>call[0]==="agent:chat-session")).toBe(false);
});
it("does not consume creation permission on a startup failure before session creation",async()=>{
 const f=await setup(),ready=vi.fn();f.model.mockResolvedValue(null);await expect(f.send(ready)).rejects.toThrow("未配置 AI 模型");expect(ready).not.toHaveBeenCalled();expect(state.created).not.toHaveBeenCalled();expect(f.launch).not.toHaveBeenCalled();
});
async function pendingProject(f:Awaited<ReturnType<typeof setup>>){
 const rules=await import("./project-rule-files");rules.initializeProjectRules(f.root,"HOST_TEMPLATE","Fixture",false);const ownership=rules.initialProjectRuleOwnership(f.root)!;
 f.store.saveProjects([{id:"p",path:f.root,name:"Fixture",status:"setup",description:"",createdAt:"",lastOpenedAt:"",creationRules:ownership}]);fs.writeFileSync(path.join(f.root,"AGENTS.md"),"USER_EDITED_RULE");return ownership;
}
it("ordinary direct sendMessage seals ownership without IPC or rewriting edited rules",async()=>{
 const f=await setup();await pendingProject(f);f.launch.mockImplementation(()=>{expect(f.store.getProjects()[0]?.creationRules).toBeUndefined();});
 await f.service.sendMessage(f.root,"普通接手",null,"standard",{} as never);expect(f.launch).toHaveBeenCalledOnce();expect(fs.readFileSync(path.join(f.root,"AGENTS.md"),"utf8")).toBe("USER_EDITED_RULE");
});
it("ordinary reuse also seals leftover ownership while retaining existing privacy cache",async()=>{
 const f=await setup();await f.send(()=>{});await pendingProject(f);f.launch.mockClear();state.cache.set(f.session.sessionId,{permissionMode:"readonly",memoryMode:"off"});
 await f.service.sendMessage(f.root,"普通继续",f.session.sessionId,undefined,{} as never);expect(f.store.getProjects()[0]?.creationRules).toBeUndefined();expect(state.cache.get(f.session.sessionId)?.memoryMode).toBe("off");expect(f.launch).toHaveBeenCalledOnce();expect(state.created).toHaveBeenCalledOnce();expect(fs.readFileSync(path.join(f.root,"AGENTS.md"),"utf8")).toBe("USER_EDITED_RULE");
});
it("failed cold-resume takeover disposes resources but preserves stored privacy choices",async()=>{
 const f=await setup();await pendingProject(f);state.cache.set("restored-session",{permissionMode:"readonly",memoryMode:"off"});vi.spyOn(f.store,"saveProjects").mockImplementation(()=>{throw new Error("synthetic takeover persistence failure");});
 await expect(f.service.sendMessage(f.root,"普通接手","restored-session",undefined,{} as never)).rejects.toThrow("synthetic takeover");expect(f.launch).not.toHaveBeenCalled();expect(state.disposed).toHaveBeenCalledWith(f.session);expect(state.cache.get("restored-session")).toMatchObject({permissionMode:"readonly",memoryMode:"off"});expect(f.internals.activeChats.size).toBe(0);
});

it("persists the first selection before publishing the created identity and refuses later changes",async()=>{
 const f=await setup();
 state.cache.set("old-session",{collaborationModeIds:["ui-design"],collaborationModesLocked:true,permissionMode:"standard"});
 await expect(f.service.sendMessage(f.root,"continue","old-session",undefined,{} as never,undefined,undefined,undefined,undefined,undefined,undefined,[])).rejects.toThrow("创建会话前");
 expect(state.created).not.toHaveBeenCalled();expect(state.cache.get("old-session")?.collaborationModeIds).toEqual(["ui-design"]);
 await f.service.sendMessage(f.root,"new",null,"standard",{} as never,undefined,undefined,undefined,undefined,undefined,undefined,[]);
 expect(state.cache.get(f.session.sessionId)).toMatchObject({collaborationModeIds:[],collaborationModesLocked:true});
 f.launch.mockClear();
 await expect(f.service.sendMessage(f.root,"continue",f.session.sessionId,undefined,{} as never,undefined,undefined,undefined,undefined,undefined,undefined,["ui-design"])).rejects.toThrow("创建会话前");
 expect(f.launch).not.toHaveBeenCalled();
 await f.service.sendMessage(f.root,"continue",f.session.sessionId,undefined,{} as never,undefined,undefined,undefined,undefined,undefined,undefined,[]);
 expect(f.launch).toHaveBeenCalledOnce();
});
it("does not apply new-session defaults or a later designer override to an existing cached selection",async()=>{
 const f=await setup();await f.send(()=>{});f.launch.mockClear();
 await f.service.sendMessage(f.root,"continue",f.session.sessionId,undefined,{} as never,undefined,true);
 expect(state.cache.get(f.session.sessionId)?.collaborationModeIds).toEqual([]);
 expect(f.launch).toHaveBeenCalledOnce();
});
it("stores stacked selections at creation and retains them after default mode settings change",async()=>{
 const f=await setup();state.modes=[{id:'ui-design',name:'UI',scenario:'',prompt:'UI',defaultEnabled:true,builtin:true},{id:'domain-guidance',name:'Guidance',scenario:'',prompt:'GUIDE',defaultEnabled:false,builtin:true}];
 await f.service.sendMessage(f.root,'new',null,'standard',{} as never,undefined,undefined,undefined,undefined,undefined,undefined,['ui-design','domain-guidance']);
 expect(state.cache.get(f.session.sessionId)).toMatchObject({collaborationModeIds:['ui-design','domain-guidance'],collaborationModesLocked:true});
 state.modes=state.modes.map(mode=>({...mode,defaultEnabled:false}));f.launch.mockClear();
 await f.service.sendMessage(f.root,'continue',f.session.sessionId,undefined,{} as never);
 expect(state.cache.get(f.session.sessionId)?.collaborationModeIds).toEqual(['ui-design','domain-guidance']);expect(f.launch).toHaveBeenCalledOnce();
});
it("retains accepted mode and memory choices if maintenance removes the temporary cache during creation",async()=>{
 const f=await setup();state.modes=[{id:'ui-design',name:'UI',scenario:'',prompt:'UI',defaultEnabled:false,builtin:true}];
 vi.mocked(f.internals.buildExtraTools).mockImplementationOnce(async()=>{state.cache.clear();return {tools:[],canUseTool:async()=>({behavior:'allow'}),memoryInstalled:false};});
 await f.service.sendMessage(f.root,'new',null,'full',{} as never,undefined,undefined,undefined,undefined,undefined,undefined,['ui-design'],'off');
 expect(state.cache.get(f.session.sessionId)).toMatchObject({permissionMode:'full',memoryMode:'off',collaborationModeIds:['ui-design'],collaborationModesLocked:true});
 expect(state.created.mock.calls.map(call=>call[0].permissionMode)).toEqual(['full']);expect(state.disposed).not.toHaveBeenCalled();
});
it("retains a stricter accepted mode if the staging cache disappears after SDK creation",async()=>{
 const f=await setup();
 vi.mocked(f.internals.buildExtraTools).mockImplementationOnce(async()=>{for(const [id,value] of state.cache)state.cache.set(id,{...value,permissionMode:'readonly'});return {tools:[],canUseTool:async()=>({behavior:'allow'}),memoryInstalled:false};});
 state.created.mockImplementationOnce(async()=>{state.cache.clear();return f.session;});
 await f.service.sendMessage(f.root,'new',null,'full',{} as never,undefined,undefined,undefined,undefined,undefined,undefined,[],'off');
 expect(state.created.mock.calls.map(call=>call[0].permissionMode)).toEqual(['readonly']);expect(state.disposed).not.toHaveBeenCalled();
 expect(state.cache.get(f.session.sessionId)).toMatchObject({permissionMode:'readonly',memoryMode:'off',collaborationModeIds:[],collaborationModesLocked:true});
});
