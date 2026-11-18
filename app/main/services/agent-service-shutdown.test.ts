import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import {AgentService} from "./agent-service";
import type {Store} from "./store";
import {backgroundShellRegistry} from "./background-shell/registry";
import {createDelegation,finishDelegation,resetRegistry} from "./task/registry";

const state=vi.hoisted(()=>({cache:new Map<string,Record<string,unknown>>(),created:vi.fn(),resumed:vi.fn(),listed:vi.fn(),disposed:vi.fn()}));
vi.mock("electron",()=>({app:{isPackaged:false,getPath:()=>os.tmpdir()},BrowserWindow:{getAllWindows:()=>[]}}));
vi.mock("./ipc-broadcast",()=>({broadcast:vi.fn(),broadcastEvent:()=>({sequence:1})}));
vi.mock("./session-cache",()=>({readCache:(id:string)=>state.cache.get(id),writeCache:(id:string,value:Record<string,unknown>)=>state.cache.set(id,{...state.cache.get(id),...value}),deleteCache:(id:string)=>state.cache.delete(id)}));
vi.mock("./system-prompt-manager",()=>({getConversationConfig:()=>({main:{nickname:"Fixture",userAddress:"",avatar:"",personality:"",rules:""},modes:[]}),conversationPromptBlocks:()=>({}),conversationSettingsUpdate:()=>undefined}));
vi.mock("./pi-session",()=>({createPiSession:(...args:unknown[])=>state.created(...args),resumePiSession:(...args:unknown[])=>state.resumed(...args),listPiSessions:(...args:unknown[])=>state.listed(...args),disposePiSession:(...args:unknown[])=>state.disposed(...args)}));

const fixtures:Array<{root:string;service:AgentService}>=[],releaseAll:Array<()=>void>=[];
afterEach(async()=>{
 for(const release of releaseAll.splice(0))release();
 for(const {root,service} of fixtures.splice(0)){await service.shutdown();fs.rmSync(root,{recursive:true,force:true});}
 resetRegistry();vi.unstubAllEnvs();vi.restoreAllMocks();state.cache.clear();state.created.mockReset();state.resumed.mockReset();state.listed.mockReset();state.disposed.mockReset();
});
function deferred<T>(fallback:T){
 let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});releaseAll.push(()=>resolve(fallback));return {promise,resolve};
}
function setup(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"em-shutdown-mock-"));vi.stubEnv("EASYMINT_HOME",root);
 const service=new AgentService({getDataDir:()=>root,getSettings:()=>({memory:{enabled:false,background:false}}),getProjects:()=>[]} as unknown as Store),internals=service as any;
 fixtures.push({root,service});
 const model={id:"fixture",provider:"fixture",contextWindow:10000};
 const modelLookup=vi.spyOn(internals,"getModel").mockResolvedValue(model),tools=vi.spyOn(internals,"buildExtraTools").mockResolvedValue({tools:[],canUseTool:async()=>({behavior:"allow"}),memoryInstalled:false});
 vi.spyOn(internals,"buildSystemPrompt").mockReturnValue("FIXTURE");
 const bridge=vi.spyOn(internals,"promptAndBridge").mockResolvedValue(undefined);
 const session={sessionId:"fixture-main",model,abort:vi.fn(async()=>{}),sendCustomMessage:vi.fn(async()=>{}),isStreaming:true};
 state.created.mockResolvedValue(session);state.disposed.mockResolvedValue(undefined);
 state.resumed.mockResolvedValue(session);state.listed.mockResolvedValue([{id:session.sessionId,path:path.join(root,"synthetic.jsonl")}]);
 const stopShells=vi.spyOn(backgroundShellRegistry,"stopAll").mockImplementation(()=>{});
 const send=()=>service.sendMessage(root,"MOCK_REQUEST",null,"standard",{} as never,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,()=>{});
 return {root,service,internals,model,modelLookup,tools,bridge,session,stopShells,send};
}

