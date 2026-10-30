import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../pi-sdk", () => ({ getDefineToolFn: async () => (definition: unknown) => definition }));
vi.mock("../skill-service", () => ({ writeManagedSkill: vi.fn(() => { throw new Error("skill writes are outside this fixture"); }) }));

type Tool = { execute(id: string, args: Record<string, unknown>): Promise<{ content: Array<{ text: string }> }> };
let root: string;
let projectPath: string;
let learn: Tool;
let search: Tool;
let retire: Tool;
const run = async (tool: Tool, args: Record<string, unknown>) => (await tool.execute("test-call", args)).content.map(c => c.text).join("\n");
const index = (dir: string) => JSON.parse(readFileSync(path.join(dir, "index.json"), "utf-8")) as { items: Array<{ id: string; file: string; usageCount?: number }> };

beforeEach(async () => {
  root = path.join(process.cwd(), "temp/tests", `learn-tools-${randomUUID()}`);
  projectPath = path.join(root, "project");
  mkdirSync(projectPath, { recursive: true });
  vi.stubEnv("EASYMINT_HOME", path.join(root, "em-home"));
  vi.resetModules();
  const tools = await import("./learn-tool");
  const retiring = await import("./experience-tool");
  learn = await tools.createLearnTool({ projectPath }) as unknown as Tool;
  search = await tools.createSearchExperiencesTool(projectPath) as unknown as Tool;
  retire = await retiring.createRetireExperiencesTool({ projectPath }) as unknown as Tool;
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("explicit experience tools remain usable without an automatic continuation", () => {
  it("saves, searches, updates by short id and retires to the archive through the actual tool boundaries", async () => {
    const dir = path.join(projectPath, ".easymint/experiences");
    expect(await run(learn, { title: "取消后的迟到回调", body: "问题：取消后仍写入。\n做法：核对所有者。\n验证：迟到结果被丢弃。" })).toContain("已入库");
    const first = index(dir).items[0]!;
    expect(existsSync(path.join(dir, first.file))).toBe(true);
    const hit = await run(search, { query: "迟到" });
    expect(hit).toContain(first.id.slice(0, 8));
    expect(hit).toContain("检索命中");
    expect(index(dir).items[0]!.usageCount).toBe(1);
    expect(await run(learn, { title: "取消后的迟到回调", body: "已验证的新边界", updateId: first.id.slice(0, 8) })).toContain("已改写");
    expect(index(dir).items).toHaveLength(1);
    expect(index(dir).items[0]!.usageCount).toBe(1);
    expect(readFileSync(path.join(dir, first.file), "utf-8")).toContain("已验证的新边界");
    expect(await run(retire, { ids: [first.id.slice(0, 8)], reason: "已由现行规则覆盖" })).toContain("完成：已退役 1 条");
    expect(index(dir).items).toHaveLength(0);
    expect(existsSync(path.join(dir, "archive", first.file))).toBe(true);
    expect(existsSync(path.join(root, "em-home", "learn-state.json"))).toBe(false);
  });

  it("retains project/global scope and case-normalized tags for matching", async () => {
    await run(learn, { title: "通用 Electron 行为", body: "验证结果", scope: "global", kind: "principle", tags: "Electron,macos" });
    const dir = path.join(root, "em-home", "experiences");
    expect(index(dir).items).toHaveLength(1);
    const result = await run(search, { query: "Electron" });
    expect(result).toContain("全局·原则");
    expect(result).toContain("electron,macos");
    expect(result).not.toContain("验证结果");
  });
});
