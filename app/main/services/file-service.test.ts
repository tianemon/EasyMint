/**
 * FileService.readContent 的结果口径 —— 读失败必须能被调用方区分出来。
 *
 * 回归点（2026-09-23）：越界与文件不存在原先都返回 ""，渲染层无法与「真的是空文件」区分，
 * 点开一个已改名/已删除的文件链接只得到一片空白、没有任何提示。
 */
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileService } from "./file-service";

let tmp: string;
let sub: string;
let svc: FileService;

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `file-service-${randomUUID().slice(0, 8)}`);
  sub = path.join(tmp, "sub");
  mkdirSync(sub, { recursive: true });
  svc = new FileService();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("readContent", () => {
  it("项目内存在的文件 → ok + 内容", () => {
    const f = path.join(tmp, "a.md");
    writeFileSync(f, "# hi");
    expect(svc.readContent(tmp, f)).toEqual({ ok: true, content: "# hi" });
  });

  it("空文件也是 ok：不能被当成读失败，否则界面会误报「文件已变更或删除」", () => {
    const f = path.join(tmp, "empty.md");
    writeFileSync(f, "");
    expect(svc.readContent(tmp, f)).toEqual({ ok: true, content: "" });
  });

  it("文件不存在 → missing", () => {
    expect(svc.readContent(tmp, path.join(tmp, "gone.md"))).toEqual({ ok: false, reason: "missing" });
  });

  it("路径不属于任何已登记项目（baseDir 为 null）→ outside-project", () => {
    const f = path.join(tmp, "b.md");
    writeFileSync(f, "x");
    expect(svc.readContent(null, f)).toEqual({ ok: false, reason: "outside-project" });
  });

  it("存在但在 baseDir 之外 → outside-project", () => {
    const f = path.join(tmp, "c.md");
    writeFileSync(f, "x");
    expect(svc.readContent(sub, f)).toEqual({ ok: false, reason: "outside-project" });
  });

  it("既不在项目内、磁盘上也没有 → 报 missing（存在性先判，别让归属判定掩盖真正原因）", () => {
    expect(svc.readContent(null, path.join(tmp, "nope.md"))).toEqual({ ok: false, reason: "missing" });
  });
});

/**
 * readTree 契约（2026-10-30 改为异步 + 节点上限）。
 *
 * 侧栏“文件”页原先每次切回都重新同步递归整棵树：本项目实测 20ms、约 3000 节点、473KB JSON，
 * 主进程被整块占住，用户看到的就是“点一下顿一下”。异步化后这些断言保证结构没被改坏。
 */
describe("readTree", () => {
  const touch = (rel: string): void => {
    const full = path.join(tmp, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, "");
  };

  it("嵌套目录成型，重目录（node_modules/dist/.git/temp）不进树", async () => {
    touch("src/main.ts");
    touch("src/deep/deeper/a.ts");
    touch("node_modules/pkg/index.js");
    touch("dist/bundle.js");
    touch(".git/config");
    touch("temp/scratch.txt");

    const { nodes, truncated } = await svc.readTree(tmp, tmp);
    // beforeEach 已建 sub/，所以顶层是 src + sub
    expect(nodes.map((n) => n.name).sort()).toEqual(["src", "sub"]);
    expect(truncated).toBe(false);
    const src = nodes.find((n) => n.name === "src")!;
    expect(src.isDirectory).toBe(true);
    expect(src.children!.map((n) => n.name).sort()).toEqual(["deep", "main.ts"]);
  });

  it("碰到节点上限就停并报 truncated，不返回一棵巨型树", async () => {
    for (let i = 0; i < 10; i += 1) touch(`f${i}.txt`);
    // 上限参数化只为此：真限 5000 要造 5001 个文件，慢且没测到更多东西
    const { nodes, truncated } = await svc.readTree(tmp, tmp, 10, 4);
    expect(nodes).toHaveLength(4);
    expect(truncated).toBe(true);
  });

  it("项目外的目录返回空树（路径归属校验仍在）", async () => {
    const outside = path.join(os.tmpdir(), `file-service-out-${randomUUID().slice(0, 8)}`);
    mkdirSync(outside, { recursive: true });
    try {
      writeFileSync(path.join(outside, "secret.txt"), "");
      expect(await svc.readTree(sub, outside)).toEqual({ nodes: [], truncated: false });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("目录不存在时返回空树而不是抛错（异步读的失败分支）", async () => {
    expect(await svc.readTree(tmp, path.join(tmp, "gone"))).toEqual({ nodes: [], truncated: false });
  });

  /**
   * 这条是「只在入口校验一次」的安全前提守卫。
   *
   * 子目录不再逐层复验路径归属，靠的是：子路径由 `readdir` 的 name 拼出（不含分隔符），
   * 且 Dirent 不跟随符号链接——符号链接的 isDirectory() 为 false，不会被递归。一旦哪天
   * 改了遍历方式（比如改用 stat 判断类型、或跟随 symlink），这条会立刻红。
   */
  it("不跟随符号链接把项目外的内容带进树", async () => {
    const outside = path.join(os.tmpdir(), `file-service-out-${randomUUID().slice(0, 8)}`);
    mkdirSync(outside, { recursive: true });
    try {
      writeFileSync(path.join(outside, "secret.txt"), "");
      symlinkSync(outside, path.join(tmp, "linked"));

      const { nodes } = await svc.readTree(tmp, tmp);
      const linked = nodes.find((n) => n.name === "linked");
      expect(linked).toBeDefined();
      expect(linked!.isDirectory).toBe(false);
      expect(linked!.children).toBeUndefined();
      expect(JSON.stringify(nodes)).not.toContain("secret.txt");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
