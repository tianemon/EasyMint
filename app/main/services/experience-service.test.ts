/**
 * experience-service 单测 —— 索引 + 原文分离架构（用户决策：能索引的就索引，正文按需加载）。
 *
 * 隔离方式：把 HOME 指到项目内临时目录后再动态 import —— 全局库路径在模块加载期由
 * os.homedir() 决定（Node 在 POSIX 上读 $HOME、Windows 上读 USERPROFILE，两个都 stub），
 * 并显式设置 EASYMINT_HOME，避免继承本机开发目录覆盖而写到用户真实数据。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Svc = typeof import("./experience-service");

let tmpHome: string;
let projectPath: string;
let svc: Svc;

function projDir(): string {
  return path.join(projectPath, ".easymint", "experiences");
}
function globalDir(): string {
  return path.join(tmpHome, ".easymint", "experiences");
}
function readIndex(dir: string): Array<Record<string, unknown>> {
  const f = path.join(dir, "index.json");
  if (!existsSync(f)) return [];
  return (JSON.parse(readFileSync(f, "utf-8")) as { items: Array<Record<string, unknown>> }).items;
}
function readBody(dir: string, file: string): string {
  return readFileSync(path.join(dir, file), "utf-8");
}

beforeEach(async () => {
  tmpHome = path.join(process.cwd(), "temp/tests", `experience-${randomUUID().slice(0, 8)}`);
  projectPath = path.join(tmpHome, "proj");
  mkdirSync(path.join(projectPath, ".easymint"), { recursive: true });
  vi.stubEnv("HOME", tmpHome);
  vi.stubEnv("USERPROFILE", tmpHome);
  vi.stubEnv("EASYMINT_HOME", path.join(tmpHome, ".easymint"));
  vi.resetModules();
  svc = await import("./experience-service");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("存储：原文落文件 + 索引进 index.json", () => {
  it("追加一条：原文文件内容含标题与正文，索引只记标题/文件名/标签/时间", () => {
    const { entry, scope } = svc.appendExperience(
      { title: "macOS 26 图标两套口径", body: "问题：图标被套了两层。\n做法：包内给满幅直角。\n验证：Dock 无断层。", tags: ["macos", "electron"], kind: "principle" },
      { scope: "global", projectPath },
    );
    expect(scope).toBe("global");
    const body = readBody(globalDir(), entry.file);
    expect(body).toContain("# macOS 26 图标两套口径");
    expect(body).toContain("验证：Dock 无断层。");
    const items = readIndex(globalDir());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "macOS 26 图标两套口径", tags: ["macos", "electron"], kind: "principle" });
    expect(String(items[0]!.file)).toMatch(/^[0-9a-f]{8}-macOS-26-图标两套口径\.md$/);
    // 索引里不带正文（注入只读索引，正文按需 read）
    expect(JSON.stringify(items[0])).not.toContain("Dock 无断层");
  });

  it("默认落项目库；无项目路径时兑现到全局库", () => {
    svc.appendExperience({ title: "项目内约定", body: "正文" }, { projectPath });
    expect(readIndex(projDir())).toHaveLength(1);
    const r = svc.appendExperience({ title: "无项目时写的", body: "正文" }, { scope: "project", projectPath: undefined });
    expect(r.scope).toBe("global");
    expect(readIndex(globalDir())).toHaveLength(1);
  });

  it("索引损坏：改名存证后重建（不静默清空整库索引）", () => {
    mkdirSync(projDir(), { recursive: true });
    writeFileSync(path.join(projDir(), "index.json"), "{ 半截 JSON");
    expect(svc.searchExperiences("任意", projectPath).hits).toEqual([]);
    expect(readdirSync(projDir()).some((n) => n.includes("index.json.corrupt-"))).toBe(true);
  });
});

describe("检索：标题/标签权重高于正文，返回命中片段", () => {
  it("标题命中排在只命中正文的条目前面", () => {
    svc.appendExperience({ title: "其他主题", body: "顺便提到卡片样式调整" }, { projectPath });
    svc.appendExperience({ title: "卡片 按钮 点不动", body: "React 实例复用导致 submitting 卡死" }, { projectPath });
    const r = svc.searchExperiences("卡片", projectPath);
    expect(r.hits[0]!.title).toBe("卡片 按钮 点不动");
  });

  it("tags 参与匹配（技术栈检索）", () => {
    svc.appendExperience({ title: "Flutter 页面转场默认行为", body: "Android 平台默认转场是 X", tags: ["flutter"] }, { projectPath });
    expect(svc.searchExperiences("flutter", projectPath).hits).toHaveLength(1);
  });

  it("正文命中时给出片段（供判断要不要读原文）", () => {
    svc.appendExperience({ title: "无关标题", body: "排查过程：先看 git diff 再对比最近改动" }, { projectPath });
    const hit = svc.searchExperiences("git diff", projectPath).hits[0]!;
    expect(hit.excerpt).toContain("git diff");
  });

  it("无空格中文多词也能命中（2-gram）", () => {
    svc.appendExperience({ title: "应用图标口径", body: "包内满幅直角，运行时图标自带圆角" }, { projectPath });
    expect(svc.searchExperiences("图标圆角", projectPath).hits).toHaveLength(1);
  });

  it("无匹配返回空；命中记 usageCount", () => {
    svc.appendExperience({ title: "唯一经验", body: "正文" }, { projectPath });
    expect(svc.searchExperiences("绝对不存在的词", projectPath).total).toBe(0);
    svc.searchExperiences("唯一", projectPath, { touch: true });
    expect(readIndex(projDir())[0]!.usageCount).toBe(1);
  });
});

describe("短 id 解析", () => {
  it("唯一前缀可用；太短/未找到/歧义分别报错", () => {
    const a = svc.appendExperience({ title: "经验甲", body: "正文" }, { projectPath }).entry;
    expect(svc.resolveExperience(projectPath, svc.shortId(a.id))).toMatchObject({ ok: true });
    expect(svc.resolveExperience(projectPath, "abc")).toMatchObject({ ok: false, reason: "too_short" });
    expect(svc.resolveExperience(projectPath, "zzzzzzzz")).toMatchObject({ ok: false, reason: "not_found" });
    const items = [
      { id: "abcdefgh1111-1111-1111-1111-111111111111", title: "同前缀甲", file: "abcdefgh1111-甲.md", tags: [], kind: "convention", createdAt: Date.now(), updatedAt: Date.now() },
      { id: "abcdefgh2222-2222-2222-2222-222222222222", title: "同前缀乙", file: "abcdefgh2222-乙.md", tags: [], kind: "convention", createdAt: Date.now(), updatedAt: Date.now() },
    ];
    mkdirSync(projDir(), { recursive: true });
    writeFileSync(path.join(projDir(), "index.json"), JSON.stringify({ version: 1, updatedAt: Date.now(), items }));
    expect(svc.resolveExperience(projectPath, "abcdefgh")).toMatchObject({ ok: false, reason: "ambiguous", count: 2 });
    expect(svc.resolveExperience(projectPath, "abcdefgh1")).toMatchObject({ ok: true });
  });
});

describe("改写与移动", () => {
  it("改写标题会同步原文首行并重命名文件；改写正文重写文件；updatedAt 刷新", () => {
    const { entry } = svc.appendExperience({ title: "旧标题", body: "旧正文" }, { projectPath });
    const r = svc.updateExperience(projectPath, svc.shortId(entry.id), { title: "新标题", kind: "principle" });
    expect(r.ok).toBe(true);
    const renamed = r.ok ? r.entry.file : "";
    expect(renamed).not.toBe(entry.file);
    expect(renamed.startsWith(svc.shortId(entry.id))).toBe(true); // 短 id 前缀不变（身份锚点）
    expect(existsSync(path.join(projDir(), entry.file))).toBe(false);
    const body = readBody(projDir(), renamed);
    expect(body).toContain("# 新标题");
    expect(body).toContain("旧正文"); // 只改标题不动正文
    svc.updateExperience(projectPath, entry.id, { body: "新正文" });
    expect(readBody(projDir(), renamed)).toContain("新正文");
    const item = readIndex(projDir())[0]!;
    expect(item.title).toBe("新标题");
    expect(item.file).toBe(renamed);
    expect(item.kind).toBe("principle");
    expect(item.updatedAt as number).toBeGreaterThanOrEqual(entry.createdAt);
  });

  it("移动到全局：原文文件与索引项一起搬，源库清空，计数保留", () => {
    const { entry } = svc.appendExperience({ title: "该跨项目的事实", body: "正文" }, { projectPath });
    svc.searchExperiences("该跨项目", projectPath, { touch: true });
    const moved = svc.moveExperience(projectPath, svc.shortId(entry.id), "global");
    expect(moved.ok).toBe(true);
    expect(readIndex(projDir())).toHaveLength(0);
    expect(existsSync(path.join(projDir(), entry.file))).toBe(false);
    expect(existsSync(path.join(globalDir(), entry.file))).toBe(true);
    const g = readIndex(globalDir())[0]!;
    expect(g.id).toBe(entry.id);
    expect(g.usageCount).toBe(1);
  });
});

describe("退役与容量淘汰：原文进 archive，可回溯", () => {
  it("退役：索引摘除 + 原文移入 archive + 理由登记；未找到进 failures", () => {
    const a = svc.appendExperience({ title: "临时结论", body: "发版窗口内先这样", kind: "temporary" }, { projectPath }).entry;
    svc.appendExperience({ title: "保留的经验", body: "正文" }, { projectPath });
    const r = svc.retireExperiences(projectPath, [svc.shortId(a.id), "zzzzzzzz"], "发版窗口已结束");
    expect(r.retired).toHaveLength(1);
    expect(r.failures).toHaveLength(1);
    expect(readIndex(projDir()).map((e) => e.title)).toEqual(["保留的经验"]);
    expect(existsSync(path.join(projDir(), a.file))).toBe(false);
    expect(existsSync(path.join(svc.archiveDir("project", projectPath), a.file))).toBe(true);
    const log = JSON.parse(readFileSync(path.join(svc.archiveDir("project", projectPath), "index.json"), "utf-8")) as Array<{ retiredReason: string; title: string }>;
    expect(log[0]!.retiredReason).toBe("发版窗口已结束");
    expect(log[0]!.title).toBe("临时结论");
  });

  it("容量淘汰：超上限时最低分条目进 archive（新写入的受保护）", () => {
    const now = Date.now();
    const items: unknown[] = [];
    for (let i = 0; i < 100; i += 1) {
      items.push({ id: `old-${i.toString().padStart(3, "0")}-1111-1111-1111-111111111111`, title: `旧条目 ${i}`, file: `old-${i}.md`, tags: [], kind: "convention", createdAt: now, updatedAt: now });
    }
    mkdirSync(projDir(), { recursive: true });
    writeFileSync(path.join(projDir(), "index.json"), JSON.stringify({ version: 1, updatedAt: now, items }));
    const added = svc.appendExperience({ title: "新条目", body: "正文", kind: "principle" }, { projectPath }).entry;
    const after = readIndex(projDir());
    expect(after).toHaveLength(100);
    expect(after.some((e) => e.id === added.id)).toBe(true);
    const log = JSON.parse(readFileSync(path.join(svc.archiveDir("project", projectPath), "index.json"), "utf-8")) as Array<{ retiredReason: string }>;
    expect(log.some((l) => l.retiredReason.includes("容量淘汰"))).toBe(true);
  });
});

describe("注入：只给索引；通用常驻 + 技术栈按项目匹配", () => {
  it("注入内容只有标题与文件名，不含正文", () => {
    svc.appendExperience({ title: "通用工作方式", body: "保密正文内容 ABC", tags: [] }, { scope: "global", projectPath });
    const block = svc.buildExperienceInjection(projectPath);
    expect(block).toContain("通用工作方式");
    expect(block).toContain("file ");
    expect(block).not.toContain("保密正文内容");
    expect(block).toContain(globalDir()); // 给出目录，供拼路径 read
  });

  it("技术栈条目：匹配当前项目才注入（flutter 条目在 react 项目里不出现）", () => {
    writeFileSync(path.join(projectPath, "package.json"), JSON.stringify({ dependencies: { react: "^19.0.0", electron: "^43.0.0" } }));
    svc.appendExperience({ title: "Flutter 页面转场", body: "正文", tags: ["flutter"] }, { scope: "global", projectPath });
    svc.appendExperience({ title: "Electron 主进程调试", body: "正文", tags: ["electron"] }, { scope: "global", projectPath });
    const block = svc.buildExperienceInjection(projectPath);
    expect(block).toContain("Electron 主进程调试");
    expect(block).not.toContain("Flutter 页面转场");
  });

  it("注入记送达次数；无匹配条目时给出提示", () => {
    svc.appendExperience({ title: "常驻条目", body: "正文", tags: [] }, { scope: "global", projectPath });
    svc.buildExperienceInjection(projectPath);
    expect(readIndex(globalDir())[0]!.injectedCount).toBe(1);
    // 只存了带标签的技术栈条目、而当前项目探测不到该技术栈 → 不注入，只给提示
    rmSync(globalDir(), { recursive: true, force: true });
    svc.appendExperience({ title: "Flutter 专有经验", body: "正文", tags: ["flutter"] }, { scope: "global", projectPath: undefined });
    const noMatch = svc.buildExperienceInjection(projectPath);
    expect(noMatch).toContain("没有匹配到该注入的条目");
    expect(noMatch).not.toContain("Flutter 专有经验");
  });

  it("detectProjectStacks：读标志文件与关键词（含平台标签）", () => {
    writeFileSync(path.join(projectPath, "package.json"), JSON.stringify({ devDependencies: { vite: "^8.0.0", tailwindcss: "^4.0.0", typescript: "^6.0.0" } }));
    const stacks = svc.detectProjectStacks(projectPath);
    expect(stacks).toEqual(expect.arrayContaining(["node", "vite", "tailwind", "typescript"]));
    expect(svc.detectProjectStacks(undefined)).toEqual([]);
  });
});

describe("普通启动索引不安排经验维护", () => {
  it("缺失正文、重复标题和旧临时记录不触发维护指令，旧记录仍可显式退役", () => {
    const a = svc.appendExperience({ title: "重复标题示例甲", body: "正文" }, { projectPath }).entry;
    svc.appendExperience({ title: "重复标题示例乙", body: "正文" }, { projectPath });
    rmSync(path.join(projDir(), a.file));
    const items = readIndex(projDir()).map(e => ({ ...e, kind: "temporary", updatedAt: Date.now() - 20 * 86400000, usageCount: 7 }));
    writeFileSync(path.join(projDir(), "index.json"), JSON.stringify({ version: 1, items }));
    const block = svc.buildExperienceInjection(projectPath);
    expect(block).not.toContain("待体检");
    expect(block).toContain("检索命中7");
    expect(block).not.toContain("retire_experiences");
    expect(svc.retireExperiences(projectPath, [a.id], "原文已缺失").retired).toHaveLength(1);
  });
});

describe("检索命中只作为次要信号", () => {
  it("旧记录即使命中很多，也不能压过更新的同类经验", () => {
    const old = svc.appendExperience({ title: "同词旧经验", body: "OLD_BODY" }, { projectPath }).entry;
    const fresh = svc.appendExperience({ title: "同词新经验", body: "NEW_BODY" }, { projectPath }).entry;
    const items = readIndex(projDir()).map(e => ({ ...e, updatedAt: e.id === old.id ? Date.now() - 40 * 86400000 : Date.now(), usageCount: e.id === old.id ? 999 : 0 }));
    writeFileSync(path.join(projDir(), "index.json"), JSON.stringify({ version: 1, items }));
    expect(svc.searchExperiences("同词", projectPath).hits.map(h => h.id)).toEqual([fresh.id, old.id]);
    const block = svc.buildExperienceInjection(projectPath);
    expect(block.indexOf(fresh.file)).toBeLessThan(block.indexOf(old.file));
  });

  it("即使高命中记录超出注入上限，也不挤掉更合适的四条项目经验", () => {
    const old = svc.appendExperience({ title: "旧高命中", body: "正文" }, { projectPath }).entry;
    for (let i = 0; i < 4; i++) svc.appendExperience({ title: `当前经验${i}`, body: "正文" }, { projectPath });
    const items = readIndex(projDir()).map(e => e.id === old.id ? { ...e, updatedAt: Date.now() - 100 * 86400000, kind: "temporary", usageCount: 999 } : e);
    writeFileSync(path.join(projDir(), "index.json"), JSON.stringify({ version: 1, items }));
    const block = svc.buildExperienceInjection(projectPath);
    expect(block).not.toContain(old.file);
    for (let i = 0; i < 4; i++) expect(block).toContain(`当前经验${i}`);
  });

  it("容量回收不因检索命中多而保留过时低优先级条目，保留旧计数字段兼容", () => {
    const now = Date.now();
    const items = Array.from({ length: 100 }, (_, i) => ({ id: randomUUID(), title: `条目${i}`, file: `e${i}.md`, tags: [], kind: i === 0 ? "temporary" : "convention", createdAt: now, updatedAt: i === 0 ? now - 100 * 86400000 : now, usageCount: i === 0 ? 999 : 0 }));
    mkdirSync(projDir(), { recursive: true });
    writeFileSync(path.join(projDir(), "index.json"), JSON.stringify({ version: 1, items }));
    for (const item of items) writeFileSync(path.join(projDir(), item.file), item.title);
    svc.appendExperience({ title: "新经验", body: "正文" }, { projectPath });
    expect(readIndex(projDir())).toHaveLength(100);
    expect(readIndex(projDir()).some(e => e.id === items[0]!.id)).toBe(false);
    const archived = JSON.parse(readFileSync(path.join(svc.archiveDir("project", projectPath), "index.json"), "utf-8")) as Array<{ id: string }>;
    expect(archived.map(e => e.id)).toContain(items[0]!.id);
    expect(existsSync(path.join(svc.archiveDir("project", projectPath), items[0]!.file))).toBe(true);
  });

  it("三类索引各自限额，仍按技术栈筛选且不加载正文", () => {
    writeFileSync(path.join(projectPath, "package.json"), JSON.stringify({ dependencies: { react: "19" } }));
    for (let i = 0; i < 7; i++) {
      svc.appendExperience({ title: `项目${i}`, body: "SECRET_BODY" }, { projectPath });
      svc.appendExperience({ title: `通用${i}`, body: "SECRET_BODY" }, { scope: "global", projectPath });
      svc.appendExperience({ title: `React${i}`, body: "SECRET_BODY", tags: ["react"] }, { scope: "global", projectPath });
    }
    const block = svc.buildExperienceInjection(projectPath);
    expect(block).toContain("【本项目 4 条】");
    expect(block).toContain("【全局通用·常驻 4 条】");
    expect(block).toContain("技术栈匹配（react）3 条");
    expect(block).not.toContain("SECRET_BODY");
  });
});
