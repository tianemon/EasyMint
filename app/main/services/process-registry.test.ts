/**
 * 退出清场登记表单测
 *
 * 覆盖登记、独立进程组在启动进程退出后继续存活、以及非 detached PID 注销。
 * 它们对应漏杀孤儿进程与误杀复用 PID 两类风险。
 * 用真实子进程而不用 mock：kill(-pid) 的进程组语义只能真跑才验证得到。
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import {
  resetTrackedChildren,
  signalTrackedChildren,
  snapshotTrackedChildren,
  trackChild,
  trackedChildCount,
  untrackChild,
} from "./process-registry";

/** Windows 无 sleep / 无进程组语义，本文件只覆盖 Unix 分支 */
const describeUnix = process.platform === "win32" ? describe.skip : describe;

const spawned: ChildProcess[] = [];

function spawnSleep(): ChildProcess {
  const child = spawn("sleep", ["30"], {
    detached: process.platform !== "win32",
    stdio: "ignore",
  });
  spawned.push(child);
  return child;
}

/** 进程是否还存活（这里是"验证没被杀"，不存在 zombie 干扰） */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 等子进程真正退出（等 exit 事件，而不是轮询 ESRCH——被杀后 zombie 期间 kill(pid,0) 仍成功） */
function onceExit(child: ChildProcess, timeoutMs = 3000): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => { clearTimeout(timer); resolve(true); });
  });
}

afterEach(() => {
  for (const child of spawned.splice(0)) {
    try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* 整组已退出 */ }
  }
  resetTrackedChildren();
});

describeUnix("process-registry（退出清场登记表）", () => {
  it("登记后的进程会被清场信号杀掉", async () => {
    const child = spawnSleep();
    trackChild(child, { detached: true });
    expect(trackedChildCount()).toBe(1);

    expect(signalTrackedChildren("SIGKILL")).toBe(1);
    expect(await onceExit(child)).toBe(true);
    expect(alive(child.pid!)).toBe(false);
  });

  it("启动进程退出回调触发时若独立组还活着，仍保留清场目标", async () => {
    const child = spawnSleep();
    trackChild(child, { detached: true });
    untrackChild(child);
    expect(trackedChildCount()).toBe(1);

    expect(signalTrackedChildren("SIGKILL")).toBe(1);
    expect(await onceExit(child)).toBe(true);
  });

  it("shell 自己退出但后台子进程仍在时，登记表继续追踪整个进程组", async () => {
    const child = spawn("/bin/sh", ["-c", "sleep 30 &"], { detached: true, stdio: "ignore" });
    spawned.push(child);
    trackChild(child, { detached: true });
    expect(await onceExit(child)).toBe(true);

    untrackChild(child);
    expect(trackedChildCount()).toBe(1);
    expect(signalTrackedChildren("SIGKILL")).toBe(1);
  });

  it("退出时的快照在父进程注销后仍可补发 SIGKILL", async () => {
    const child = spawnSleep();
    trackChild(child, { detached: true });
    const snapshot = snapshotTrackedChildren();
    resetTrackedChildren(); // 模拟登记表已清空，快照仍可补刀
    expect(trackedChildCount()).toBe(0);

    expect(signalTrackedChildren("SIGKILL", snapshot)).toBe(1);
    expect(await onceExit(child)).toBe(true);
    expect(alive(child.pid!)).toBe(false);
  });

  it("非 detached：只杀进程本身，不碰进程组", () => {
    const child = spawnSleep();
    trackChild(child, { detached: false });
    // 非 detached 时用负 pid 会命中测试进程自己的进程组 → 这里必须能安全返回
    expect(signalTrackedChildren("SIGTERM")).toBe(1);
    untrackChild(child);
  });

  it("非 detached 的旧 PID 注销后二轮不再发送 SIGKILL", () => {
    const child = spawnSleep();
    trackChild(child, { detached: false });
    const snapshot = snapshotTrackedChildren();
    untrackChild(child);
    expect(signalTrackedChildren("SIGKILL", snapshot)).toBe(0);
    expect(alive(child.pid!)).toBe(true);
  });

  it("pid 缺失（spawn 失败）不登记", () => {
    trackChild({ pid: undefined });
    trackChild(null);
    expect(trackedChildCount()).toBe(0);
  });

  it("注销幂等：重复 untrack 不抛、不误删他人", () => {
    const a = spawnSleep();
    const b = spawnSleep();
    trackChild(a, { detached: false });
    trackChild(b, { detached: false });
    untrackChild(a);
    untrackChild(a);
    expect(trackedChildCount()).toBe(1);
    untrackChild(b);
    expect(trackedChildCount()).toBe(0);
  });
});
