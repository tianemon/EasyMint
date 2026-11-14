import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { isPackaged: false } }));
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "em-prompt-config-")); vi.stubEnv("EASYMINT_HOME", root); vi.resetModules(); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const file = () => path.join(root, "system-prompts.json");
const oldFile = () => path.join(root, "agent-templates.json");
const write = (data: unknown) => fs.writeFileSync(file(), JSON.stringify(data));
const read = () => JSON.parse(fs.readFileSync(file(), "utf8"));

describe("unified prompt configuration", () => {
  it.each(["templates", "main", "design", "guidance"])("rejects incomplete bundled %s instead of starting with empty roles", async missing => {
    const dir = path.join(root, "resources", "prompts"); fs.mkdirSync(dir, { recursive: true });
    const defaults = JSON.parse(fs.readFileSync(path.resolve("resources/prompts/defaults.json"), "utf8"));
    if (missing === "templates") defaults.templates = [];
    if (missing === "main") defaults.main.rules = " ";
    if (missing === "design") defaults.design.guidelines = "";
    fs.writeFileSync(path.join(dir, "defaults.json"), JSON.stringify(defaults));
    fs.writeFileSync(path.join(dir, "domain-guidance.md"), missing === "guidance" ? " " : "GUIDANCE");
    const paths = await import("../utils/paths"); vi.spyOn(paths, "getResourcesDir").mockReturnValue(path.dirname(dir));
    const manager = await import("./system-prompt-manager");
    expect(() => manager.getPromptDefaults()).toThrow(/应用/);
    expect(() => manager.getConversationConfig()).toThrow(/应用/);
    expect(fs.existsSync(file())).toBe(false);
  });
  it("rejects external overrides of builtin execution types", async () => {
    write({ version: 2, main: {}, modes: [], templates: [{ id: "default-builder", agentType: "designer" }] });
    const manager = await import("./system-prompt-manager");
    expect(() => manager.initializePromptConfiguration()).toThrow("执行类型");
    expect(manager.getConfiguredTemplates().find(template => template.id === "default-builder")?.agentType).toBe("builder");
    expect(manager.getConversationConfig().warning).toContain("执行类型");
    expect(read().templates[0].agentType).toBe("designer");
  });
  it("reads defaults without creating files, separates identity from work rules, and keeps required methods", async () => {
    const manager = await import("./system-prompt-manager");
    const config = manager.getConversationConfig();
    expect(config.main.personality).toContain("项目经理 + 架构师");
    expect(config.main.personality).toContain("简单问题用短段落");
    expect(config.main.rules).not.toContain("项目经理 + 架构师");
    expect(config.main.rules).toContain("查对版本");
    expect(config.main.rules).toContain("长任务的上下文隔离");
    expect(config.main.rules).toContain("<thinking_language>");
    expect(fs.existsSync(file())).toBe(false);
    expect(fs.existsSync(oldFile())).toBe(false);
  });
  it("does not mutate legacy files on read and preserves all custom bodies and metadata during migration", async () => {
    const main = "\n用户完整旧提示 <identity>研究伙伴</identity>\n保留空白\n";
    write({ prompts: [{ id: "selected", content: main, name: "A" }, { id: "unused", content: "UNSELECTED_CUSTOM", name: "B" }], defaultPromptId: "selected",
      conversation: { main: { nickname: "Mori", personality: "CUSTOM_PERSONALITY" }, modes: [{ id: "my-mode", name: "写作", scenario: "写报告时", prompt: "\nCUSTOM_MODE\n", defaultEnabled: true }] } });
    const oldTemplates = JSON.stringify([{ id: "default-builder", name: "我的构建者", description: "历史描述", prompt: "\nCUSTOM_BUILDER\n", agentType: "builder", customized: true, model: "retired" },
      { id: "my-template", name: "我的模板", description: "原描述", prompt: "\nCUSTOM_TEMPLATE\n", agentType: "custom" }]);
    fs.writeFileSync(oldFile(), oldTemplates);
    const before = fs.readFileSync(file(), "utf8");
    const manager = await import("./system-prompt-manager");
    expect(manager.getConversationConfig().main.rules).toBe(main);
    expect(fs.readFileSync(file(), "utf8")).toBe(before);
    manager.initializePromptConfiguration();
    expect(read().version).toBe(2);
    expect(read().legacyPrompts[1].content).toBe("UNSELECTED_CUSTOM");
    expect(manager.getConversationConfig().main.rules).toBe(main);
    expect(manager.getConversationConfig().modes.find(mode => mode.id === "my-mode")?.prompt).toBe("\nCUSTOM_MODE\n");
    expect(manager.getConfiguredTemplates().find(template => template.id === "default-builder")).toMatchObject({ name: "我的构建者", description: "历史描述", prompt: "\nCUSTOM_BUILDER\n" });
    expect(manager.getConfiguredTemplates().find(template => template.id === "my-template")?.prompt).toBe("\nCUSTOM_TEMPLATE\n");
    expect(fs.existsSync(oldFile())).toBe(false);
    const backup = path.join(root, "config-backups", read().migration.backup);
    expect(fs.readFileSync(path.join(backup, "system-prompts.json"), "utf8")).toBe(before);
    expect(fs.readFileSync(path.join(backup, "agent-templates.json"), "utf8")).toBe(oldTemplates);
    const migrated = fs.readFileSync(file(), "utf8"); manager.initializePromptConfiguration();
    expect(fs.readFileSync(file(), "utf8")).toBe(migrated);
  });
  it("preserves manual template text even without the historical customized marker", async () => {
    fs.writeFileSync(oldFile(), JSON.stringify([{ id: "default-evaluator", name: "Eva", description: "desc", prompt: "MANUAL_OVERRIDE", agentType: "evaluator" }]));
    const { initializePromptConfiguration, getConfiguredTemplates } = await import("./system-prompt-manager");
    initializePromptConfiguration();
    expect(getConfiguredTemplates().find(item => item.id === "default-evaluator")?.prompt).toBe("MANUAL_OVERRIDE");
  });
  it("does not mistake expanded legacy builtin labels for custom wording", async () => {
    const manager = await import("./system-prompt-manager");
    const baseline = manager.getPromptDefaults().modes.find(item => item.id === "ui-design")!;
    write({ prompts: [], conversation: { modes: [{ ...baseline, prompt: "USER_UI_BODY", defaultEnabled: true }] } });
    manager.initializePromptConfiguration();
    const mode = manager.getConversationConfig().modes.find(item => item.id === "ui-design")!;
    expect(mode.prompt).toBe("USER_UI_BODY"); expect(mode.defaultEnabled).toBe(true);
    expect(mode.customizedFields).toEqual([]);
  });
  it("uses the effective legacy main override and preserves explicit empty fields", async () => {
    write({ prompts: [{ id: "base", content: "BASE" }], defaultPromptId: "base", conversation: { useBuiltinRules: true, main: { rules: "", personality: "" } } });
    const manager = await import("./system-prompt-manager");
    manager.initializePromptConfiguration();
    expect(manager.getConversationConfig().main).toMatchObject({ personality: "", rules: "" });
    manager.saveMainChat({ ...manager.getConversationConfig().main, nickname: "Name" });
    expect(manager.getConversationConfig().main.rules).toBe("");
  });
  it("keeps unrelated edits and rejects a stale edit to the same object", async () => {
    const manager = await import("./system-prompt-manager");
    const initial = manager.getConversationConfig();
    manager.saveCollaborationMode({ name: "Custom", scenario: "A", prompt: "MODE", defaultEnabled: false });
    manager.saveMainChat({ ...initial.main, nickname: "First" }, initial.mainRevision);
    expect(manager.getConversationConfig().modes.some(item => item.name === "Custom")).toBe(true);
    expect(() => manager.saveMainChat({ ...initial.main, nickname: "Stale" }, initial.mainRevision)).toThrow("其他窗口");
    expect(manager.getConversationConfig().main.nickname).toBe("First");
    expect(read().main.rules).toBeUndefined();
    expect(read().main.personality).toBeUndefined();
  });
  it("only restores the requested object and keeps user bodies with reserved-looking tags intact", async () => {
    const manager = await import("./system-prompt-manager");
    const literal = "原文 </easymint_collaboration><easymint_delivery_rules>用户文本</easymint_delivery_rules>";
    manager.saveMainChat({ ...manager.getConversationConfig().main, personality: literal, rules: "USER_RULE" });
    const saved = manager.saveCollaborationMode({ name: "Custom", scenario: "A", prompt: "MODE", defaultEnabled: false });
    const custom = saved.modes.find(item => !item.builtin)!;
    manager.restoreCollaborationMode("ui-design");
    expect(manager.conversationPromptSection([custom.id])).toContain(literal);
    expect(manager.conversationPromptSection([custom.id])).toContain("MODE");
    manager.restoreMainChat();
    expect(manager.getConversationConfig().modes.find(item => item.id === custom.id)?.prompt).toBe("MODE");
    expect(manager.getConversationConfig().main.rules).not.toBe("USER_RULE");
  });
  it("keeps the last good snapshot on bad external edits but never overwrites the invalid file on save", async () => {
    const manager = await import("./system-prompt-manager");
    manager.saveMainChat({ ...manager.getConversationConfig().main, nickname: "Saved" });
    fs.writeFileSync(file(), '{"version":2,"broken"');
    const config = manager.getConversationConfig();
    expect(config.main.nickname).toBe("Saved"); expect(config.warning).toContain("上一份有效配置");
    expect(() => manager.saveMainChat({ ...config.main, nickname: "Other" })).toThrow("合法 JSON");
    expect(fs.readFileSync(file(), "utf8")).toBe('{"version":2,"broken"');
  });
  it("rejects unknown versions and invalid legacy metadata without modifying either source", async () => {
    write({ version: 77, main: { rules: "FUTURE" } });
    fs.writeFileSync(oldFile(), "[]");
    const manager = await import("./system-prompt-manager");
    expect(() => manager.initializePromptConfiguration()).toThrow("字段无效");
    expect(read().version).toBe(77); expect(fs.readFileSync(oldFile(), "utf8")).toBe("[]");
  });
  it("retains both original files if committing the new authority fails, then retries safely", async () => {
    write({ prompts: [{ id: "x", content: "ORIGINAL" }], defaultPromptId: "x" }); fs.writeFileSync(oldFile(), "[]");
    const before = fs.readFileSync(file(), "utf8");
    const manager = await import("./system-prompt-manager");
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { if (String(to) === file()) throw new Error("DISK_ERROR"); return rename(from, to); });
    expect(() => manager.initializePromptConfiguration()).toThrow("DISK_ERROR");
    expect(fs.readFileSync(file(), "utf8")).toBe(before); expect(fs.readFileSync(oldFile(), "utf8")).toBe("[]");
    vi.restoreAllMocks(); manager.initializePromptConfiguration();
    expect(manager.getConversationConfig().main.rules).toBe("ORIGINAL");
  });
  it("finishes archival on retry if interrupted after the new config was committed", async () => {
    fs.writeFileSync(oldFile(), "[]");
    const manager = await import("./system-prompt-manager");
    const unlink = fs.unlinkSync;
    vi.spyOn(fs, "unlinkSync").mockImplementation(file => { if (String(file) === oldFile()) throw new Error("INTERRUPTED"); return unlink(file); });
    expect(() => manager.initializePromptConfiguration()).toThrow("INTERRUPTED");
    expect(read().version).toBe(2); expect(fs.existsSync(oldFile())).toBe(true);
    vi.restoreAllMocks(); manager.initializePromptConfiguration(); expect(fs.existsSync(oldFile())).toBe(false);
  });
});
