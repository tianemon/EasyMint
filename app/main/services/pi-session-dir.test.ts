/**
 * 锚定测试：EM 的会话目录必须**等于 SDK 自己的默认目录**。
 *
 * 这是「EM 不再自己实现路径编码」的守卫 —— 若有人把 `cwd.replace(/[:/\\]/g,"-")` 抄回来，
 * 这里会立刻变红（本次问题的根因正是那份手抄规则与 Pi 漂移）。
 *
 * 隔离：把 PI_CODING_AGENT_DIR 指到临时目录，避免 SessionManager 的 mkdir 副作用
 * 污染真实 ~/.easymint/agent/sessions（CLAUDE.md 测试纪律：真实文件系统判定须隔离/注入）。
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getPiSessionDir, moveSessionDir, primeSessionManagerClass, tryGetPiSessionDir } from "./pi-session-dir";

let tmpAgentDir: string;
let originalAgentDir: string | undefined;

/**
 * SDK 冷启动导入的时间预算（本文件唯一的慢点）。
 *
 * 实测：单进程冷导入 `@earendil-works/pi-coding-agent` 约 **10.5 秒**（real 10.47s / user 0.74s
 * —— 几乎全是文件 IO，包体大）。全量套件里几十个文件并行抢 IO，本 hook 单独 30 秒都被顶穿过
 * （表现为「Hook timed out」→ 整个文件假红）。故给足预算；这是**本文件独有**的成本，
 * 别把它当成"实现有性能问题"。
 */
const SDK_IMPORT_TIMEOUT_MS = 120_000;

// 显式给超时：本 hook 要真实 dynamic import SDK（签名见上）
beforeAll(async () => {
  originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  tmpAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-session-dir-"));
  process.env.PI_CODING_AGENT_DIR = tmpAgentDir;
  await primeSessionManagerClass();
}, SDK_IMPORT_TIMEOUT_MS);

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

  it("就绪门未完成时，会话入口不会先行返回；复位（null）后立即放行", async () => {
    // 守卫：启动期的「预热 + 旧目录迁移」是后台任务（首次 import SDK 冷启 7~10 秒，不能阻塞窗口），
    // 异步会话入口必须先过这道门，否则会在迁移完成前读到旧目录。
    const { armSessionDirReady, ensureSessionManagerClass } = await import("./pi-session-dir");
    try {
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

      // 复位语义（判别性断言）：装一道**永不打开**的门再复位 —— 复位若没生效，下面这句会挂住
      // （用例超时变红），而不是"反正门已放行所以看起来对"。
      armSessionDirReady(new Promise<void>(() => { /* 永不 resolve */ }));
      armSessionDirReady(null);
      await expect(ensureSessionManagerClass()).resolves.toBeTruthy();
    } finally {
      // 门是模块级单例状态：本用例临时装过，跑完必须复位，否则污染同文件后续用例。
      armSessionDirReady(null);
    }
  });
});

describe("tryGetPiSessionDir（同步调用点兜底，不抛）", () => {
  it("类未就绪时返回 undefined 且不抛；同一状态下 getPiSessionDir 抛错", async () => {
    // 模块级状态（_sessionManagerClass）是单例，故 resetModules 取一份「未预热」的新实例。
    // 场景来源：删项目 / 改项目路径 / 迁移打包都在同步上下文，不能 await 就绪门——启动后
    // 头几秒（SDK 预热未完成）若让 getPiSessionDir 抛出去，整条流程会连带失败（审查 P1）。
    vi.resetModules();
    const fresh = await import("./pi-session-dir");
    expect(fresh.tryGetPiSessionDir("/Users/amon/project")).toBeUndefined();
    expect(() => fresh.getPiSessionDir("/Users/amon/project")).toThrow(/未就绪/);
  });

  it("类就绪后与 getPiSessionDir 取到同一个目录（兜底不改变正常结果）", () => {
    expect(tryGetPiSessionDir("/Users/amon/project")).toBe(getPiSessionDir("/Users/amon/project"));
  });
});

describe("moveSessionDir（项目改路径/改名时的会话目录搬迁）", () => {
  // 每个用例用独立 cwd（目录名由 cwd 编码而来，互不干扰）
  let caseRoot: string;
  beforeEach(() => {
    caseRoot = fs.mkdtempSync(path.join(os.tmpdir(), "move-session-dir-"));
  });
  afterEach(() => {
    fs.rmSync(caseRoot, { recursive: true, force: true });
  });

  it("目标不存在（或只是算路径时建出的空壳）→ 整体改名，文件到达新目录、旧目录消失", () => {
    const fromCwd = path.join(caseRoot, "from");
    const toCwd = path.join(caseRoot, "to");
    const fromDir = getPiSessionDir(fromCwd);
    fs.writeFileSync(path.join(fromDir, "s1.jsonl"), "a\n");
    // getPiSessionDir(toCwd) 的 mkdir 副作用：目标目录此刻已被建出（空壳）
    expect(getPiSessionDir(toCwd)).toBeTruthy();

    expect(moveSessionDir(fromCwd, toCwd)).toBe("moved");
    expect(fs.readFileSync(path.join(getPiSessionDir(toCwd), "s1.jsonl"), "utf-8")).toBe("a\n");
    expect(fs.existsSync(fromDir)).toBe(false);
  });

  it("目标已有内容 → 并入：同名保留目标那份，其余搬入，旧目录删除", () => {
    const fromCwd = path.join(caseRoot, "from2");
    const toCwd = path.join(caseRoot, "to2");
    const fromDir = getPiSessionDir(fromCwd);
    const toDir = getPiSessionDir(toCwd);
    fs.writeFileSync(path.join(fromDir, "same.jsonl"), "旧\n");
    fs.writeFileSync(path.join(fromDir, "only-old.jsonl"), "补\n");
    fs.writeFileSync(path.join(toDir, "same.jsonl"), "新\n");

    expect(moveSessionDir(fromCwd, toCwd)).toBe("merged");
    expect(fs.readFileSync(path.join(toDir, "same.jsonl"), "utf-8")).toBe("新\n"); // 不覆盖既有
    expect(fs.existsSync(path.join(toDir, "only-old.jsonl"))).toBe(true);
    expect(fs.existsSync(fromDir)).toBe(false);
  });

  it("源目录为空（刚被 mkdir 出来的空壳）→ noop，并回收空壳不留垃圾", () => {
    const fromCwd = path.join(caseRoot, "from3");
    const toCwd = path.join(caseRoot, "to3");
    const fromDir = getPiSessionDir(fromCwd); // 只为建出空壳

    expect(moveSessionDir(fromCwd, toCwd)).toBe("noop");
    expect(fs.existsSync(fromDir)).toBe(false);
  });

  it("同一个 cwd → noop（不自我搬迁）", () => {
    const cwd = path.join(caseRoot, "same-cwd");
    fs.writeFileSync(path.join(getPiSessionDir(cwd), "s.jsonl"), "x\n");
    expect(moveSessionDir(cwd, cwd)).toBe("noop");
    expect(fs.existsSync(path.join(getPiSessionDir(cwd), "s.jsonl"))).toBe(true);
  });
});
