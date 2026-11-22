import {EventEmitter} from "node:events";
import type {ChildProcess} from "node:child_process";
import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
import type {ExecutionContext} from "../permission/execution-context";
import type {WindowsSandboxWorkerRequest,WindowsSandboxWorkerResponse} from "./windows-worker-protocol";
const mocks=vi.hoisted(()=>({fork:vi.fn()}));
vi.mock("node:child_process",()=>({fork:mocks.fork}));
import {adoptWindowsWorker,prepareWindowsWorker,waitWindowsOwnerCleanup,wrapWithWindowsWorker,revokeWindowsExecutionOwners,shutdownWindowsExecutionWorkers} from "./windows-execution-manager";
class FakeWorker extends EventEmitter {
 sent:WindowsSandboxWorkerRequest[]=[];automatic=true;
 kill=vi.fn(()=>true);
 send=(request:WindowsSandboxWorkerRequest)=>{
  this.sent.push(request);if(this.automatic)queueMicrotask(()=>this.reply(request));return true;
 };
 reply(request:WindowsSandboxWorkerRequest){
  const response:WindowsSandboxWorkerResponse=request.type==="initialize"?{type:"ready",requestId:request.requestId}:
   request.type==="wrap"?{type:"wrapped",requestId:request.requestId,argv:["fake"],env:{}}:
   {type:"released",requestId:request.requestId};
  this.emit("message",response);
 }
}
let children:FakeWorker[]=[];
const context:ExecutionContext={mode:"standard",workspaceRealPath:"C:\\work",runtimeRoot:"C:\\runtime",environment:{},ownerId:"lifecycle-owner",policyVersion:"2"};
beforeEach(()=>{vi.useFakeTimers();children=[];mocks.fork.mockReset().mockImplementation(()=>{const worker=new FakeWorker();children.push(worker);return worker as unknown as ChildProcess;});});
afterEach(async()=>{await shutdownWindowsExecutionWorkers();expect(vi.getTimerCount()).toBe(0);vi.useRealTimers();});
describe("Windows worker instance ownership during failure and replacement",()=>{
 it("does not prepare a worker for full or readonly modes",async()=>{
  await prepareWindowsWorker({...context,mode:"full"});await prepareWindowsWorker({...context,mode:"readonly"});
  expect(children).toHaveLength(0);
 });
 it("adopts a still-initializing draft worker for the real session",async()=>{
  mocks.fork.mockImplementationOnce(()=>{const worker=new FakeWorker();worker.automatic=false;children.push(worker);return worker as unknown as ChildProcess;});
  const preparing=prepareWindowsWorker(context), worker=children[0]!;
  expect(adoptWindowsWorker("lifecycle-owner","real-owner",context.workspaceRealPath)).toBe(true);
  const command=wrapWithWindowsWorker("test",{...context,ownerId:"real-owner"});
  expect(children).toHaveLength(1);expect(worker.sent.filter(request=>request.type==="initialize")).toHaveLength(1);
  worker.automatic=true;worker.reply(worker.sent[0]!);await preparing;const lease=await command;
  expect(adoptWindowsWorker("real-owner","other",context.workspaceRealPath)).toBe(false);
  await lease.release();await revokeWindowsExecutionOwners(["real-owner"]);
 });
 it("shares one initialization between preparation and a command",async()=>{
  mocks.fork.mockImplementationOnce(()=>{const worker=new FakeWorker();worker.automatic=false;children.push(worker);return worker as unknown as ChildProcess;});
  const preparing=prepareWindowsWorker(context), command=wrapWithWindowsWorker("test",context);
  const worker=children[0]!;expect(worker.sent.filter(request=>request.type==="initialize")).toHaveLength(1);
  worker.reply(worker.sent[0]!);await preparing;await Promise.resolve();
  const wrap=worker.sent.find(request=>request.type==="wrap");expect(wrap).toBeDefined();worker.automatic=true;worker.reply(wrap!);
  const lease=await command;await lease.release();await revokeWindowsExecutionOwners(["lifecycle-owner"]);
 });
 it("waits for preparation to settle before revoking and rejects a concurrent command",async()=>{
  mocks.fork.mockImplementationOnce(()=>{const worker=new FakeWorker();worker.automatic=false;children.push(worker);return worker as unknown as ChildProcess;});
  const preparing=prepareWindowsWorker(context);const rejection=expect(preparing).rejects.toThrow("正在关闭");
  const revoke=revokeWindowsExecutionOwners(["lifecycle-owner"]);const worker=children[0]!;
  await expect(wrapWithWindowsWorker("late",context)).rejects.toThrow("正在关闭");
  expect(worker.sent.some(request=>request.type==="shutdown")).toBe(false);
  worker.automatic=true;worker.reply(worker.sent[0]!);await rejection;await revoke;
  expect(worker.sent.filter(request=>request.type==="shutdown")).toHaveLength(1);
  expect(worker.sent.some(request=>request.type==="wrap")).toBe(false);
 });
 it("does not close a worker while wrapping, and does not start the revoked command",async()=>{
  await prepareWindowsWorker(context);const worker=children[0]!;worker.automatic=false;
  const command=wrapWithWindowsWorker("pending",context);const rejected=expect(command).rejects.toThrow("未启动命令");
  await Promise.resolve();const wrap=worker.sent.find(request=>request.type==="wrap");expect(wrap).toBeDefined();
  await revokeWindowsExecutionOwners(["lifecycle-owner"]);
  let cleanupDone = false;
  const cleanup = waitWindowsOwnerCleanup("lifecycle-owner").then(() => { cleanupDone = true; });
  await vi.advanceTimersByTimeAsync(0);
  expect(cleanupDone).toBe(false);
  expect(worker.sent.some(request=>request.type==="shutdown")).toBe(false);
  worker.automatic=true;worker.reply(wrap!);await rejected;
  expect(worker.sent.filter(request=>request.type==="release")).toHaveLength(1);
  expect(worker.sent.filter(request=>request.type==="shutdown")).toHaveLength(1);
  await cleanup;
 });
 it("waits for ordinary cancellation before initializing another owner in the same workspace",async()=>{
  const first = prepareWindowsWorker(context);
  const rejected = expect(first).rejects.toThrow("正在关闭");
  const worker = children[0]!;
  worker.automatic = false;
  const cleanup = revokeWindowsExecutionOwners(["lifecycle-owner"]);
  const next = prepareWindowsWorker({...context, ownerId:"next-owner"});
  expect(children).toHaveLength(1);
  worker.automatic = true;
  worker.reply(worker.sent[0]!);
  await rejected;
  await cleanup;
  await next;
  expect(children).toHaveLength(2);
 });
 it("lets timed-out initialization settle before cleanup and replacement",async()=>{
  mocks.fork.mockImplementationOnce(()=>{const worker=new FakeWorker();worker.automatic=false;children.push(worker);return worker as unknown as ChildProcess;});
  const first=wrapWithWindowsWorker("first",context);const rejected=expect(first).rejects.toThrow("初始化超时");
  expect(children[0]!.sent[0]).toMatchObject({
   type:"initialize", policy:{filesystem:{allowWrite:expect.arrayContaining([context.workspaceRealPath,context.runtimeRoot])}},
  });
  await vi.advanceTimersByTimeAsync(60_000);await rejected;
  expect(children[0]!.kill).not.toHaveBeenCalled();
  await expect(wrapWithWindowsWorker("too-early",context)).rejects.toThrow("正在关闭");
  children[0]!.automatic=true;children[0]!.reply(children[0]!.sent[0]!);
  await revokeWindowsExecutionOwners(["lifecycle-owner"]);
  const second=await wrapWithWindowsWorker("second",context);const replacement=children[1]!;
  children[0]!.emit("exit",null,"SIGTERM");children[0]!.emit("error",new Error("late error"));
  const third=await wrapWithWindowsWorker("third",context);expect(children).toHaveLength(2);expect(replacement.kill).not.toHaveBeenCalled();
  expect(children[0]!.kill).toHaveBeenCalledOnce();
  await revokeWindowsExecutionOwners(["lifecycle-owner"]);expect(replacement.sent.some(message=>message.type==="shutdown")).toBe(false);
  await second.release();expect(replacement.sent.some(message=>message.type==="shutdown")).toBe(false);
  await third.release();expect(replacement.sent.filter(message=>message.type==="shutdown")).toHaveLength(1);expect(replacement.kill).toHaveBeenCalledOnce();
 });
 it("does not start another owner on the project while a timed-out worker is cleaning up",async()=>{
  mocks.fork.mockImplementationOnce(()=>{const worker=new FakeWorker();worker.automatic=false;children.push(worker);return worker as unknown as ChildProcess;});
  const first=prepareWindowsWorker(context);const rejected=expect(first).rejects.toThrow("初始化超时");
  await vi.advanceTimersByTimeAsync(60_000);await rejected;
  const controller=new AbortController();
  const other=wrapWithWindowsWorker("other",{...context,ownerId:"other-owner"},undefined,undefined,controller.signal);
  const otherRejected=expect(other).rejects.toMatchObject({name:"AbortError"});
  await Promise.resolve();expect(children).toHaveLength(1);controller.abort();await otherRejected;
  children[0]!.automatic=true;children[0]!.reply(children[0]!.sent[0]!);await revokeWindowsExecutionOwners(["lifecycle-owner"]);
  expect(children[0]!.sent.filter(request=>request.type==="shutdown")).toHaveLength(1);
 });
 it("does not report cleanup complete when timed-out initialization subsequently fails",async()=>{
  mocks.fork.mockImplementationOnce(()=>{const worker=new FakeWorker();worker.automatic=false;children.push(worker);return worker as unknown as ChildProcess;});
  const first=prepareWindowsWorker(context);const rejected=expect(first).rejects.toThrow("初始化超时");
  await vi.advanceTimersByTimeAsync(60_000);await rejected;
  const cleanup=waitWindowsOwnerCleanup("lifecycle-owner");const cleanupRejected=expect(cleanup).rejects.toThrow("fixture initialization failed");
  children[0]!.emit("message",{type:"error",requestId:children[0]!.sent[0]!.requestId,message:"fixture initialization failed"});
  await cleanupRejected;
 });
 it("cleans up after the sole initialization waiter cancels without killing an in-flight ACL operation",async()=>{
  mocks.fork.mockImplementationOnce(()=>{const worker=new FakeWorker();worker.automatic=false;children.push(worker);return worker as unknown as ChildProcess;});
  const controller=new AbortController();const preparing=prepareWindowsWorker(context,controller.signal);
  const rejected=expect(preparing).rejects.toMatchObject({name:"AbortError"});controller.abort();await rejected;
  expect(children[0]!.kill).not.toHaveBeenCalled();
  await expect(prepareWindowsWorker(context)).rejects.toThrow("正在关闭");
  children[0]!.automatic=true;children[0]!.reply(children[0]!.sent[0]!);await revokeWindowsExecutionOwners(["lifecycle-owner"]);
  expect(children[0]!.sent.filter(request=>request.type==="shutdown")).toHaveLength(1);
 });
 it("releases a wrapped lease if its caller cancels before the result arrives",async()=>{
  await prepareWindowsWorker(context);const worker=children[0]!;worker.automatic=false;
  const controller=new AbortController();const command=wrapWithWindowsWorker("pending",context,undefined,undefined,controller.signal);
  const rejected=expect(command).rejects.toMatchObject({name:"AbortError"});await Promise.resolve();
  const wrap=worker.sent.find(request=>request.type==="wrap");expect(wrap).toBeDefined();controller.abort();
  worker.automatic=true;worker.reply(wrap!);await rejected;
  expect(worker.sent.filter(request=>request.type==="release")).toHaveLength(1);
  await revokeWindowsExecutionOwners(["lifecycle-owner"]);
 });
 it("rejects old lease operations immediately without timing out or touching the new instance",async()=>{
  const old=await wrapWithWindowsWorker("old",context);const worker=children[0]!;
  worker.emit("exit",1,null);expect(worker.kill).toHaveBeenCalledOnce();
  const current=await wrapWithWindowsWorker("current",context);await old.release();
  expect(vi.getTimerCount()).toBe(0);expect(children).toHaveLength(2);expect(children[1]!.kill).not.toHaveBeenCalled();
  await current.release();await revokeWindowsExecutionOwners(["lifecycle-owner"]);expect(children[1]!.sent.some(message=>message.type==="shutdown")).toBe(true);
 });
 it("settles every pending call once and ignores late responses from the timed-out instance",async()=>{
  const first=await wrapWithWindowsWorker("ready",context),worker=children[0]!;worker.automatic=false;
  const a=wrapWithWindowsWorker("a",context),b=wrapWithWindowsWorker("b",context);
  const settled=Promise.allSettled([a,b]);await Promise.resolve();await vi.advanceTimersByTimeAsync(30_000);
  const results=await settled;expect(results.every(result=>result.status==="rejected")).toBe(true);expect(worker.kill).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  const next=await wrapWithWindowsWorker("next",context);
  for(const request of worker.sent)worker.reply(request);worker.emit("exit",null,"SIGTERM");
  await first.release();await next.release();await shutdownWindowsExecutionWorkers();expect(children[1]!.kill).toHaveBeenCalledOnce();expect(children).toHaveLength(2);
 });
 it("coalesces shutdown and does not delete a replacement after a late shutdown exit",async()=>{
  const first=await wrapWithWindowsWorker("ready",context);await first.release();
  await Promise.all([revokeWindowsExecutionOwners(["lifecycle-owner"]),shutdownWindowsExecutionWorkers()]);
  const worker=children[0]!;expect(worker.sent.filter(message=>message.type==="shutdown")).toHaveLength(1);expect(worker.kill).toHaveBeenCalledOnce();
  const next=await wrapWithWindowsWorker("next",context);worker.emit("exit",0,null);
  const extra=await wrapWithWindowsWorker("extra",context);expect(children).toHaveLength(2);await next.release();await extra.release();
 });
});
