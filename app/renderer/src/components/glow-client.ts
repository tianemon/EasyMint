/**
 * 主线程侧的光效 Worker 客户端：单例管理 + 消息发送 + 回退判定。
 *
 * 单例理由：同一时刻只有一个光效组件渲染（ChatInput 三选一），
 * 而组件会随 glowActive 频繁挂载/卸载——每次新建 Worker 不划算。
 */

/** 延迟 detach 窗口：StrictMode 的 mount→unmount→mount 会在 cleanup 后同步重挂，
 *  立刻 detach 会让第二次挂载拿不到已转移的 canvas（transferControlToOffscreen 只能用一次）。 */
const DETACH_DELAY_MS = 200;

let worker: Worker | null = null;
let unavailable = false;

/** 取光效 Worker；创建失败（环境不支持 module worker / 被策略阻止）返回 null，调用方回退主线程绘制 */
export function glowWorker(): Worker | null {
  if (unavailable) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./glow.worker.ts", import.meta.url), { type: "module" });
  } catch {
    unavailable = true;
    return null;
  }
  return worker;
}

const pendingDetach = new Map<number, number>();

export function scheduleDetach(id: number): void {
  cancelDetach(id);
  const t = window.setTimeout(() => {
    pendingDetach.delete(id);
    worker?.postMessage({ type: "detach", id });
  }, DETACH_DELAY_MS);
  pendingDetach.set(id, t);
}

export function cancelDetach(id: number): void {
  const t = pendingDetach.get(id);
  if (t !== undefined) {
    clearTimeout(t);
    pendingDetach.delete(id);
  }
}

let nextSessionId = 1;

export function nextGlowSessionId(): number {
  return nextSessionId++;
}
