import { fork, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
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
  initializing?: Promise<void>;
  initializationWait?: Promise<void>;
  initializationWaiters: number;
  leases: Set<string>;
  revoking: boolean;
  failure?:Error;
  shutdown?:Promise<void>;
  resumeShutdown?: () => void;
  forceShutdown?: boolean;
}

const workers = new Map<string, WorkerHandle>();
let sequence = 0;
let shutdownPermanently = false;
type WithoutRequestId<T> = T extends unknown ? Omit<T, "requestId"> : never;
type WorkerRequestWithoutId = WithoutRequestId<WindowsSandboxWorkerRequest>;

/** 导出为纯函数，覆盖 Windows worker 隔离维度的回归测试。 */
export function windowsWorkerKey(context: ExecutionContext, policy: SandboxRuntimeConfig = buildExecutionPolicy(context)): string {
  const fingerprint = createHash("sha256").update(JSON.stringify(policy)).digest("hex");
  return [context.ownerId ?? "shared", context.workspaceRealPath, context.runtimeRoot, context.mode, context.policyVersion, context.bundledRuntimeRoot ?? "", fingerprint].join("\u0000");
}

/** 单次往返与初始化的上限（初始化要建 ACL，给宽一点） */
const CALL_TIMEOUT_MS = 30_000;
const INIT_TIMEOUT_MS = 60_000;
// The upstream ACL grant has a ten-minute timeout. Keep its holder alive to
// finish and reset after our user-facing deadline instead of killing it mid-write.
const INIT_HARD_TIMEOUT_MS = 660_000;

export class WindowsSandboxInitializationTimeout extends Error {
  constructor() {
    super("沙盒初始化超时（60 秒），命令未运行；后台仍在安全收尾，请稍后重试。");
    this.name = "WindowsSandboxInitializationTimeout";
  }
}

/** Native stderr can begin with successful placeholder creation. Surface the
 * final batch failure and the paths that actually failed instead. */
export function summarizeWindowsSandboxInitError(message: string): string {
  const batch = /(?:^|\n).*?error: (\d+) of \d+ path\(s\) could not be granted; batch rolled back/iu.exec(message);
  if (!batch) return message;
  const targets = [...new Set([...message.matchAll(/srt-win: deny '(.+?)': (?:recompose|capture)/gu)]
    .map(match => match[1]!.replace(/^\\\\\?\\/u, "")))];
  const detail = targets.length ? `。失败路径：${targets.slice(0, 2).join("、")}${targets.length > 2 ? " 等" : ""}` : "";
  return `Windows 沙盒无法应用 ${batch[1]} 项文件权限，授权批次已回滚${detail}。完整原因见应用日志。`;
}

function requestId(): string { return `win-srt-${process.pid}-${Date.now()}-${++sequence}`; }

function workerEntrypoint(): string {
  // Electron runs the script by its logical path so Node resolves dependencies in app.asar.
  return path.join(__dirname, "windows-sandbox-worker.cjs");
}

/** 让这个 worker 上的所有等待一起失败，并把它换掉（超时 / 退出都走这里，避免留下"半死不活"的 worker） */
function failWorker(worker: WorkerHandle, message: string): void {
  if(worker.failure)return;
  worker.failure=new Error(message);
  worker.resumeShutdown?.();
  for (const pending of worker.pending.values()) pending.reject(worker.failure);
  worker.pending.clear();
  // A killed worker may emit exit after a replacement has acquired the same key.
  // Only this instance's registration may be removed, and kill/settle run once.
  if(workers.get(worker.key)===worker)workers.delete(worker.key);
  try { worker.child.kill(); } catch { /* 已退出 */ }
}

function createWorker(key: string): WorkerHandle {
  const child = fork(workerEntrypoint(), [], { stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true });
  const handle: WorkerHandle = { key, child, pending: new Map(), initialized: false, initializationWaiters: 0, leases: new Set(), revoking: false };
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
  const limit = message.type === "initialize" ? INIT_HARD_TIMEOUT_MS : CALL_TIMEOUT_MS;
  const note = message.type === "initialize"
    ? "沙盒初始化长时间没有响应，已停止等待；后续启动会检查遗留状态。"
    : "沙盒 30 秒没有响应，这条命令先停了。可以重试一次；反复出现的话，去 设置 → 环境检测 修复一下运行环境。";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => failWorker(handle, note), limit);
    const settle = <T>(fn: (value: T) => void) => (value: T): void => { clearTimeout(timer); fn(value); };
    handle.pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
    try { handle.child.send({ ...message, requestId: id } as WindowsSandboxWorkerRequest); }
    catch (error) { clearTimeout(timer); handle.pending.delete(id); reject(error as Error); }
  });
}