it("cancels synchronously, includes detached delegations, blocks reentrant launches and waits for chat flush",async()=>{
 const f=setup(),flush=deferred<void>(undefined),memory=deferred<void>(undefined),controller=new AbortController();
 const closeMemory=vi.spyOn(f.service.memory,"close").mockReturnValue(memory.promise);
 f.internals.activeChats.set("chat",{chatId:"chat",sessionId:f.session.sessionId,session:f.session,abortController:controller,promptDone:flush.promise});
 f.internals.activePromptSessions.add(f.session.sessionId);
 const delegation=createDelegation("detached-parent",[{task:"MOCK_TASK"}]);releaseAll.push(()=>finishDelegation(delegation,"aborted"));
 delegation.taskAbortControllers[0]!.signal.addEventListener("abort",()=>f.service.injectSystemMessage(f.session.sessionId,"late result","delegation",{triggerTurn:true}));
 let reentered:Promise<void>|undefined;
 controller.signal.addEventListener("abort",()=>{reentered=f.service.shutdown();f.service.injectSystemMessage(f.session.sessionId,"late shell","shell",{triggerTurn:true});});
 const shutdown=f.service.shutdown();expect(reentered).toBe(shutdown);expect(f.service.shutdown()).toBe(shutdown);
 expect(controller.signal.aborted).toBe(true);expect(delegation.taskAbortControllers[0]!.signal.aborted).toBe(true);expect(f.session.abort).toHaveBeenCalledOnce();expect(f.stopShells).toHaveBeenCalledOnce();expect(closeMemory).toHaveBeenCalledOnce();
 expect(f.session.sendCustomMessage).not.toHaveBeenCalled();expect(()=>f.internals.launchPrompt(f.session,f.session.sessionId,"chat","new")).toThrow("正在退出");
 await expect(f.send()).rejects.toThrow("正在退出");await expect(f.service.runWorker(f.root,"new",{} as never)).rejects.toThrow("正在退出");expect(f.modelLookup).not.toHaveBeenCalled();expect(state.created).not.toHaveBeenCalled();
 memory.resolve();finishDelegation(delegation,"aborted");await Promise.resolve();await Promise.resolve();expect(state.disposed).not.toHaveBeenCalled();
 flush.resolve();await shutdown;expect(state.disposed).toHaveBeenCalledExactlyOnceWith(f.session);
});

it("waits for SDK abort confirmation before disposing a session",async()=>{
 const f=setup(),aborted=deferred<void>(undefined);f.session.abort.mockReturnValue(aborted.promise);
 f.internals.activeChats.set("chat",{chatId:"chat",sessionId:f.session.sessionId,session:f.session,abortController:new AbortController(),promptDone:Promise.resolve()});
 const shutdown=f.service.shutdown();await Promise.resolve();await Promise.resolve();expect(state.disposed).not.toHaveBeenCalled();
 aborted.resolve();await shutdown;expect(state.disposed).toHaveBeenCalledExactlyOnceWith(f.session);
});

it.each(["chat","worker"])("does not continue %s model preparation into tool/session creation after shutdown",async(kind)=>{
 const f=setup(),model=deferred(f.model);f.modelLookup.mockReturnValue(model.promise);
 const sent=kind==="chat"?f.send().catch(error=>error):f.service.runWorker(f.root,"MOCK_REQUEST",{} as never);
 const shutdown=f.service.shutdown();let settled=false;void shutdown.then(()=>{settled=true;});await Promise.resolve();await Promise.resolve();expect(settled).toBe(false);
 model.resolve(f.model);if(kind==="chat")expect(await sent).toMatchObject({message:expect.stringContaining("正在退出")});else await sent;
 await shutdown;expect(f.tools).not.toHaveBeenCalled();expect(state.created).not.toHaveBeenCalled();expect(f.bridge).not.toHaveBeenCalled();
});

it.each(["chat","worker"])("aborts and disposes a late-created %s session without prompting or completing shutdown early",async(kind)=>{
 const f=setup(),created=deferred(f.session),entered=deferred<void>(undefined);
 state.created.mockImplementation(()=>{entered.resolve();return created.promise;});
 const sent=kind==="chat"?f.send().catch(error=>error):f.service.runWorker(f.root,"MOCK_REQUEST",{} as never);
 await entered.promise;
 const shutdown=f.service.shutdown();let settled=false;void shutdown.then(()=>{settled=true;});await Promise.resolve();await Promise.resolve();expect(settled).toBe(false);
 created.resolve(f.session);await sent;await shutdown;expect(f.session.abort).toHaveBeenCalledOnce();expect(state.disposed).toHaveBeenCalledExactlyOnceWith(f.session);expect(f.bridge).not.toHaveBeenCalled();expect(f.internals.activeChats.size).toBe(0);expect(f.internals.activeRuns.size).toBe(0);
});

