/**
 * 子进程登记表 —— 供「退出清场」统一收尾
 *
 * 为什么需要它：Electron 主进程退出**不会**带走自己 spawn 的子进程。EM 的命令通道
 * （前台 bash / install_dependency / shell:exec）各自持有 ChildProcess，但没有全局视角；
 * 退出时逐个 service 反查 pid 既易漏、又容易在新增通道时忘加，于是会留下
 * 「EM 已退出、dev server 还在跑」的孤儿进程——除了占端口，macOS 26+ 还会把它
 * 归因为「应用的后台活动」提示给用户（见 docs 与 auto-updater 的更新脚本例外说明）。
 *
 * 两条约定（改这里之前先读）：
 * 1. **只登记会被清场杀掉的进程**。刻意留在退出后继续跑的任务（macOS 更新替换脚本）
 *    **不要登记**——登记了会在退出时被误杀，更新随即中断、app 可能停在半新半旧状态。
 * 2. **只有 detached 才能 kill(-pid)**。Unix 下 shell:true + detached 会 setsid 成
 *    独立进程组，杀整组要用负 pid；非 detached 的子进程与 EM 同属一个进程组，
 *    用负 pid 会把 EM 自己一起打掉。
 */

import { spawn } from "node:child_process";

export interface TrackedChild {
  pid: number;
  /** 独立进程组（Unix 下 opts.detached===true 才成立；Windows 恒 false） */
  detached: boolean;
}

const tracked = new Map<number, TrackedChild>();
const groupMonitors = new Map<number, ReturnType<typeof setInterval>>();

function groupAlive(pid: number): boolean {
  try { process.kill(-pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code !== "ESRCH"; }
}

function forget(pid: number): void {
  tracked.delete(pid);
  const timer = groupMonitors.get(pid);
  if (timer) { clearInterval(timer); groupMonitors.delete(pid); }
}

/** 退出开始前冻结收尾目标：父进程收到 TERM 后可能先退出并从登记表注销，组内子进程仍存活。 */
export function snapshotTrackedChildren(): TrackedChild[] {
  return [...tracked.values()];
}

/** 登记刚 spawn 出来的子进程（pid 缺失 = spawn 失败，忽略） */
export function trackChild(child: { pid?: number } | null | undefined, opts: { detached?: boolean } = {}): void {
  const pid = child?.pid;
  if (!pid) return;
  forget(pid); // 极少数 PID 复用时旧探测器不能删掉新登记
  tracked.set(pid, { pid, detached: opts.detached === true && process.platform !== "win32" });
}

/** 启动进程退出后，仅在整个独立进程组也退出时注销；其子进程可能仍在跑。 */
export function untrackChild(child: { pid?: number } | null | undefined): void {
  const pid = child?.pid;
  if (!pid) return;
  const item = tracked.get(pid);
  if (!item) return;
  if (!item.detached || !groupAlive(pid)) { forget(pid); return; }
  if (groupMonitors.has(pid)) return;
  const timer = setInterval(() => { if (!groupAlive(pid)) forget(pid); }, 1000);
  timer.unref();
  groupMonitors.set(pid, timer);
}

/**
 * 对登记中的进程发信号。detached 优先杀整组，组已消失则退回杀该进程本身；
 * 进程已退出（ESRCH）静默跳过。返回成功送达信号的进程数，仅用于日志。
 */
export function signalTrackedChildren(signal: NodeJS.Signals, snapshot: readonly TrackedChild[] = snapshotTrackedChildren()): number {
  let sent = 0;
  for (const item of snapshot) {
    // 非 detached 只能杀单 PID；若首轮后已注销，二轮再按旧 PID 发信号有误杀 PID 复用的风险。
    // detached 则要保留旧组号：父进程可能已退、组内子进程仍在。
    if (signal === "SIGKILL" && !item.detached && !tracked.has(item.pid)) continue;
    if (process.platform === "win32") {
      // Windows 没有进程组概念：用 taskkill /T 连子树一起收（与 background-shell、
      // process-service 同策略）。taskkill 只能强杀，忽略 signal 参数。
      try {
        spawn("taskkill", ["/pid", String(item.pid), "/T", "/F"]).on("error", () => {});
        sent++;
      } catch { /* 进程已退出 */ }
      continue;
    }
    if (item.detached) {
      try {
        process.kill(-item.pid, signal);
        sent++;
        continue;
      } catch { /* 组已不存在 → 退回单进程 */ }
    }
    try {
      process.kill(item.pid, signal);
      sent++;
    } catch { /* 进程已退出 */ }
  }
  return sent;
}

/** 测试/诊断用：当前登记数 */
export function trackedChildCount(): number {
  return tracked.size;
}

/** 测试用：清空登记表 */
export function resetTrackedChildren(): void {
  for (const timer of groupMonitors.values()) clearInterval(timer);
  groupMonitors.clear();
  tracked.clear();
}