async function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason ?? new DOMException("Cancelled", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

async function ready(context: ExecutionContext, signal?: AbortSignal): Promise<WorkerHandle> {
  if (shutdownPermanently) throw new Error("应用正在退出，不能启动 Windows 沙盒");
  signal?.throwIfAborted();
  // A cancelled or timed-out preparation may still be applying ACLs. Wait
  // for that cleanup, but don't block on another session's live commands.
  const draining = [...workers.values()].filter(worker => {
    const [owner, root] = worker.key.split("\u0000");
    return owner !== (context.ownerId ?? "shared") && root === context.workspaceRealPath && worker.leases.size === 0 && !!worker.shutdown;
  }).map(worker => worker.shutdown!);
  if (draining.length) await waitWithSignal(Promise.all(draining), signal);
  if (shutdownPermanently) throw new Error("应用正在退出，不能启动 Windows 沙盒");
  signal?.throwIfAborted();
  const policy = buildExecutionPolicy(context);
  const key = windowsWorkerKey(context, policy);
  const existing = workers.get(key);
  const handle = existing ?? createWorker(key);
  if (handle.revoking) throw new Error("Windows 沙盒正在关闭，请稍后重试");
  if (!handle.initialized) {
    handle.initializing ??= (async () => {
      const response = await call(handle, { type: "initialize", context, policy });
      if (response.type !== "ready") throw new Error("Windows 沙盒初始化返回无效响应");
      handle.initialized = true;
    })().catch(error => {
      const detail = error instanceof Error ? error.message : String(error);
      const summary = summarizeWindowsSandboxInitError(detail);
      if (summary !== detail) console.warn("[sandbox] Windows ACL 初始化失败:", detail);
      failWorker(handle, summary);
      throw summary === detail ? error : new Error(summary, { cause: error });
    });
    handle.initializationWait ??= new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        handle.revoking = true;
        reject(new WindowsSandboxInitializationTimeout());
        void shutdownWorker(handle).catch(error => console.warn("[sandbox] 超时后的收尾失败:", error));
      }, INIT_TIMEOUT_MS);
      handle.initializing!.then(() => { clearTimeout(timer); resolve(); }, error => { clearTimeout(timer); reject(error); });
    });
    handle.initializationWaiters++;
    try { await waitWithSignal(handle.initializationWait, signal); }
    finally {
      handle.initializationWaiters--;
      if (signal?.aborted && handle.initializationWaiters === 0 && !handle.initialized && !handle.revoking) {
        handle.revoking = true;
        void shutdownWorker(handle).catch(error => console.warn("[sandbox] 取消准备后的收尾失败:", error));
      }
    }
  }
  if (handle.revoking || handle.failure) throw handle.failure ?? new Error("Windows 沙盒正在关闭，请稍后重试");
  return handle;
}

/** Prepare without starting a command; the real execution shares the same worker. */
export async function prepareWindowsWorker(context: ExecutionContext, signal?: AbortSignal): Promise<void> {
  if (context.mode !== "standard") return;
  await ready(context, signal);
}

export async function waitWindowsOwnerCleanup(owner: string): Promise<void> {
  const pending = [...workers.values()].filter(worker => worker.key.split("\u0000", 1)[0] === owner && worker.revoking && worker.shutdown)
    .map(worker => worker.shutdown!);
  const results = await Promise.allSettled(pending);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
}

/** Transfer an unused draft worker to the real session without changing its sandbox policy. */
export function adoptWindowsWorker(from: string, to: string, workspace: string): boolean {
  const candidates = [...workers.values()].filter(worker => {
    const [owner, root] = worker.key.split("\u0000");
    return owner === from && root === workspace;
  });
  if (candidates.some(worker => worker.revoking || worker.failure || worker.leases.size > 0)) return false;
  const renamed = candidates.map(worker => ({ worker, key: [to, ...worker.key.split("\u0000").slice(1)].join("\u0000") }));
  if (renamed.some(item => workers.has(item.key))) return false;
  for (const { worker, key } of renamed) {
    workers.delete(worker.key); worker.key = key; workers.set(key, worker);
  }
  return true;
}

