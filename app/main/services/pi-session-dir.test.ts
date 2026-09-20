/**
 * 锚定测试：EM 的会话目录必须**等于 SDK 自己的默认目录**。
 *
 * 这是「EM 不再自己实现路径编码」的守卫 —— 若有人把 `cwd.replace(/[:/\\]/g,"-")` 抄回来，
 * 这里会立刻变红（本次问题的根因正是那份手抄规则与 Pi 漂移）。
 *
 * 隔离：把 PI_CODING_AGENT_DIR 指到临时目录，避免 SessionManager 的 mkdir 副作用
 * 污染真实 ~/.easymint/agent/sessions（CLAUDE.md 测试纪律：真实文件系统判定须隔离/注入）。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getPiSessionDir, primeSessionManagerClass } from "./pi-session-dir";

let tmpAgentDir: string;
let originalAgentDir: string | undefined;

beforeAll(async () => {
  originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  tmpAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-session-dir-"));
  process.env.PI_CODING_AGENT_DIR = tmpAgentDir;
  await primeSessionManagerClass();
});

afterAll(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  fs.rmSync(tmpAgentDir, { recursive: true, force: true });
});

describe("会话目录 = SDK 默认目录（防漂移锚定）", () => {
  it("各种 cwd 下都与 SessionManager 的默认目录一致", async () => {
    const { SessionManager } = await import("@earendil-works/pi-coding-agent");
    const cwds = [
      "/Users/amon/dev/project/EasyMint",
      "/Users/amon/cn/中文 目录",
      "/tmp/a-b-c",
      "/Users/amon/trailing-slash/",
    ];
    for (const cwd of cwds) {
      expect(getPiSessionDir(cwd)).toBe(SessionManager.create(cwd).getSessionDir());
    }
  });

  it("产出 Pi 形态目录名（--<去首斜杠、分隔符换 ->--），而非 EM 旧编码", () => {
    const dir = getPiSessionDir("/Users/amon/project");
    expect(dir.endsWith(`${path.sep}--Users-amon-project--`)).toBe(true);
    // 旧编码形态是「单个前导横线、无尾缀」，二者必须能区分开
    expect(dir.endsWith(`${path.sep}-Users-amon-project`)).toBe(false);
  });

  it("目录落在 agentDir/sessions 下（agentDir 由 PI_CODING_AGENT_DIR 决定）", () => {
    const dir = getPiSessionDir("/Users/amon/project");
    expect(dir.startsWith(path.join(tmpAgentDir, "sessions"))).toBe(true);
  });

  it("同一 cwd 多次调用结果稳定", () => {
    expect(getPiSessionDir("/Users/amon/x")).toBe(getPiSessionDir("/Users/amon/x"));
  });

  it("就绪门未完成时，会话入口不会先行返回（保证迁移早于会话读写）", async () => {
    // 守卫：启动期的「预热 + 旧目录迁移」是后台任务（首次 import SDK 约 7 秒，不能阻塞窗口），
    // 异步会话入口必须先过这道门，否则会在迁移完成前读到旧目录。
    const { armSessionDirReady, ensureSessionManagerClass } = await import("./pi-session-dir");
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    armSessionDirReady(gate);

    let settled = false;
    const p = ensureSessionManagerClass().then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false); // 门未开 → 未返回

    release();
    await p;
    expect(settled).toBe(true);
  });
});
