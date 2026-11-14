import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
vi.mock("electron", () => ({ app: { isPackaged: false } }));
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "em-template-config-")); vi.stubEnv("EASYMINT_HOME", root); vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
describe("unified execution templates", () => {
  it("keeps the settings entry usable when startup encounters invalid prompt JSON", async () => {
    const file = path.join(root, "system-prompts.json"); fs.writeFileSync(file, "{broken");
    const templates = await import("./agent-templates");
    expect(templates.seedDefaults()).toContain("初始化未完成");
    const manager = await import("./system-prompt-manager");
    expect(manager.getConversationConfig().warning).toContain("合法 JSON");
    expect(manager.getConversationConfig().main.nickname).toBe("Mint");
    expect(fs.readFileSync(file, "utf8")).toBe("{broken");
  });
  it("resolves exact historical IDs before aliases and never treats prototype names as aliases", async () => {
    fs.writeFileSync(path.join(root, "system-prompts.json"), JSON.stringify({ version: 2, main: {}, modes: [], templates: [
      { id: "builder", name: "Historical", description: "Desc", prompt: "EXACT_BUILDER", agentType: "custom" },
      { id: "toString", name: "Historical2", description: "Desc", prompt: "EXACT_PROTOTYPE_NAME", agentType: "custom" },
    ] }));
    const templates = await import("./agent-templates");
    expect(templates.getTemplate("builder")?.prompt).toBe("EXACT_BUILDER");
    expect(templates.getTemplate("toString")?.prompt).toBe("EXACT_PROTOTYPE_NAME");
    expect(templates.getTemplate("constructor")).toBeUndefined();
    expect(templates.getTemplate("evaluator")?.id).toBe("default-evaluator");
  });
  it("resolves builtins without materializing a second user file", async () => {
    const templates = await import("./agent-templates"); templates.seedDefaults();
    for (const id of ["default-builder", "default-evaluator"]) {
      const template = templates.getTemplate(id)!; expect(template.prompt).toContain("CodeGraph 可用时");
      expect(template).not.toHaveProperty("model"); expect(template).not.toHaveProperty("thinkingLevel");
    }
    expect(fs.existsSync(path.join(root, "agent-templates.json"))).toBe(false);
    expect(templates.getTemplate("mint")).toBeUndefined();
  });
  it("keeps custom templates, readonly historical metadata, and prompt edits across initialization", async () => {
    fs.writeFileSync(path.join(root, "agent-templates.json"), JSON.stringify([
      { id: "default-builder", name: "历史构建者", description: "保留说明", prompt: "MY_RULES", agentType: "builder", model: "retired" },
      { id: "custom", name: "Custom", description: "Desc", prompt: "CUSTOM_RULES", agentType: "custom", thinkingLevel: "retired" },
      { id: "mint-designer", name: "旧设计", description: "Old", prompt: "OLD_DESIGNER", agentType: "designer" },
    ]));
    const templates = await import("./agent-templates"); templates.seedDefaults(); templates.seedDefaults();
    expect(templates.getTemplate("default-builder")).toMatchObject({ name: "历史构建者", description: "保留说明", prompt: "MY_RULES" });
    expect(templates.getTemplate("custom")?.prompt).toBe("CUSTOM_RULES");
    expect(templates.getTemplate("custom")).not.toHaveProperty("thinkingLevel");
    expect(templates.listTemplates().some(item => item.id === "mint-designer")).toBe(false);
    expect(templates.getTemplate("mint-designer")?.prompt).toContain("showcase");
    const stored = JSON.parse(fs.readFileSync(path.join(root, "system-prompts.json"), "utf8"));
    expect(stored.legacyTemplates.find((item: { id: string }) => item.id === "mint-designer").prompt).toBe("OLD_DESIGNER");
    templates.restoreTemplate("default-builder");
    expect(templates.getTemplate("default-builder")).toMatchObject({ name: "历史构建者", description: "保留说明" });
    expect(templates.getTemplate("default-builder")?.prompt).not.toBe("MY_RULES");
    expect(templates.getTemplate("custom")?.prompt).toBe("CUSTOM_RULES");
  });
  it("only allows builtin prompt edits and detects stale saves", async () => {
    const templates = await import("./agent-templates"); const before = templates.getTemplate("default-builder")!;
    expect(() => templates.updateTemplate("default-builder", { name: "Rename" })).toThrow();
    expect(() => templates.updateTemplate("default-builder", { agentType: "custom" })).toThrow();
    for (const id of ["mint", "default-builder", "default-evaluator"]) expect(() => templates.deleteTemplate(id)).toThrow();
    templates.updateTemplate(before.id, { prompt: "NEW_RULES" }, before.revision);
    expect(() => templates.updateTemplate(before.id, { prompt: "STALE" }, before.revision)).toThrow("其他窗口");
    expect(templates.getTemplate(before.id)?.prompt).toBe("NEW_RULES");
  });
  it("custom templates retain IDs on edit and use the same config as the main profile", async () => {
    const templates = await import("./agent-templates"); const manager = await import("./system-prompt-manager");
    const custom = templates.createTemplate({ name: "测试员", description: "Desc", prompt: "RULES", agentType: "builder" });
    expect(custom.agentType).toBe("builder");
    manager.saveMainChat({ ...manager.getConversationConfig().main, nickname: "Mori" });
    expect(templates.updateTemplate(custom.id, { name: "新名称" }, custom.revision).id).toBe(custom.id);
    expect(manager.getConversationConfig().main.nickname).toBe("Mori");
    expect(templates.listTemplates().find(item => item.id === "mint")?.name).toBe("Mori");
    templates.deleteTemplate(custom.id); expect(templates.getTemplate(custom.id)).toBeUndefined();
  });
});
