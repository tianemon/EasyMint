import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() } }));

/**
 * 模板**只承载人设**（2026-09-16 用户拍板：子 agent 只跟随主会话的模型配置，
 * 取消全部子 agent 的配置入口）。三条不变式在这里锚住，它们都属于
 * "删掉不会立刻报错、但会在几周后让人误判"的那一类：
 *  ① 已废弃的 model / provider / thinkingLevel 在启动播种时被清掉
 *     （本机 mint-designer 就残留过一个永不生效的 thinkingLevel=max）；
 *  ② 模板**不再有**这三个字段——它们回不来；
 *  ③ 内置模板只读：原先 Builder/Evaluator 的「受限编辑」正是靠那三个字段存在的。
 */
describe("seedDefaults 的模板字段卫生", () => {
  let home: string;
  let mod: typeof import("./agent-templates");
  let storePath: string;

  const writeStore = (templates: unknown[]): void => {
    mkdirSync(path.join(home, ".easymint"), { recursive: true });
    writeFileSync(storePath, JSON.stringify(templates, null, 2), "utf-8");
  };
  const readStore = (): Array<Record<string, unknown>> =>
    JSON.parse(readFileSync(storePath, "utf-8"));
  const byId = (id: string): Record<string, unknown> | undefined =>
    readStore().find((t) => t.id === id);

  beforeAll(async () => {
    // DATA_DIR 在模块顶层求值，故必须先改掉 homedir 再 import
    home = mkdtempSync(path.join(os.tmpdir(), "em-tpl-seed-"));
    storePath = path.join(home, ".easymint", "agent-templates.json");
    vi.spyOn(os, "homedir").mockReturnValue(home);
    mod = await import("./agent-templates");
  });

  afterAll(() => {
    vi.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
  });

  it("清理既有 json 里的 model / provider / thinkingLevel（含 mint-designer 的历史残留）", () => {
    writeStore([
      { id: "mint", name: "Mint", description: "d", prompt: "p", agentType: "mint" },
      { id: "mint-designer", name: "Mint-D", description: "d", prompt: "p", agentType: "designer", thinkingLevel: "max", model: "claude-opus-4-6" },
      { id: "default-builder", name: "Builder", description: "d", prompt: "p", agentType: "builder", thinkingLevel: "high", provider: "deepseek" },
    ]);

    mod.seedDefaults();

    for (const id of ["mint", "mint-designer", "default-builder"]) {
      const t = byId(id)!;
      expect(t.model, `${id} 的 model 应被清掉`).toBeUndefined();
      expect(t.provider, `${id} 的 provider 应被清掉`).toBeUndefined();
      expect(t.thinkingLevel, `${id} 的 thinkingLevel 应被清掉`).toBeUndefined();
    }
    // 清理只针对废弃字段，人设内容原样保留
    expect(byId("mint-designer")!.name).toBe("Mint-D");
  });

  it("新建的内置模板本身就不带这三个字段", () => {
    writeStore([]);

    mod.seedDefaults();

    for (const id of ["default-builder", "default-evaluator"]) {
      expect("model" in byId(id)!).toBe(false);
      expect("thinkingLevel" in byId(id)!).toBe(false);
    }
  });

  it("自定义模板原样保留（它的字段没被误伤）", () => {
    writeStore([
      { id: "custom-1", name: "审查员", description: "d", prompt: "p", agentType: "custom" },
    ]);

    mod.seedDefaults();

    expect(byId("custom-1")!.name).toBe("审查员");
    expect(byId("custom-1")!.agentType).toBe("custom");
  });

  it("Mint 的提示词/描述始终强制内置", () => {
    writeStore([
      { id: "mint", name: "Mint", description: "旧描述", prompt: "旧提示词", agentType: "mint" },
    ]);

    mod.seedDefaults();

    expect(byId("mint")!.prompt).not.toBe("旧提示词");
    expect(byId("mint")!.description).not.toBe("旧描述");
  });
  it("只读内置角色同步新提示词，保留展示字段和自定义模板", () => {
    writeStore([
      { id: "default-builder", name: "Builder", description: "保留说明", prompt: "旧规则", agentType: "builder" },
      { id: "default-evaluator", name: "Evaluator", description: "保留说明", prompt: "旧规则", agentType: "evaluator" },
      { id: "custom-health", name: "Custom", description: "自定义", prompt: "用户规则", agentType: "custom" },
    ]);
    mod.seedDefaults();
    for (const id of ["default-builder", "default-evaluator"]) {
      expect(byId(id)!.prompt).toContain("CodeGraph 可用时");
      expect(byId(id)!.description).toBe("保留说明");
    }
    expect(byId("custom-health")!.prompt).toBe("用户规则");
  });
});

describe("内置模板权限", () => {
  let home: string;
  let mod: typeof import("./agent-templates");
  let storePath: string;

  const writeStore = (templates: unknown[]): void => {
    mkdirSync(path.join(home, ".easymint"), { recursive: true });
    writeFileSync(storePath, JSON.stringify(templates, null, 2), "utf-8");
  };

  beforeAll(async () => {
    home = mkdtempSync(path.join(os.tmpdir(), "em-tpl-perm-"));
    storePath = path.join(home, ".easymint", "agent-templates.json");
    vi.spyOn(os, "homedir").mockReturnValue(home);
    mod = await import("./agent-templates");
  });

  afterAll(() => {
    vi.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
  });

  it("四个内置模板都不可修改（Builder/Evaluator 的「受限编辑」随三个字段一并消失）", () => {
    writeStore([]);
    mod.seedDefaults();
    for (const id of ["mint", "mint-designer", "default-builder", "default-evaluator"]) {
      expect(() => mod.updateTemplate(id, { name: "改名" }), `${id} 应拒绝修改`).toThrow();
    }
  });

  it("内置模板不可删除", () => {
    writeStore([]);
    mod.seedDefaults();
    for (const id of ["mint", "default-builder"]) {
      expect(() => mod.deleteTemplate(id), `${id} 应拒绝删除`).toThrow();
    }
  });

  it("自定义模板可改可删（模板机制本身保留）", () => {
    writeStore([]);
    const t = mod.createTemplate({ name: "测试员", description: "d", prompt: "p" });
    expect(mod.updateTemplate(t.id, { name: "测试员2" }).name).toBe("测试员2");
    mod.deleteTemplate(t.id);
    expect(mod.getTemplate(t.id)).toBeUndefined();
  });
});