it("aborts a worker whose already-started SDK preflight accepts only after shutdown",async()=>{
 const f=setup(),prompt=deferred<void>(undefined);f.bridge.mockRestore();
 let preflight:((accepted:boolean)=>void)|undefined;
 const session={abort:vi.fn(async()=>{}),subscribe:vi.fn(()=>vi.fn()),prompt:vi.fn((_text:string,options:{preflightResult:(accepted:boolean)=>void})=>{preflight=options.preflightResult;return prompt.promise;})};
 const running=f.internals.promptAndBridge(session,"","run","MOCK_REQUEST");expect(preflight).toBeDefined();
 await f.service.shutdown();preflight!(true);await Promise.resolve();expect(session.abort).toHaveBeenCalledOnce();
 prompt.resolve();await running;
});

it("keeps a worker session open until both its prompt and SDK abort have settled",async()=>{
 const f=setup(),prompt=deferred<void>(undefined),entered=deferred<void>(undefined),aborted=deferred<void>(undefined);
 f.session.abort.mockReturnValue(aborted.promise);f.bridge.mockImplementation(()=>{entered.resolve();return prompt.promise;});
 await f.service.runWorker(f.root,"MOCK_REQUEST",{} as never);await entered.promise;
 const shutdown=f.service.shutdown();prompt.resolve();await new Promise<void>(resolve=>setImmediate(resolve));expect(state.disposed).not.toHaveBeenCalled();
 aborted.resolve();await shutdown;expect(state.disposed).toHaveBeenCalledExactlyOnceWith(f.session);
});

it("rejects minimal-session activation after shutdown without listing or resuming sessions",async()=>{
 const f=setup();await f.service.shutdown();
 await expect(f.service.activateSession(f.session.sessionId,f.root)).rejects.toThrow("正在退出");
 expect(state.listed).not.toHaveBeenCalled();expect(f.modelLookup).not.toHaveBeenCalled();expect(state.resumed).not.toHaveBeenCalled();
});

it.each(["list","model"])("waits for pending minimal-session %s preparation and prevents late resume",async(stage)=>{
 const f=setup(),listed=deferred([{id:f.session.sessionId,path:path.join(f.root,"synthetic.jsonl")}]),model=deferred(f.model),entered=deferred<void>(undefined);
 if(stage==="list")state.listed.mockImplementation(()=>{entered.resolve();return listed.promise;});
 else f.modelLookup.mockImplementation(()=>{entered.resolve();return model.promise;});
 const activation=f.service.activateSession(f.session.sessionId,f.root).catch(error=>error);await entered.promise;
 const shutdown=f.service.shutdown();let settled=false;void shutdown.then(()=>{settled=true;});await new Promise<void>(resolve=>setImmediate(resolve));expect(settled).toBe(false);
 if(stage==="list")listed.resolve([{id:f.session.sessionId,path:path.join(f.root,"synthetic.jsonl")}]);else model.resolve(f.model);
 expect(await activation).toMatchObject({message:expect.stringContaining("正在退出")});await shutdown;
 expect(state.resumed).not.toHaveBeenCalled();expect(f.internals.activeChats.size).toBe(0);
});

it("aborts and disposes a late minimal session before shutdown completes, without re-registering it",async()=>{
 const f=setup(),created=deferred(f.session),entered=deferred<void>(undefined),aborted=deferred<void>(undefined);
 state.resumed.mockImplementation(()=>{entered.resolve();return created.promise;});f.session.abort.mockReturnValue(aborted.promise);
 const activation=f.service.activateSession(f.session.sessionId,f.root).catch(error=>error);await entered.promise;
 const shutdown=f.service.shutdown();let settled=false;void shutdown.then(()=>{settled=true;});await new Promise<void>(resolve=>setImmediate(resolve));expect(settled).toBe(false);
 created.resolve(f.session);await new Promise<void>(resolve=>setImmediate(resolve));expect(f.session.abort).toHaveBeenCalledOnce();expect(state.disposed).not.toHaveBeenCalled();expect(settled).toBe(false);
 aborted.resolve();expect(await activation).toMatchObject({message:expect.stringContaining("正在退出")});await shutdown;
 expect(state.disposed).toHaveBeenCalledExactlyOnceWith(f.session);expect(f.internals.activeChats.size).toBe(0);expect(f.internals.activationPromises.size).toBe(0);expect(f.bridge).not.toHaveBeenCalled();
});
