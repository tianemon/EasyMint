import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { buildExecutionPolicy } from "../permission/access-policy";
import type { ExecutionContext } from "../permission/execution-context";
import type { WindowsSandboxWorkerRequest, WindowsSandboxWorkerResponse } from "./windows-worker-protocol";

export interface WindowsWrappedCommand {
  argv: string[];
  env: NodeJS.ProcessEnv;
  release: () => Promise<void>;
  /** 沙盒违规归因键（= 本次 wrap 的 leaseId）。执行结束时的 stderr 注解必须用它，
   *  否则 srt 的违规存储匹配不上，拦截事件对用户与模型静默（同 manager.annotateSandboxFailures）。 */
  commandId: string;
}

interface WorkerHandle {
  key: string;
  child: ChildProcess;
  pending: Map<string, { resolve: (message: WindowsSandboxWorkerResponse) => void; reject: (error: Error) => void }>;
  initialized: boolean;
  leases: Set<string>;
  revoking: boolean;
  failure?:Error;
  shutdown?:Promise<void>;
}

const workers = new Map<string, WorkerHandle>();
let sequence = 0;
type WithoutRequestId<T> = T extends unknown ? Omit<T, "requestId"> : never;
type WorkerRequestWithoutId = WithoutRequestId<WindowsSandboxWorkerRequest>;

/** 导出为纯函数，覆盖 Windows worker 隔离维度的回归测试。 */
export function windowsWorkerKey(context: ExecutionContext): string {
  return [context.ownerId ?? "shared", context.workspaceRealPath, context.runtimeRoot, context.mode, context.policyVersion, context.bundledRuntimeRoot ?? ""].join("\u0000");
}

/** 单次往返与初始化的上限（初始化要建 ACL，给宽一点） */
const CALL_TIMEOUT_MS = 30_000;
const INIT_TIMEOUT_MS = 60_000;

function requestId(): string { return `win-srt-${process.pid}-${Date.now()}-${++sequence}`; }

function workerEntrypoint(): string {
  // Electron runs the script by its logical path so Node resolves dependencies in app.asar.
  return path.join(__dirname, "windows-sandbox-worker.cjs");
}

/** 让这个 worker 上的所有等待一起失败，并把它换掉（超时 / 退出都走这里，避免留下"半死不活"的 worker） */
function failWorker(worker: WorkerHandle, message: string): void {
  if(worker.failure)return;
  worker.failure=new Error(message);
  for (const pending of worker.pending.values()) pending.reject(worker.failure);
  worker.pending.clear();
  // A killed worker may emit exit after a replacement has acquired the same key.
  // Only this instance's registration may be removed, and kill/settle run once.
  if(workers.get(worker.key)===worker)workers.delete(worker.key);
  try { worker.child.kill(); } catch { /* 已退出 */ }
}

function createWorker(key: string): WorkerHandle {
  const child = fork(workerEntrypoint(), [], { stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true });
  const handle: WorkerHandle = { key, child, pending: new Map(), initialized: false, leases: new Set(), revoking: false };
  const fail = (message: string) => failWorker(handle, message);
  child.on("message", (message: WindowsSandboxWorkerResponse) => {
    const pending = handle.pending.get(message.requestId);
    if (!pending) return;
    handle.pending.delete(message.requestId);
    if (message.type === "error") pending.reject(new Error(message.message));
    else pending.resolve(message);
  });
  child.once("error", (error) => fail(`Windows 沙盒 worker 启动失败：${error.message}`));
  child.once("exit", (code, signal) => fail(`Windows 沙盒 worker 已退出（${signal ?? code ?? "未知原因"}）`));
  workers.set(key, handle);
  return handle;
}

/**
 * 给每次 worker 往返加超时：worker 卡在原生调用里时既不回消息、也不退出，原先这个 promise
 * 就永久 pending —— 界面上那条命令永远是"运行中"，只能重启应用。超时后连同 worker 一起换掉，
 * 下一条命令重新初始化，不会每次都再等一个超时。
 */
