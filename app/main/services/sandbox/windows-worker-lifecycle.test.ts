import {EventEmitter} from "node:events";
import type {ChildProcess} from "node:child_process";
import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
import type {ExecutionContext} from "../permission/execution-context";
import type {WindowsSandboxWorkerRequest,WindowsSandboxWorkerResponse} from "./windows-worker-protocol";
const mocks=vi.hoisted(()=>({fork:vi.fn()}));
vi.mock("node:child_process",()=>({fork:mocks.fork}));
import {wrapWithWindowsWorker,revokeWindowsExecutionOwners,shutdownWindowsExecutionWorkers} from "./windows-execution-manager";
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
 it("retains the replacement after an old timeout/exit and still revokes it after leases release",async()=>{
  mocks.fork.mockImplementationOnce(()=>{const worker=new FakeWorker();worker.automatic=false;children.push(worker);return worker as unknown as ChildProcess;});
  const first=wrapWithWindowsWorker("first",context);const rejected=expect(first).rejects.toThrow("初始化超时");
  expect(children[0]!.sent[0]?.type).toBe("initialize");await vi.advanceTimersByTimeAsync(60_000);await rejected;
  const second=await wrapWithWindowsWorker("second",context);const replacement=children[1]!;
  children[0]!.emit("exit",null,"SIGTERM");children[0]!.emit("error",new Error("late error"));
  const third=await wrapWithWindowsWorker("third",context);expect(children).toHaveLength(2);expect(replacement.kill).not.toHaveBeenCalled();
  expect(children[0]!.kill).toHaveBeenCalledOnce();
  await revokeWindowsExecutionOwners(["lifecycle-owner"]);expect(replacement.sent.some(message=>message.type==="shutdown")).toBe(false);
  await second.release();expect(replacement.sent.some(message=>message.type==="shutdown")).toBe(false);
  await third.release();expect(replacement.sent.filter(message=>message.type==="shutdown")).toHaveLength(1);expect(replacement.kill).toHaveBeenCalledOnce();
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
