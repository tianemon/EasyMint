/**
 * project-service 单测 —— 打开项目弹窗的「最近打开」排序。
 *
 * 隔离方式：Store 传入临时目录作 baseDir（projects.json / em-settings.json 都落在那里），
 * 不碰用户真实的 ~/.easymint。electron 只用到 shell（delete 路径），本文件用不到但需存在。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("electron", () => ({ shell: { trashItem: vi.fn() } }));

import { Store } from "./store";
import { ProjectService } from "./project-service";

let tmpDir: string;
let store: Store;
let svc: ProjectService;

function rec(id: string, lastOpenedAt?: string): Record<string, unknown> {
  return {
    id,
    name: id,
    path: path.join(tmpDir, id),
    createdAt: "2026-01-01T00:00:00.000Z",
    ...(lastOpenedAt === undefined ? {} : { lastOpenedAt }),
    status: "setup",
    description: "",
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "em-project-svc-"));
  store = new Store(tmpDir);
  svc = new ProjectService(store, tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("ProjectService.list — 最近打开排序", () => {
  it("按 lastOpenedAt 降序返回（最近的在前），与 json 中的存储顺序无关", () => {
    store.saveProjects([
      rec("old", "2026-01-01T00:00:00.000Z"),
      rec("newest", "2026-03-01T00:00:00.000Z"),
      rec("mid", "2026-02-01T00:00:00.000Z"),
    ] as never);

    expect(svc.list().map((p) => p.id)).toEqual(["newest", "mid", "old"]);
  });

  it("lastOpenedAt 缺失或非法时排到最后，且不产生 NaN 乱序", () => {
    store.saveProjects([
      rec("noField"),
      rec("bad", "不是时间"),
      rec("ok", "2026-02-01T00:00:00.000Z"),
    ] as never);

    const ids = svc.list().map((p) => p.id);
    expect(ids[0]).toBe("ok");
    expect(ids.slice(1).sort()).toEqual(["bad", "noField"]);
  });

  it("lastOpenedAt 相同时保持 json 原有顺序（稳定排序，不来回抖）", () => {
    store.saveProjects([
      rec("a", "2026-02-01T00:00:00.000Z"),
      rec("b", "2026-02-01T00:00:00.000Z"),
      rec("c", "2026-02-01T00:00:00.000Z"),
    ] as never);

    expect(svc.list().map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
});

describe("会话目录就绪性 —— 同步入口的兜底与搬迁（回归防护）", () => {
  /**
   * 本组有两个用例会真实导入 SDK（拿它算目录做真值/预热），冷导入实测约 10.5 秒
   * （几乎全是文件 IO），全量套件并行抢 IO 时会明显更久 —— 故给足超时，别按小文件估。
   */
  const SDK_IMPORT_TIMEOUT_MS = 120_000;
  let agentDir: string;
  let prevAgentDir: string | undefined;

  beforeEach(() => {
    // 隔离 agent 目录：会话目录由 PI_CODING_AGENT_DIR 决定，不能碰用户真实 ~/.easymint/agent
    agentDir = path.join(tmpDir, "agent");
    prevAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
  });

  afterEach(() => {
    if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
  });

  it("改项目路径：会话目录整体搬到新编码目录（此前被「算路径即 mkdir」挡住，整段静默跳过）", async () => {
    // 回归点：getPiSessionDir(newCwd) 会把新目录建出来 → 调用方自己写的
    // `!fs.existsSync(新目录)` 恒为假 → 搬迁被跳过且不报错（历史会话在新路径下不可见）。
    // 现在搬迁统一走 moveSessionDir，内部按「空壳」判定处置。
    const { getPiSessionDir, primeSessionManagerClass } = await import("./pi-session-dir");
    await primeSessionManagerClass(); // 已就绪状态：走同步搬迁路径

    const oldCwd = path.join(tmpDir, "old-cwd");
    const newCwd = path.join(tmpDir, "new-cwd");
    const oldDir = getPiSessionDir(oldCwd);
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, "s.jsonl"), "{}\n");
    store.saveProjects([{ ...rec("p-move"), path: oldCwd }] as never);

    svc.update("p-move", { path: newCwd });

    expect(fs.existsSync(path.join(getPiSessionDir(newCwd), "s.jsonl"))).toBe(true);
    expect(fs.existsSync(oldDir)).toBe(false);
    expect(store.getProjects().find((p) => p.id === "p-move")!.path).toBe(newCwd);
  }, SDK_IMPORT_TIMEOUT_MS);

  it("删除项目：会话目录未就绪（SDK 预热中）时跳过会话侧处理，项目记录照删、不抛错", async () => {
    // 改动前 getPiSessionDir 在未预热时抛「未就绪」→ 整个删除动作连带失败
    vi.resetModules(); // 取一份未预热的新模块实例（模块级缓存是单例）
    const { ProjectService: FreshSvc } = await import("./project-service");
    const fresh = new FreshSvc(store, tmpDir);
    store.saveProjects([{ ...rec("p-del"), path: path.join(tmpDir, "p-del") }] as never);

    await expect(fresh.delete("p-del")).resolves.toBeUndefined();
    expect(store.getProjects().some((p) => p.id === "p-del")).toBe(false);
  });

  it("改项目路径：未就绪时记录照改、不抛错（搬迁挂到预热完成后补做）", async () => {
    vi.resetModules();
    const { ProjectService: FreshSvc } = await import("./project-service");
    const fresh = new FreshSvc(store, tmpDir);
    const oldCwd = path.join(tmpDir, "old-cwd2");
    const newCwd = path.join(tmpDir, "new-cwd2");
    store.saveProjects([{ ...rec("p-move2"), path: oldCwd }] as never);

    expect(() => fresh.update("p-move2", { path: newCwd })).not.toThrow();
    expect(store.getProjects().find((p) => p.id === "p-move2")!.path).toBe(newCwd);
  });

  it("改项目路径：未就绪时挂起的搬迁，在预热完成后确实补做（否则历史会话永久不可见）", async () => {
    vi.resetModules();
    const oldCwd = path.join(tmpDir, "old-cwd3");
    const newCwd = path.join(tmpDir, "new-cwd3");
    // 先按 SDK 规则（同一份 SDK 实例）造出旧目录与会话文件——此时 pi-session-dir 尚未预热
    const { SessionManager } = await import("@earendil-works/pi-coding-agent");
    const oldDir = SessionManager.create(oldCwd).getSessionDir();
    fs.writeFileSync(path.join(oldDir, "s.jsonl"), "{}\n");

    const { ProjectService: FreshSvc } = await import("./project-service");
    store.saveProjects([{ ...rec("p-move3"), path: oldCwd }] as never);
    new FreshSvc(store, tmpDir).update("p-move3", { path: newCwd });

    // 等预热（tryGet 已踢过一次后台预热）完成，再让延后补偿的 .then 跑完
    const dirMod = await import("./pi-session-dir");
    await dirMod.primeSessionManagerClass();
    await new Promise((r) => setTimeout(r, 0));

    expect(fs.existsSync(path.join(dirMod.getPiSessionDir(newCwd), "s.jsonl"))).toBe(true);
    expect(fs.existsSync(oldDir)).toBe(false);
  }, SDK_IMPORT_TIMEOUT_MS);
});