export async function wrapWithWindowsWorker(
  command: string,
  context: ExecutionContext,
  gitBashPath?: string,
  shell: "bash" | "powershell" = "bash",
  signal?: AbortSignal,
): Promise<WindowsWrappedCommand> {
  const handle = await ready(context, signal);
  signal?.throwIfAborted();
  const leaseId = requestId();
  if (handle.revoking) throw new Error("Windows 沙盒正在关闭，请稍后重试");
  // Reserve before the asynchronous wrap: revocation must not close the worker mid-wrap.
  handle.leases.add(leaseId);
  let response: WindowsSandboxWorkerResponse;
  try {
    response = await call(handle, { type: "wrap", command, shell, gitBashPath, commandId: leaseId, environment: context.environment });
    if (response.type !== "wrapped") throw new Error("Windows 沙盒包装返回无效响应");
    if (handle.revoking || signal?.aborted) {
      await call(handle, { type: "release", leaseId });
      signal?.throwIfAborted();
      throw new Error("Windows 沙盒正在关闭，未启动命令");
    }
  } catch (error) {
    await finishLease(handle, leaseId);
    throw error;
  }
  if (response.type !== "wrapped") throw new Error("Windows 沙盒包装返回无效响应");
  let released = false;
  return {
    argv: response.argv,
    env: response.env,
    commandId: leaseId,
    release: async () => {
      if (released) return;
      released = true;
      try { await call(handle, { type: "release", leaseId }); } catch { /* 失效实例不重放；后续初始化由 SRT 恢复 dead-PID 的授权记录。 */ }
      await finishLease(handle, leaseId);
    },
  };
}

async function finishLease(worker: WorkerHandle, leaseId: string): Promise<void> {
  worker.leases.delete(leaseId);
  if (worker.leases.size === 0 && worker.shutdown) {
    worker.resumeShutdown?.();
    await worker.shutdown;
  }
}

/** 权限降级和应用退出时调用。先由上层停掉进程，再销毁同一 owner 的 worker/ACL。 */
export async function revokeWindowsExecutionOwners(ownerIds: readonly string[]): Promise<void> {
  const wanted = new Set(ownerIds.filter(Boolean));
  const closing = [...workers.values()].filter((worker) => wanted.has(worker.key.split("\u0000", 1)[0] ?? ""));
  const results = await Promise.allSettled(closing.map(async (worker) => {
    const shutdown = shutdownWorker(worker);
    if (worker.leases.size === 0) await shutdown;
    else void shutdown.catch(error => console.warn("[sandbox] 执行结束后的沙盒清理失败:", error));
  }));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
}

function shutdownWorker(worker: WorkerHandle, force = false): Promise<void> {
  if (force) {
    worker.forceShutdown = true;
    worker.resumeShutdown?.();
  }
  if(worker.shutdown)return worker.shutdown;
  if (worker.failure) return Promise.reject(worker.failure);
  if (workers.get(worker.key)!==worker) return Promise.resolve();
  return worker.shutdown=(async()=>{
    worker.revoking = true;
    await worker.initializing?.catch(() => undefined);
    if (!worker.failure && !worker.forceShutdown && worker.leases.size > 0) {
      await new Promise<void>(resolve => { worker.resumeShutdown = resolve; });
      worker.resumeShutdown = undefined;
    }
    if (worker.failure) throw worker.failure;
    if (workers.get(worker.key) !== worker) return;
    try { await call(worker, { type: "shutdown", force: worker.forceShutdown ?? false }); }
    finally { failWorker(worker,"Windows 沙盒 worker 已关闭"); }
  })();
}

export async function shutdownWindowsExecutionWorkers(options?: { permanent?: boolean }): Promise<void> {
  if (options?.permanent) shutdownPermanently = true;
  // 应用退出时不等待前台命令自然结束：先回收 worker 写入的 ACL，再结束进程。
  const results = await Promise.allSettled([...workers.values()].map((worker) => shutdownWorker(worker, true)));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
}
