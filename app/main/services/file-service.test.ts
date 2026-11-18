/**
 * FileService.readContent 的结果口径 —— 读失败必须能被调用方区分出来。
 *
 * 回归点（2026-09-23）：越界与文件不存在原先都返回 ""，渲染层无法与「真的是空文件」区分，
 * 点开一个已改名/已删除的文件链接只得到一片空白、没有任何提示。
 */
import fs, { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileService } from "./file-service";
import {initializeProjectRules,applyInitialProjectProfile} from "./project-rule-files";

let tmp: string;
let sub: string;
let svc: FileService;

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `file-service-${randomUUID().slice(0, 8)}`);
  sub = path.join(tmp, "sub");
  mkdirSync(sub, { recursive: true });
  vi.stubEnv("PI_CODING_AGENT_DIR", path.join(tmp, "sdk-agent"));
  svc = new FileService();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

describe("readContent", () => {
  it("项目内存在的文件 → ok + 内容", () => {
    const f = path.join(tmp, "a.md");
    writeFileSync(f, "# hi");
    expect(svc.readContent(tmp, f)).toEqual({ ok: true, content: "# hi", hash: createHash("sha256").update("# hi").digest("hex") });
  });

  it("空文件也是 ok：不能被当成读失败，否则界面会误报「文件已变更或删除」", () => {
    const f = path.join(tmp, "empty.md");
    writeFileSync(f, "");
    expect(svc.readContent(tmp, f)).toEqual({ ok: true, content: "", hash: createHash("sha256").update("").digest("hex") });
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

describe("versioned editor writes", () => {
  const opened = (file: string) => {
    const value = svc.readContent(tmp, file);
    if (!value.ok) throw new Error("fixture file is unreadable");
    return value;
  };

  it("rejects an old rule snapshot after the creation flow appends its project profile", async () => {
    initializeProjectRules(sub, "# {{PROJECT_NAME}}\nBASE", "Fixture", false);
    const file = path.join(sub, "AGENTS.md"), prior = opened(file);
    applyInitialProjectProfile(sub, "HOST_PROJECT_SPEC");
    await expect(svc.writeContent(tmp, file, prior.content + "\nUSER_EDIT", prior.hash)).rejects.toThrow("其他窗口或程序修改");
    expect(readFileSync(file, "utf8")).toContain("HOST_PROJECT_SPEC");
  });

  it("returns the committed version for the next save and rejects omitted versions", async () => {
    const file = path.join(tmp, "notes.md");writeFileSync(file, "original");
    const prior = opened(file);
    await expect(svc.writeContent(tmp, file, "unversioned", undefined as never)).rejects.toThrow("缺少文件读取版本");
    const first = await svc.writeContent(tmp, file, "first", prior.hash);
    await svc.writeContent(tmp, file, "second", first.hash);
    expect(readFileSync(file, "utf8")).toBe("second");
    rmSync(file);
    await expect(svc.writeContent(tmp, file, "recreate", first.hash)).rejects.toThrow("变更或删除");
    expect(fs.existsSync(file)).toBe(false);
  });

  it("checks the original bytes even when different invalid UTF-8 bytes display the same text", async () => {
    const file = path.join(tmp, "bytes.txt");writeFileSync(file, Buffer.from([0xff]));
    const prior = opened(file);writeFileSync(file, Buffer.from([0xfe]));
    expect(opened(file).content).toBe(prior.content);
    await expect(svc.writeContent(tmp, file, "replace", prior.hash)).rejects.toThrow("其他窗口或程序修改");
    expect(readFileSync(file)).toEqual(Buffer.from([0xfe]));
  });

  it.each(["system-prompts.json", "system-prompts-v2.json"])("protects %s from editor writes and creation", async config => {
    const home = path.join(tmp, "em-home");vi.stubEnv("EASYMINT_HOME", home);mkdirSync(home);
    const file = path.join(home, config);writeFileSync(file, '{"version":2}');
    const prior = opened(file);
    await expect(svc.writeContent(tmp, file, "{}", prior.hash)).rejects.toThrow("设置中修改");
    if (process.platform !== "win32") {
      const alias = path.join(tmp, "prompt-alias.json");symlinkSync(file, alias);
      await expect(svc.writeContent(tmp, alias, "{}", prior.hash)).rejects.toThrow("设置中修改");
    }
    expect(readFileSync(file, "utf8")).toBe(prior.content);
    rmSync(file);
    await expect(svc.createFile(tmp, file, "{}" )).rejects.toThrow("设置中修改");
    expect(() => svc.createFolder(tmp, file)).toThrow("设置中修改");
    expect(fs.existsSync(file)).toBe(false);
    const ordinary = path.join(sub, config);
    await svc.createFile(tmp, ordinary, "project data");
    await svc.writeContent(tmp, ordinary, "project update", opened(ordinary).hash);
    expect(readFileSync(ordinary, "utf8")).toBe("project update");
  });

  it("never overwrites a competing file created after the create request began", async () => {
    const file = path.join(tmp, "new.md"), original = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation((target, data, options) => {
      if (String(target) === file) original(file, "CONCURRENT_FILE");
      return original(target, data, options);
    });
    await expect(svc.createFile(tmp, file, "NEW_FILE")).rejects.toThrow("文件已存在");
    expect(readFileSync(file, "utf8")).toBe("CONCURRENT_FILE");
  });

  it.each(process.platform === "win32" ? [false] : [false, true])("waits for a real SDK edit before checking the editor version (alias=%s)", async alias => {
    const {createEditToolDefinition,withFileMutationQueue} = await import("@earendil-works/pi-coding-agent");
    expect(await (await import("./pi-sdk")).getFileMutationQueueFn()).toBe(withFileMutationQueue);
    const file = path.join(tmp, "AGENTS.md");writeFileSync(file, "ORIGINAL");
    const editorPath = alias ? path.join(tmp, "rule-alias.md") : file;
    if (alias) symlinkSync(file, editorPath);
    const prior = opened(editorPath);
    let observed!: () => void, release!: () => void;
    const readObserved = new Promise<void>(resolve => { observed = resolve; });
    const readRelease = new Promise<void>(resolve => { release = resolve; });
    const edit = createEditToolDefinition(tmp, {operations:{
      access: target => fs.promises.access(target),
      readFile: async target => {const bytes = await fs.promises.readFile(target);observed();await readRelease;return bytes;},
      writeFile: (target, text) => fs.promises.writeFile(target, text, "utf8"),
    }});
    const editing = edit.execute("fixture", {path:file,edits:[{oldText:"ORIGINAL",newText:"AGENT_UPDATE"}]}, undefined, undefined, {cwd:tmp} as never);
    await readObserved;
    let saveSettled = false;
    const saving = svc.writeContent(tmp, editorPath, "USER_EDITOR_CHANGE", prior.hash)
      .then(() => ({saved:true,error:""}), error => ({saved:false,error:String(error)}))
      .finally(() => {saveSettled = true;});
    let settledBeforeRelease = false;
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      await new Promise<void>(resolve => setImmediate(resolve));
      settledBeforeRelease = saveSettled;
    } finally { release(); }
    await editing;
    expect(settledBeforeRelease).toBe(false);
    expect(await saving).toMatchObject({saved:false,error:expect.stringContaining("其他窗口或程序修改")});
    expect(readFileSync(file, "utf8")).toBe("AGENT_UPDATE");
  });

  it.each(["save", "create"])("rechecks project registration after queued %s work", async operation => {
    const queue = await (await import("./pi-sdk")).getFileMutationQueueFn();
    const file = path.join(sub, "queued.md");
    if (operation === "save") writeFileSync(file, "ORIGINAL");
    const prior = operation === "save" ? opened(file) : undefined;
    let entered!: () => void, release!: () => void;
    const enteredGate = new Promise<void>(resolve => { entered = resolve; });
    const releaseGate = new Promise<void>(resolve => { release = resolve; });
    const holding = queue(file, async () => { entered();await releaseGate; });
    await enteredGate;
    let registered = true;
    const assertRegistered = () => {if (!registered) throw new Error("FIXTURE_UNREGISTERED");};
    const pending = (operation === "save"
      ? svc.writeContent(sub, file, "STALE_WRITE", prior!.hash, assertRegistered)
      : svc.createFile(sub, file, "STALE_CREATE", assertRegistered))
      .then(() => ({saved:true,error:""}), error => ({saved:false,error:String(error)}));
    registered = false;release();await holding;
    expect(await pending).toMatchObject({saved:false,error:expect.stringContaining("FIXTURE_UNREGISTERED")});
    if (operation === "save") expect(readFileSync(file,"utf8")).toBe("ORIGINAL");
    else expect(fs.existsSync(file)).toBe(false);
  });

  it("does not recreate a project root renamed while file creation was queued", async () => {
    const queue = await (await import("./pi-sdk")).getFileMutationQueueFn(), file = path.join(sub,"queued.md");
    let entered!: () => void, release!: () => void;
    const enteredGate = new Promise<void>(resolve => { entered = resolve; });
    const releaseGate = new Promise<void>(resolve => { release = resolve; });
    const holding = queue(file, async () => {entered();await releaseGate;});
    await enteredGate;
    const pending = svc.createFile(sub,file,"STALE_CREATE")
      .then(() => ({saved:true,error:""}), error => ({saved:false,error:String(error)}));
    fs.renameSync(sub,path.join(tmp,"moved-project"));release();await holding;
    expect(await pending).toMatchObject({saved:false,error:expect.stringContaining("项目目录已变更或不可用")});
    expect(fs.existsSync(sub)).toBe(false);
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

  it("filters protected descendants without rebuilding root validation for every directory", async () => {
    const home = path.join(tmp, "nested", "em-home");
    vi.stubEnv("EASYMINT_HOME", home);
    touch("nested/em-home/.control-tmp/private-control-file");
    touch("nested/em-home/em-settings.json");
    touch("nested/em-home/visible.txt");
    touch("src/deep/visible.ts");
    expect(svc.isPathSafe(path.join(home, ".control-tmp"), tmp)).toBe(false);
    const validate = vi.spyOn(svc, "isPathSafe");
    const { nodes } = await svc.readTree(tmp, tmp);
    const tree = JSON.stringify(nodes);
    expect(tree).not.toContain("private-control-file");
    expect(tree).not.toContain(".control-tmp");
    expect(tree).not.toContain("em-settings.json");
    expect(tree).toContain("visible.txt");
    expect(tree).toContain("visible.ts");
    expect(validate).toHaveBeenCalledOnce();
  });

  it("retains protection for descendant names beginning with two dots", async () => {
    vi.stubEnv("EASYMINT_HOME", path.join(tmp, "..em-home"));
    touch("..em-home/.control-tmp/private-control-file");
    touch("ordinary.txt");
    const { nodes } = await svc.readTree(tmp, tmp);
    expect(JSON.stringify(nodes)).not.toContain("private-control-file");
    expect(JSON.stringify(nodes)).toContain("ordinary.txt");
  });

  it("also filters protected descendants when the traversal root is an allowed symlink alias", async () => {
    const home = path.join(sub, "em-home");
    vi.stubEnv("EASYMINT_HOME", home);
    touch("sub/em-home/.control-tmp/private-control-file");
    touch("sub/visible.txt");
    const alias = path.join(tmp, "alias");
    symlinkSync(sub, alias, process.platform === "win32" ? "junction" : "dir");
    const { nodes } = await svc.readTree(tmp, alias);
    expect(JSON.stringify(nodes)).not.toContain("private-control-file");
    expect(nodes.find(node => node.name === "visible.txt")?.path).toBe(path.join(alias, "visible.txt"));
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