describe("Store.setLastProjectId — 打开项目时刷新 lastOpenedAt", () => {
  it("更新目标项目的 lastOpenedAt 并落盘，其它项目不受影响", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T10:00:00.000Z"));
    store.saveProjects([
      rec("target", "2026-01-01T00:00:00.000Z"),
      rec("other", "2026-01-02T00:00:00.000Z"),
    ] as never);

    store.setLastProjectId("target");

    const after: Record<string, string> = {};
    for (const p of store.getProjects()) after[p.id] = p.lastOpenedAt;
    expect(after.target).toBe("2026-05-05T10:00:00.000Z");
    expect(after.other).toBe("2026-01-02T00:00:00.000Z");
    // 落盘的成果能被后续读取：重新构造 Store 依然是最新时间
    expect(new Store(tmpDir).getProjects().find((p) => p.id === "target")!.lastOpenedAt)
      .toBe("2026-05-05T10:00:00.000Z");
  });

  it("随后 list() 把刚打开的项目排到最前", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T10:00:00.000Z"));
    store.saveProjects([
      rec("first", "2026-03-01T00:00:00.000Z"),
      rec("second", "2026-04-01T00:00:00.000Z"),
    ] as never);

    store.setLastProjectId("first");

    expect(svc.list().map((p) => p.id)).toEqual(["first", "second"]);
  });

  it("id 不在项目列表中时只写 lastProjectId，不弄坏 projects.json", () => {
    store.saveProjects([rec("real", "2026-01-01T00:00:00.000Z")] as never);

    expect(() => store.setLastProjectId("ghost")).not.toThrow();

    expect(store.getLastProjectId()).toBe("ghost");
    expect(store.getProjects().find((p) => p.id === "real")!.lastOpenedAt)
      .toBe("2026-01-01T00:00:00.000Z");
  });
});