function call(handle: WorkerHandle, message: WorkerRequestWithoutId): Promise<WindowsSandboxWorkerResponse> {
  if(handle.failure)return Promise.reject(handle.failure);
  const id = requestId();
  const limit = message.type === "initialize" ? INIT_TIMEOUT_MS : CALL_TIMEOUT_MS;
  const note = message.type === "initialize"
    ? "沙盒初始化超时（60 秒），这次先放弃了。可以再试一次；一直这样的话，去 设置 → 环境检测 修复一下运行环境。"
    : "沙盒 30 秒没有响应，这条命令先停了。可以重试一次；反复出现的话，去 设置 → 环境检测 修复一下运行环境。";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => failWorker(handle, note), limit);
    const settle = <T>(fn: (value: T) => void) => (value: T): void => { clearTimeout(timer); fn(value); };
    handle.pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
    try { handle.child.send({ ...message, requestId: id } as WindowsSandboxWorkerRequest); }
    catch (error) { clearTimeout(timer); handle.pending.delete(id); reject(error as Error); }
  });
}

async function ready(context: ExecutionContext): Promise<WorkerHandle> {
  const key = windowsWorkerKey(context);
  const existing = workers.get(key);
  if (existing?.initialized) return existing;
  const policy = buildExecutionPolicy(context);
  const handle = existing ?? createWorker(key);
  const response = await call(handle, { type: "initialize", context, policy });
  if (response.type !== "ready") throw new Error("Windows 沙盒初始化返回无效响应");
  handle.initialized = true;
  return handle;
}

export async function wrapWithWindowsWorker(
  command: string,
  context: ExecutionContext,
  gitBashPath?: string,
  shell: "bash" | "powershell" = "bash",
): Promise<WindowsWrappedCommand> {
  const handle = await ready(context);
  const leaseId = requestId();
  const response = await call(handle, { type: "wrap", command, shell, gitBashPath, commandId: leaseId });
  if (response.type !== "wrapped") throw new Error("Windows 沙盒包装返回无效响应");
  handle.leases.add(leaseId);
  let released = false;
  return {
    argv: response.argv,
    env: response.env,
    commandId: leaseId,
    release: async () => {
      if (released) return;
      released = true;
      handle.leases.delete(leaseId);
      try { await call(handle, { type: "release", leaseId }); } catch { /* 失效实例不重放；后续初始化由 SRT 恢复 dead-PID 的授权记录。 */ }
      if (handle.revoking && handle.leases.size === 0) await shutdownWorker(handle);
    },
  };
}

/** 权限降级和应用退出时调用。先由上层停掉进程，再销毁同一 owner 的 worker/ACL。 */
export async function revokeWindowsExecutionOwners(ownerIds: readonly string[]): Promise<void> {
  const wanted = new Set(ownerIds.filter(Boolean));
  const closing = [...workers.values()].filter((worker) => wanted.has(worker.key.split("\u0000", 1)[0] ?? ""));
  await Promise.allSettled(closing.map(async (worker) => {
    worker.revoking = true;
    if (worker.leases.size === 0) await shutdownWorker(worker);
  }));
}

function shutdownWorker(worker: WorkerHandle, force = false): Promise<void> {
  if(worker.shutdown)return worker.shutdown;
  if (workers.get(worker.key)!==worker || worker.failure) return Promise.resolve();
  return worker.shutdown=(async()=>{
    try { await call(worker, { type: "shutdown", force }); }
    finally { failWorker(worker,"Windows 沙盒 worker 已关闭"); }
  })();
}

export async function shutdownWindowsExecutionWorkers(): Promise<void> {
  // 应用退出时不等待前台命令自然结束：先回收 worker 写入的 ACL，再结束进程。
  await Promise.allSettled([...workers.values()].map((worker) => shutdownWorker(worker, true)));
}
