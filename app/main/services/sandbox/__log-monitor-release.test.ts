import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureSandbox, releaseSandbox } from "./manager";

/**
 * 退出收尾必须停掉 srt 的常驻日志监控（macOS 的 `log stream`）。
 *
 * 背景（2026-09-24 实测）：srt initialize 时会 spawn 一个常驻 `log stream` 收集沙盒违规事件
 * （EM 传 enableLogMonitor=true，见 manager 的 ensureSandbox），而**它的停止闭包只在
 * SandboxManager.reset() 里被调用**。EM 的退出清场此前不碰沙盒 → 该进程失去父进程（PPID=1）
 * 常驻：LaunchServices 据此把 EasyMint 记为 exited-with-subordinates，macOS 26+ 会在 Dock 上
 * 持续提示「仍在后台运行」。实测进程命令行形如：
 *   log stream --predicate (eventMessage ENDSWITH "<rand>_SBX") --style compact
 *
 * 两个用例分工不同，缺一不可：
 * - 端到端：releaseSandbox 之后监控进程真的消失（把实现里的 reset 去掉，这条必红）
 * - 接线：退出清场里确实调了它（index.ts 是入口文件、起不了单测，故按源码断言——
 *   与 __srt-patch.test.ts 读 dist 源码、CLAUDE.md 里 prompts.ts 的契约测试同路数）
 */
const INDEX_FILE = path.join(process.cwd(), "app", "main", "index.ts");

/** 本进程 spawn 的监控进程数。
 *  按 **PPID 归属**统计而不是数全系统的：全量测试时别的 worker 也会起沙盒监控，
 *  数全系统会互相干扰。srt 是直接 spawn `log` 的（实测其父进程即宿主进程），所以直连即可；
 *  进程一旦成为孤儿 PPID 会变成 1，自然不计入——本用例关心的正是"自己起的那个有没有被收走"。 */
function logMonitorCount(): number {
  const out = spawnSync("/bin/ps", ["-eo", "ppid,command"], { encoding: "utf8" }).stdout ?? "";
  return out.split("\n").filter((line) => {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    return !!m && Number(m[1]) === process.pid && m[2].startsWith("log stream") && m[2].includes("_SBX");
  }).length;
}

describe("沙盒常驻监控的释放", () => {
  const workspace = path.join(process.cwd(), `.sandbox-logmon-${process.pid}`);

  beforeAll(() => { fs.mkdirSync(workspace, { recursive: true }); });
  afterAll(async () => {
    fs.rmSync(workspace, { recursive: true, force: true });
    await releaseSandbox();
  });

  it("releaseSandbox 停掉 macOS 的 log stream（退出后不留孤儿）", async () => {
    if (process.platform !== "darwin") return; // 该监控只在 macOS 存在（Linux 走内核观测通道）

    // 基线：系统里可能已有历史孤儿，只比对「本次初始化带来的增量」
    const before = logMonitorCount();

    const initialized = await ensureSandbox(workspace, "standard");
    // 前置探针：沙盒在本机起不来时，后面那条断言会拿到「假绿」（没起过自然也没得释放）。
    // 显式抛错把失败信息从"数字对不上"变成"本机无法验证"。
    if (!initialized.ok) throw new Error(`沙盒无法在本机初始化，本用例无法验证监控释放：${initialized.reason}`);
    expect(logMonitorCount()).toBeGreaterThan(before);

    await releaseSandbox();

    // kill 是同步发信号、进程退出是异步的 —— 轮询等它消失
    let after = logMonitorCount();
    for (let i = 0; i < 30 && after !== before; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      after = logMonitorCount();
    }
    expect(after).toBe(before);
  });

  it("退出清场调用了沙盒释放（index.ts 无法单测，故锚定源码）", () => {
    const src = fs.readFileSync(INDEX_FILE, "utf-8");
    const start = src.indexOf("async function runQuitCleanup");
    expect(start, "index.ts 里找不到 runQuitCleanup（改名了就同步更新本用例）").toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("\n}", start));
    expect(body).toContain("releaseSandbox()");
  });
});
