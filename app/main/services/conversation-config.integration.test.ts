import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelRuntime, type AgentSession } from "@earendil-works/pi-coding-agent";
import { getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { DEFAULT_MAIN_CHAT, DOMAIN_GUIDANCE_MODE_ID, UI_DESIGN_MODE_ID } from "../../shared/collaboration";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() }, BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("./pi-init", async original => ({ ...await original<object>(), getModelRuntime: vi.fn() }));
let root: string;
let session: AgentSession | undefined;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "em-conversation-config-"));
  vi.stubEnv("EASYMINT_HOME", root);
  vi.stubEnv("PI_CODING_AGENT_DIR", path.join(root, "agent"));
  vi.resetModules();
});
afterEach(async () => {
  if (session) await (await import("./pi-session")).disposePiSession(session);
  session = undefined;
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

it("reads defaults without writing and preserves a legacy selected prompt through configuration saves", async () => {
  const manager = await import("./system-prompt-manager");
  expect(manager.getConversationConfig().main).toMatchObject({ nickname: "Mint", avatar: "", personality: DEFAULT_MAIN_CHAT.personality });
  expect(manager.getConversationConfig().main.rules).toContain("<identity>");
  expect(manager.getConversationConfig().main.personality).toContain("简单问题用短段落");
  expect(manager.getConversationConfig().main.personality).toContain("与用户交互时使用用户所用的语言");
  expect(manager.getConversationConfig().main.rules).not.toContain("简单问题用短段落");
  expect(manager.getConversationConfig().main.rules).not.toContain("与用户交互时使用用户所用的语言");
  expect(manager.getConversationConfig().main.rules).toContain("查证");
  expect(manager.getConversationConfig().main.rules).toContain("授权");
  expect(fs.existsSync(path.join(root, "system-prompts.json"))).toBe(false);
  fs.writeFileSync(path.join(root, "system-prompts.json"), JSON.stringify({ prompts: [{ id: "custom", content: "LEGACY_BASE" }], defaultPromptId: "custom" }));
  manager.saveMainChat({ ...DEFAULT_MAIN_CHAT, nickname: "Mori", personality: "PERSONALITY", rules: "USER_RULES" });
  expect(manager.resolveEffectivePrompt()).toBe("LEGACY_BASE");
  expect(manager.conversationPromptSection([])).toContain("Mori");
  expect(manager.conversationPromptSection([])).toContain("PERSONALITY");
  expect(manager.conversationPromptSection([])).toContain("USER_RULES");
  manager.restoreMainChat();
  const restored = JSON.parse(fs.readFileSync(path.join(root, "system-prompts.json"), "utf8"));
  expect(restored.conversation.useBuiltinRules).toBe(true);
  expect(restored.conversation.main.rules).toBeUndefined();
  expect(manager.getConversationConfig().main.rules).not.toBe("LEGACY_BASE");
  expect(manager.resolveEffectivePrompt()).toBe("LEGACY_BASE");
  expect(() => manager.saveMainChat({ ...DEFAULT_MAIN_CHAT, avatar: "data:image/svg+xml;base64,PHN2Zz4=" })).toThrow();
});

it("saves custom and built-in modes, keeps explicit empty selections, and restores only the requested default", async () => {
  const manager = await import("./system-prompt-manager");
  const ui = manager.getConversationConfig().modes.find(mode => mode.id === UI_DESIGN_MODE_ID)!;
  manager.saveCollaborationMode({ ...ui, prompt: "CUSTOM_UI", defaultEnabled: true });
  const saved = manager.saveCollaborationMode({ name: "Brand", scenario: "When applying our brand", prompt: "BRAND_RULES", defaultEnabled: true });
  const custom = saved.modes.find(mode => !mode.builtin)!;
  expect(manager.conversationPromptSection([UI_DESIGN_MODE_ID, custom.id])).toContain("CUSTOM_UI");
  expect(manager.conversationPromptSection([UI_DESIGN_MODE_ID, custom.id])).toContain("BRAND_RULES");
  expect(manager.conversationPromptSection([])).not.toContain("CUSTOM_UI");
  manager.restoreCollaborationMode(UI_DESIGN_MODE_ID);
  expect(manager.getConversationConfig().modes.find(mode => mode.id === custom.id)?.prompt).toBe("BRAND_RULES");
  expect(() => manager.deleteCollaborationMode(UI_DESIGN_MODE_ID)).toThrow();
  manager.deleteCollaborationMode(custom.id);
  expect(manager.getConversationConfig().modes.some(mode => mode.id === custom.id)).toBe(false);
});

it("persists only edited overrides so untouched defaults follow a new baseline", async () => {
  const manager = await import("./system-prompt-manager");
  const ui = manager.getConversationConfig().modes.find(mode => mode.id === UI_DESIGN_MODE_ID)!;
  manager.saveCollaborationMode({ ...ui, defaultEnabled: true });
  const stored = JSON.parse(fs.readFileSync(path.join(root, "system-prompts.json"), "utf8"));
  expect(stored.conversation.main.rules).toBeUndefined();
  expect(stored.conversation.modes).toEqual([{ id: UI_DESIGN_MODE_ID, defaultEnabled: true }]);
  expect(manager.getConversationConfig("NEW_DEFAULT_RULES").main.rules).toBe("NEW_DEFAULT_RULES");
});

it("does not seed design resources for a readonly active session", async () => {
  const { AgentService } = await import("./agent-service");
  const { Store } = await import("./store");
  const { writeCache } = await import("./session-cache");
  const seed = await import("./designer-seed");
  const seeded = vi.spyOn(seed, "ensureDesignerTemplates");
  const service = new AgentService(new Store(root));
  const internals = service as unknown as { activeChats: Map<string, unknown>; rebindToCurrentProvider(): Promise<void>; launchPrompt(): void };
  internals.activeChats.set("chat-test", { chatId: "chat-test", sessionId: "mode-session", projectPath: root, session: { isStreaming: false }, eventBuffer: [] });
  vi.spyOn(internals, "rebindToCurrentProvider").mockResolvedValue();
  vi.spyOn(internals, "launchPrompt").mockImplementation(() => {});
  writeCache("mode-session", { permissionMode: "readonly" });
  await service.sendMessage(root, "review UI", "mode-session", "readonly", {} as never, undefined, false, undefined, undefined, undefined, undefined, [UI_DESIGN_MODE_ID]);
  expect(seeded).not.toHaveBeenCalled();
  expect(fs.existsSync(path.join(root, ".easymint", "templates"))).toBe(false);
  writeCache("mode-session", { permissionMode: "standard" });
  await service.sendMessage(root, "build UI", "mode-session", "standard", {} as never, undefined, false, undefined, undefined, undefined, undefined, [UI_DESIGN_MODE_ID]);
  expect(seeded).toHaveBeenCalledOnce();
  expect(fs.existsSync(path.join(root, ".easymint", "templates"))).toBe(true);
  vi.restoreAllMocks();
});

it("preserves edited execution templates across startup and keeps the main profile out of task prompts", async () => {
  const templates = await import("./agent-templates");
  templates.seedDefaults();
  templates.updateTemplate("default-builder", { prompt: "BUILDER_OVERRIDE" });
  templates.seedDefaults();
  expect(templates.getTemplate("default-builder")?.prompt).toBe("BUILDER_OVERRIDE");
  expect(templates.listTemplates().some(template => template.id === "mint-designer")).toBe(false);
  expect(() => templates.updateTemplate("default-evaluator", { name: "Another name" })).toThrow();
  const templatePath = path.join(root, "agent-templates.json");
  const storedTemplates = JSON.parse(fs.readFileSync(templatePath, "utf8")) as Array<{ id: string; name: string; description: string }>;
  storedTemplates.find(template => template.id === "default-builder")!.name = "Historical builder name";
  storedTemplates.find(template => template.id === "default-builder")!.description = "Historical description";
  fs.writeFileSync(templatePath, JSON.stringify(storedTemplates));
  templates.restoreTemplate("default-builder");
  expect(templates.getTemplate("default-builder")?.prompt).not.toBe("BUILDER_OVERRIDE");
  expect(templates.getTemplate("default-builder")?.name).toBe("Historical builder name");
  expect(templates.getTemplate("default-builder")?.description).toBe("Historical description");
  const manager = await import("./system-prompt-manager");
  manager.saveMainChat({ ...DEFAULT_MAIN_CHAT, personality: "MAIN_ONLY_PERSONALITY" });
  const { AgentService } = await import("./agent-service");
  const { Store } = await import("./store");
  const service = new AgentService(new Store(root)) as unknown as { buildSystemPrompt(cwd: string, designer: boolean, options: { worker: boolean }): string };
  expect(service.buildSystemPrompt(root, false, { worker: true })).not.toContain("MAIN_ONLY_PERSONALITY");
});

it("offers guidance without blocking or enabling it and respects a saved refusal", async () => {
  const { createGuidanceTool } = await import("./tools/guidance-tool");
  const { writeCache, readCache } = await import("./session-cache");
  const ipc = await import("./ipc-broadcast");
  const broadcast = vi.spyOn(ipc, "broadcast");
  const { readonlyDenyReason } = await import("./permission/agent-permission-service");
  expect(readonlyDenyReason("offer_domain_guidance")).toBeNull();
  writeCache("guidance-session", { collaborationModeIds: [] });
  const tool = await createGuidanceTool("guidance-session");
  await tool.execute("offer", { reason: "比较旧方案与重做的取舍。" }, undefined, undefined, {} as never);
  await tool.execute("again", { reason: "同一任务" }, undefined, undefined, {} as never);
  expect(broadcast).toHaveBeenCalledOnce();
  expect(broadcast).toHaveBeenCalledWith("agent:guidance-offer", { sessionId: "guidance-session", reason: "比较旧方案与重做的取舍。" });
  expect(readCache("guidance-session")?.collaborationModeIds).toEqual([]);
  writeCache("guidance-session", { guidanceDeclined: true });
  const restored = await createGuidanceTool("guidance-session");
  await restored.execute("declined", { reason: "不重复邀请" }, undefined, undefined, {} as never);
  expect(broadcast).toHaveBeenCalledOnce();
  broadcast.mockRestore();
});

it("delivers current settings and stacked modes through the real SDK and removes disabled modes next turn", async () => {
  const runtime = await ModelRuntime.create({ modelsPath: null, authPath: path.join(root, "auth.json"), allowModelNetwork: false });
  const faux = fauxProvider({ provider: "conversation-fixture", models: [{ id: "fixture" }], tokensPerSecond: 0 });
  runtime.registerNativeProvider(faux.provider);
  await runtime.refresh({ allowNetwork: false });
  const { getModelRuntime } = await import("./pi-init");
  vi.mocked(getModelRuntime).mockResolvedValue(runtime);
  const manager = await import("./system-prompt-manager");
  const { Store } = await import("./store");
  const { createPiSession } = await import("./pi-session");
  fs.mkdirSync(path.join(root, "agent"));
  let selected = [UI_DESIGN_MODE_ID, DOMAIN_GUIDANCE_MODE_ID];
  const prompts: string[] = [];
  faux.setResponses([0, 1].map(() => context => { prompts.push(getCurrentSystemPrompt(context.messages)); return fauxAssistantMessage("done"); }));
  manager.saveMainChat({ ...DEFAULT_MAIN_CHAT, nickname: "Mori", personality: "PERSONALITY_FIRST" });
  session = await createPiSession({ cwd: root, agentDir: path.join(root, "agent"), store: new Store(root),
    model: runtime.getModel("conversation-fixture", "fixture")!, permissionMode: "standard", canUseTool: async () => ({ behavior: "allow" }),
    systemPrompt: "BASE_SENTINEL\n" + manager.conversationPromptSection([]), getConversationPrompt: () => manager.conversationPromptSection(selected),
  });
  await session.prompt("first");
  expect(prompts[0]).toContain("PERSONALITY_FIRST");
  expect(prompts[0]).toContain("UI 设计模式");
  expect(prompts[0]).toContain("用户已启用领域引导");
  selected = [];
  manager.saveMainChat({ ...DEFAULT_MAIN_CHAT, nickname: "Mori", personality: "PERSONALITY_SECOND" });
  await session.prompt("second");
  expect(prompts[1]).toContain("PERSONALITY_SECOND");
  expect(prompts[1]).not.toContain("PERSONALITY_FIRST");
  expect(prompts[1]).not.toContain("UI 设计模式");
  expect(prompts[1]).not.toContain("用户已启用领域引导");
  expect(prompts[1]).toContain("BASE_SENTINEL");
  expect(prompts[1]?.match(/<easymint_collaboration>/g)).toHaveLength(1);
}, 20_000);
