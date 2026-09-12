/**
 * experience-service 单测 —— 治理能力回归（检索分词 / 短 id / 作用域 / 移动 / 退役 / 注入 / 体检 / 淘汰）。
 *
 * 隔离方式：把 HOME 指到项目内临时目录后再动态 import —— 全局库路径在模块加载期由
 * os.homedir() 决定（Node 在 POSIX 上优先读 $HOME），因此必须 stub 后再 resetModules 取新实例，
 * 否则测试会写到用户真实的 ~/.easymint/experiences.json。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Svc = typeof import("./experience-service");

let tmpHome: string;
let projectPath: string;
let svc: Svc;

function globalFile(): string {
  return path.join(tmpHome, ".easymint", "experiences.json");
}
function projectFile(): string {
  return path.join(projectPath, ".easymint", "experiences.json");
}
function readJson<T>(file: string): T[] {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf-8")) as T[]) : [];
}
/** 直接播种库文件（绕过 append 的容量逻辑，用于淘汰/体检这类需要构造大量条目或指定时间戳的用例） */
function seed(file: string, entries: unknown[]): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(entries, null, 2));
}

beforeEach(async () => {
  tmpHome = path.join(process.cwd(), "temp/tests", `experience-${randomUUID().slice(0, 8)}`);
  projectPath = path.join(tmpHome, "proj");
  mkdirSync(path.join(projectPath, ".easymint"), { recursive: true });
  vi.stubEnv("HOME", tmpHome);
  // Windows 上 os.homedir() 读 USERPROFILE（不读 HOME）——两个都 stub，否则 Windows/CI 会写到真实用户库
  vi.stubEnv("USERPROFILE", tmpHome);
  vi.resetModules();
  svc = await import("./experience-service");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("检索：分词匹配（原来整串子串匹配导致多词查询必然零命中）", () => {
  it("多关键词可命中（这是核心回归：改前「图标 圆角」返回空）", () => {
    const { entry } = svc.appendExperience(
      { memory: "macOS 26 应用图标是两套口径：包内满幅直角由系统套圆角，运行时图标自带圆角" },
      { projectPath },
    );
    const r = svc.searchExperiences("图标 圆角", projectPath);
    expect(r.hits.map((h) => h.id)).toEqual([entry.id]);
  });

  it("按命中词数排序（全词命中优先）", () => {
    svc.appendExperience({ memory: "卡片 按钮 点不动：React 实例复用导致 submitting 卡住" }, { projectPath });
    const partial = svc.appendExperience({ memory: "卡片样式微调：圆角与间距" }, { projectPath });
    const r = svc.searchExperiences("卡片 按钮 点不动", projectPath);
    expect(r.hits[0]!.memory).toContain("submitting");
    expect(r.hits.map((h) => h.id)).toContain(partial.entry.id);
  });

  it("单关键词行为不回归（仍是子串匹配）", () => {
    svc.appendExperience({ memory: "squircle 遮罩口径" }, { projectPath });
    expect(svc.searchExperiences("squircle", projectPath).hits).toHaveLength(1);
  });

  it("无空格的中文多词查询也能命中（2-gram 闸门）", () => {
    svc.appendExperience({ memory: "应用图标两套口径：包内满幅直角，运行时图标自带圆角" }, { projectPath });
    expect(svc.searchExperiences("图标圆角", projectPath).hits).toHaveLength(1);
  });

  it("updateExperience：context 传空串清空、memory 传空串忽略", () => {
    const { entry } = svc.appendExperience({ memory: "正文", context: "原上下文" }, { projectPath });
    svc.updateExperience(projectPath, entry.id, { context: "" });
    expect(readJson<{ context?: string }>(projectFile())[0]!.context).toBeUndefined();
    svc.updateExperience(projectPath, entry.id, { memory: "   " });
    expect(readJson<{ memory: string }>(projectFile())[0]!.memory).toBe("正文");
  });

  it("无匹配返回空且 total 为 0", () => {
    svc.appendExperience({ memory: "无关内容" }, { projectPath });
    const r = svc.searchExperiences("绝对不存在的词", projectPath);
    expect(r.hits).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("命中项带作用域标注（注入/检索按文件判定，不按 project 字段）", () => {
    svc.appendExperience({ memory: "全局经验 abc" }, { scope: "global", projectPath });
    const r = svc.searchExperiences("abc", projectPath);
    expect(r.hits[0]!.scope).toBe("global");
  });
});

describe("短 id：前缀解析", () => {
  it("按 8 字符前缀可定位；太短/未找到/歧义分别报错", () => {
    const a = svc.appendExperience({ memory: "经验甲" }, { projectPath }).entry;
    expect(svc.resolveExperience(projectPath, svc.shortId(a.id))).toMatchObject({ ok: true });
    expect(svc.resolveExperience(projectPath, "abc")).toMatchObject({ ok: false, reason: "too_short" });
    expect(svc.resolveExperience(projectPath, "zzzzzzzz")).toMatchObject({ ok: false, reason: "not_found" });
    // 歧义：两个 id 共享同一前缀（直接播种构造确定的前缀）——必须报歧义而不是猜一个
    seed(projectFile(), [
      { id: "abcdefgh1111-1111-1111-1111-111111111111", memory: "同前缀甲", kind: "convention", createdAt: Date.now() },
      { id: "abcdefgh2222-2222-2222-2222-222222222222", memory: "同前缀乙", kind: "convention", createdAt: Date.now() },
    ]);
    expect(svc.resolveExperience(projectPath, "abcdefgh")).toMatchObject({ ok: false, reason: "ambiguous", count: 2 });
    expect(svc.resolveExperience(projectPath, "abcdefgh1")).toMatchObject({ ok: true });
    expect(svc.resolveExperience(projectPath, "abcdefg")).toMatchObject({ ok: false, reason: "too_short" });
  });
});

describe("作用域：由落盘文件决定", () => {
  it("默认写项目库；scope=global 写全局库", () => {
    svc.appendExperience({ memory: "项目经验" }, { projectPath });
    svc.appendExperience({ memory: "全局经验" }, { scope: "global", projectPath });
    expect(readJson<{ memory: string }>(projectFile()).map((e) => e.memory)).toEqual(["项目经验"]);
    expect(readJson<{ memory: string }>(globalFile()).map((e) => e.memory)).toEqual(["全局经验"]);
  });

  it("scope=project 但无项目路径 → 兑现到全局库（不静默丢弃）", () => {
    const r = svc.appendExperience({ memory: "无项目时写的" }, { scope: "project", projectPath: undefined });
    expect(r.scope).toBe("global");
    expect(readJson<{ memory: string }>(globalFile())).toHaveLength(1);
  });

  it("kind 缺省归一化为 convention", () => {
    const { entry } = svc.appendExperience({ memory: "没写 kind" }, { projectPath });
    expect(entry.kind).toBe("convention");
    expect(svc.kindLabel(undefined)).toBe("约定");
  });
});

describe("改写与移动", () => {
  it("updateExperience 覆盖正文与 kind 并记 updatedAt", () => {
    const { entry } = svc.appendExperience({ memory: "旧正文" }, { projectPath });
    const r = svc.updateExperience(projectPath, svc.shortId(entry.id), { memory: "新正文", kind: "principle" });
    expect(r.ok).toBe(true);
    const stored = readJson<{ memory: string; kind: string; updatedAt?: number }>(projectFile())[0]!;
    expect(stored.memory).toBe("新正文");
    expect(stored.kind).toBe("principle");
    expect(stored.updatedAt).toBeGreaterThan(0);
  });

  it("moveExperience 项目 → 全局：保留 id 与计数，原库删净（不留双份）", () => {
    const { entry } = svc.appendExperience({ memory: "该跨项目的原则" }, { projectPath });
    svc.searchExperiences("该跨项目", projectPath, { touch: true }); // 造一个 usageCount
    const moved = svc.moveExperience(projectPath, svc.shortId(entry.id), "global");
    expect(moved.ok).toBe(true);
    expect(readJson(projectFile())).toHaveLength(0);
    const g = readJson<{ id: string; usageCount?: number; memory: string }>(globalFile());
    expect(g).toHaveLength(1);
    expect(g[0]!.id).toBe(entry.id);
    expect(g[0]!.usageCount).toBe(1);
  });

  it("moveExperience：目标库已满时，刚移入的条目不会被自身触发的容量淘汰丢掉", () => {
    const now = Date.now();
    const full: unknown[] = [];
    for (let i = 0; i < 200; i += 1) {
      full.push({ id: `full-${i}-1111-1111-1111-111111111111`, memory: `全局旧条目 ${i}`, kind: "principle", createdAt: now, usageCount: 4 });
    }
    seed(globalFile(), full);
    const { entry } = svc.appendExperience({ memory: "待迁移的低分临时条目", kind: "temporary" }, { projectPath });
    const moved = svc.moveExperience(projectPath, entry.id, "global");
    expect(moved.ok).toBe(true);
    const stored = readJson<{ id: string }>(globalFile());
    expect(stored.some((e) => e.id === entry.id)).toBe(true); // 不被立即淘汰
    expect(stored.length).toBe(200); // 仍遵守上限：被淘汰的是旧条目
    // 被淘汰的旧条目留档（与退役同口径：可回溯）
    const archived = readJson<{ retiredReason: string }>(path.join(tmpHome, ".easymint", "experiences-archive.json"));
    expect(archived.some((a) => a.retiredReason.includes("容量淘汰"))).toBe(true);
  });

  it("库文件损坏：改名存证后重建（不静默清空 200 条）", () => {
    writeFileSync(projectFile(), "{ 半截 JSON");
    expect(svc.searchExperiences("任意", projectPath).hits).toEqual([]);
    const names = readdirSync(path.join(projectPath, ".easymint"));
    expect(names.some((n) => n.includes("experiences.json.corrupt-"))).toBe(true);
  });
});

describe("退役：移除 + 档案留档", () => {
  it("从库中移除，原文与理由进档案；未找到的 id 进 failures", () => {
    const a = svc.appendExperience({ memory: "临时结论：发版窗口内先这样" }, { projectPath }).entry;
    svc.appendExperience({ memory: "保留的经验" }, { projectPath });
    const r = svc.retireExperiences(projectPath, [svc.shortId(a.id), "zzzzzzzz"], "发版窗口已结束");
    expect(r.retired).toHaveLength(1);
    expect(r.failures).toHaveLength(1);
    expect(readJson<{ memory: string }>(projectFile()).map((e) => e.memory)).toEqual(["保留的经验"]);
    const archived = readJson<{ memory: string; retiredReason: string }>(
      path.join(projectPath, ".easymint", "experiences-archive.json"),
    );
    expect(archived).toHaveLength(1);
    expect(archived[0]!.memory).toContain("发版窗口内先这样");
    expect(archived[0]!.retiredReason).toBe("发版窗口已结束");
  });

  it("档案文件损坏时不阻断退役：改名存证后重建（档案是回溯的唯一依据，不能静默丢）", () => {
    const a = svc.appendExperience({ memory: "待退役条目" }, { projectPath }).entry;
    const af = path.join(projectPath, ".easymint", "experiences-archive.json");
    writeFileSync(af, "{ 这不是合法 JSON");
    const r = svc.retireExperiences(projectPath, [svc.shortId(a.id)], "测试损坏容忍");
    expect(r.retired).toHaveLength(1);
    expect(readJson<{ memory: string }>(af)).toHaveLength(1);
    expect(readdirSync(path.join(projectPath, ".easymint")).some((n) => n.includes("experiences-archive.json.corrupt-"))).toBe(true);
  });
});

describe("注入块：排序 / 标记 / 短 id / 正文压缩 / 送达计数", () => {
  it("带作用域与 kind 标记、短 id；长正文保留首尾两段", () => {
    const head = "问题：第一步该做什么".repeat(10);
    const tail = "验证：跑 lint 三段全绿";
    svc.appendExperience({ memory: `${head}${"中间内容".repeat(60)}${tail}`, kind: "principle" }, { scope: "global", projectPath });
    const block = svc.buildExperienceInjection(projectPath);
    expect(block).toContain("[全局·原则]");
    expect(block).toContain("[id: ");
    expect(block).toContain("问题：第一步该做什么");
    expect(block).toContain(tail);
    expect(block).toContain("…");
  });

  it("送达计数递增（injectedCount / lastInjectedAt）", () => {
    svc.appendExperience({ memory: "会被注入的经验" }, { projectPath });
    svc.buildExperienceInjection(projectPath);
    svc.buildExperienceInjection(projectPath);
    const stored = readJson<{ injectedCount?: number; lastInjectedAt?: number }>(projectFile())[0]!;
    expect(stored.injectedCount).toBe(2);
    expect(stored.lastInjectedAt).toBeGreaterThan(0);
  });

  it("价值分排序：principle + 有命中 优先于 零命中的 convention", () => {
    const weak = svc.appendExperience({ memory: "普通约定 aaa" }, { projectPath }).entry;
    const strong = svc.appendExperience({ memory: "跨项目原则 bbb", kind: "principle" }, { projectPath }).entry;
    svc.searchExperiences("bbb", projectPath, { touch: true });
    const block = svc.buildExperienceInjection(projectPath, 1);
    expect(block).toContain("bbb");
    expect(block).not.toContain("aaa");
    expect(weak.id).not.toBe(strong.id);
  });
});

describe("体检候选：下限筛选，价值判断交给模型", () => {
  it("超期临时经验进候选，普通条目不进", () => {
    const old = Date.now() - 20 * 86400000;
    seed(projectFile(), [
      { id: "11111111-1111-1111-1111-111111111111", memory: "临时：发版窗口内先这样绕", kind: "temporary", createdAt: old },
      { id: "22222222-2222-2222-2222-222222222222", memory: "长期约定：docs 是本地仓库", kind: "convention", createdAt: old },
      { id: "33333333-3333-3333-3333-333333333333", memory: "新的临时经验", kind: "temporary", createdAt: Date.now() },
    ]);
    const items = svc.buildReviewCandidates(projectPath);
    expect(items).toHaveLength(1);
    expect(items[0]!.shortIds).toEqual(["11111111"]);
    expect(items[0]!.reason).toContain("临时经验已 20 天");
  });

  it("开头相同的重复条目整组给出；开头过短的不误报", () => {
    const prefix = "复核待办清单时逐条从当前代码取证不要照抄备注";
    seed(projectFile(), [
      { id: "aaaa1111-1111-1111-1111-111111111111", memory: `${prefix}（第 1 份）`, kind: "principle", createdAt: Date.now() },
      { id: "aaaa2222-2222-2222-2222-222222222222", memory: `${prefix}（第 2 份）`, kind: "principle", createdAt: Date.now() },
      { id: "bbbb1111-1111-1111-1111-111111111111", memory: "短", kind: "convention", createdAt: Date.now() },
    ]);
    const items = svc.buildReviewCandidates(projectPath);
    expect(items).toHaveLength(1);
    expect(items[0]!.shortIds.sort()).toEqual(["aaaa1111", "aaaa2222"]);
  });

  it("体检清单会附在注入块末尾；无候选时不出现该段", () => {
    seed(projectFile(), [
      { id: "11111111-1111-1111-1111-111111111111", memory: "临时经验甲", kind: "temporary", createdAt: Date.now() - 30 * 86400000 },
    ]);
    expect(svc.buildExperienceInjection(projectPath)).toContain("【待体检 1 条】");
    seed(projectFile(), [{ id: "11111111-1111-1111-1111-111111111111", memory: "普通经验", kind: "convention", createdAt: Date.now() }]);
    expect(svc.buildExperienceInjection(projectPath)).not.toContain("待体检");
  });
});

describe("容量淘汰：按价值分丢最低分（不再按最旧）", () => {
  it("超上限时丢掉低分条目，高分（principle + 命中）保留", () => {
    const now = Date.now();
    const rows: unknown[] = [];
    for (let i = 0; i < 200; i += 1) {
      rows.push({
        id: `low-${i.toString().padStart(4, "0")}-1111-1111-1111-111111111111`,
        memory: `低分条目 ${i}`,
        kind: "convention",
        createdAt: now,
      });
    }
    rows.push({
      id: "keep-me-1111-1111-1111-111111111111",
      memory: "高分条目：跨项目原则且被引用过",
      kind: "principle",
      createdAt: now - 400 * 86400000, // 最旧——若按时间淘汰它必被丢
      usageCount: 4,
    });
    // 全局库没有项目加成，分数差异只来自 kind 与命中，判定更干净
    seed(globalFile(), rows);
    const added = svc.appendExperience({ memory: "新条目" }, { scope: "global" });
    const stored = readJson<{ id: string }>(globalFile());
    expect(stored).toHaveLength(200);
    expect(stored.some((e) => e.id === "keep-me-1111-1111-1111-111111111111")).toBe(true);
    expect(stored.some((e) => e.id === added.entry.id)).toBe(true);
    expect(stored.some((e) => e.id.startsWith("low-"))).toBe(true);
    expect(stored.filter((e) => e.id.startsWith("low-"))).toHaveLength(198);
  });
});
