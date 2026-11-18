import fs from "node:fs";
import {EventEmitter} from "node:events";
import ts from "typescript";
import {afterEach,expect,it,vi} from "vitest";
import {AgentService} from "./services/agent-service";
import {MemoryService} from "./services/memory/service";
import {MemoryClient} from "./services/memory/client";
import {backgroundShellRegistry} from "./services/background-shell/registry";
import * as piSession from "./services/pi-session";
import {createDelegation,finishDelegation,resetRegistry} from "./services/task/registry";
vi.mock("electron",()=>({app:{isPackaged:false,getPath:()=>"/tmp"},BrowserWindow:{getAllWindows:()=>[]}}));
vi.mock("./services/ipc-broadcast",()=>({broadcast:vi.fn(),broadcastEvent:vi.fn()}));
afterEach(()=>{resetRegistry();vi.restoreAllMocks();vi.useRealTimers();});

it("sends every cancellation and frozen-PID TERM/KILL before a slow memory close exhausts the quit budget",async()=>{
 vi.useFakeTimers();vi.setSystemTime(0);
 const events:Array<{name:string;at:number}>=[],note=(name:string)=>{events.push({name,at:Date.now()});};
 let blocked=false,release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});
 // No Worker is constructed. Its RPCs are mocked, while both bounded close methods are real.
 const client=Object.create(MemoryClient.prototype) as any;
 Object.assign(client,{closing:false,pending:new Map(),worker:{terminate:vi.fn(async()=>note("memory-worker-terminate"))}});
 client.call=vi.fn(async(method:string)=>{
   if(method==="close"){note("memory-close-start");return new Promise(()=>{});}
   if(method==="evaluate"){if(blocked){entered();await gate;}return {count:0};}
   if(method==="status")return {count:0,pending:0,usedTokens:0};
   if(method==="cleanupLegacyProjects")return {warnings:[]};
   if(method==="ensureRoutine")return {nextDueAt:3600000};
   if(method==="checkCapacity")return {needsCompaction:false};
   return undefined;
 });
 const store={getSettings:()=>({memory:{enabled:true,background:true,enabledAt:1}}),getDataDir:()=>"/mock-no-files",getProjects:()=>[]} as any;
 const memory=new MemoryService(store,{createPort:()=>client,busy:()=>false,getBackend:vi.fn(async()=>{throw new Error("unexpected model");})});
 await memory.initialize();blocked=true;const pump=memory.pump(true);await ready;
 const chatController=new AbortController(),workerController=new AbortController();
 let liveProcesses=[102],liveTracked=[103];
 const delegation=createDelegation("detached-parent",[{task:"MOCK_TASK",agent:"default-builder"}]);
 delegation.taskAbortControllers[0]!.signal.addEventListener("abort",()=>{note("delegated-task-abort");finishDelegation(delegation,"aborted");});
 chatController.signal.addEventListener("abort",()=>note("chat-controller-abort"));workerController.signal.addEventListener("abort",()=>note("worker-controller-abort"));
 const service=Object.create(AgentService.prototype) as any;
 Object.assign(service,{memory,pendingSends:new Set(),activationPromises:new Map(),activeChats:new Map([["chat",{sessionId:"fixture-main",abortController:chatController,session:{abort:vi.fn(async()=>{note("chat-sdk-abort");liveProcesses=[];liveTracked=[];})}}]]),activeRuns:new Map([["worker",{abortController:workerController,session:{abort:vi.fn(async()=>note("worker-sdk-abort"))}}]]),streamBuffer:new Map()});
 vi.spyOn(piSession,"disposePiSession").mockImplementation(async()=>note("session-dispose"));
 let liveShells=[{child:{pid:101}}];
 vi.spyOn(backgroundShellRegistry,"list").mockImplementation(()=>liveShells as any);
 const stopShells=vi.spyOn(backgroundShellRegistry,"stopAll").mockImplementation(()=>{note("shell-TERM");liveShells=[];});
 const killShells=vi.spyOn(backgroundShellRegistry,"forceKillAll").mockImplementation(()=>note("shell-KILL"));
 const app=new EventEmitter() as EventEmitter & {quit:()=>void};
 app.quit=()=>{let prevented=false;app.emit("before-quit",{preventDefault:()=>{prevented=true;}});if(!prevented)note("app-exit");};
 // Run only the production cleanup declarations and handler, never the Electron entrypoint.
 const source=fs.readFileSync("app/main/index.ts","utf8"),start=source.indexOf("const QUIT_CLEANUP_TIMEOUT_MS ="),end=source.indexOf("// 异常退出兜底:",start);
 expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
 const cleanup=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const stopProcesses=vi.fn((signal:string)=>note("process-"+signal)),stopTracked=vi.fn((signal:string)=>note("tracked-"+signal));
 const bindings={app,desktopTray:undefined,backgroundShellRegistry,snapshotProcessPids:()=>[...liveProcesses],snapshotTrackedChildren:()=>[...liveTracked],closeAllMcpClients:async()=>note("mcp-close"),shutdownWindowsExecutionWorkers:async()=>note("windows-worker-shutdown"),sharedServices:{agentService:service,remoteTerminalService:{close:()=>note("remote-close")}},closeAssetPreviews:async()=>note("asset-close"),stopMobileWebService:async()=>note("mobile-close"),stopAllProcesses:stopProcesses,signalTrackedChildren:stopTracked,releaseSandbox:async()=>note("sandbox-release")};
 new Function(...Object.keys(bindings),cleanup)(...Object.values(bindings));
 app.quit();const shutdown=service.shutdown();expect(service.shutdown()).toBe(shutdown);
 expect(chatController.signal.aborted).toBe(true);expect(workerController.signal.aborted).toBe(true);expect(delegation.taskAbortControllers[0]!.signal.aborted).toBe(true);expect(stopShells).toHaveBeenCalledOnce();
 let settled=false;void shutdown.then(()=>{settled=true;});
 await vi.advanceTimersByTimeAsync(300);
 expect(stopProcesses).toHaveBeenCalledWith("SIGTERM",[102]);expect(stopTracked).toHaveBeenCalledWith("SIGTERM",[103]);
 expect(killShells).toHaveBeenCalledWith([101]);expect(stopProcesses).toHaveBeenCalledWith("SIGKILL",[102]);expect(stopTracked).toHaveBeenCalledWith("SIGKILL",[103]);
 expect(events).toContainEqual({name:"shell-KILL",at:300});expect(settled).toBe(false);
 await vi.advanceTimersByTimeAsync(2699);expect(events.some(event=>event.name==="app-exit")).toBe(false);
 await vi.advanceTimersByTimeAsync(1);expect(events).toContainEqual({name:"app-exit",at:3000});expect(settled).toBe(false);
 for(const name of ["chat-sdk-abort","worker-sdk-abort","delegated-task-abort","shell-TERM","process-SIGTERM","tracked-SIGTERM"])expect(events).toContainEqual({name,at:0});
 await vi.advanceTimersByTimeAsync(2000);await shutdown;expect(settled).toBe(true);expect(events).toContainEqual({name:"memory-worker-terminate",at:5000});
 release();await pump;await memory.close();vi.clearAllTimers();
});
