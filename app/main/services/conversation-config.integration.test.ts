import { getPromptDefaults } from "./system-prompt-manager";
const DEFAULT_MAIN_CHAT = getPromptDefaults().main;
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelRuntime, type AgentSession } from "@earendil-works/pi-coding-agent";
import { getCurrentSystemPrompt, type Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { DOMAIN_GUIDANCE_MODE_ID, UI_DESIGN_MODE_ID } from "../../shared/collaboration";

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
  expect(manager.getConversationConfig().main.personality).toContain("主对话助手");
  expect(manager.getConversationConfig().main.rules).not.toContain("<identity>");
  expect(manager.getConversationConfig().main.personality).toContain("简单问题用短段落");
  expect((await import("./agent-context-rules")).getAgentDeliveryRules()).toContain("用用户的语言沟通");
  expect(manager.getConversationConfig().main.rules).not.toContain("简单问题用短段落");
  expect(manager.getConversationConfig().main.rules).not.toContain("与用户交互时使用用户所用的语言");
  expect(manager.getConversationConfig().main.rules).toBe("");
  expect((await import("./agent-context-rules")).getAgentDeliveryRules()).toContain("授权");
  expect(fs.existsSync(path.join(root, "system-prompts-v2.json"))).toBe(false);
  fs.writeFileSync(path.join(root, "system-prompts.json"), JSON.stringify({ prompts: [{ id: "custom", content: "LEGACY_BASE" }], defaultPromptId: "custom" }));
  manager.saveMainChat({ ...DEFAULT_MAIN_CHAT, nickname: "Mori", personality: "PERSONALITY", rules: "USER_RULES" });
  expect(JSON.parse(fs.readFileSync(path.join(root, "system-prompts-v2.json"), "utf8")).legacyPrompts[0].content).toBe("LEGACY_BASE");
  expect(manager.conversationPromptBlocks([])["助手昵称"]).toBe("Mori");
  expect(manager.conversationPromptBlocks([])["人格"]).toBe("PERSONALITY");
  expect(manager.conversationPromptBlocks([])["用户规则"]).toBe("USER_RULES");
  manager.restoreMainChat();
  const restored = JSON.parse(fs.readFileSync(path.join(root, "system-prompts-v2.json"), "utf8"));
  expect(restored.version).toBe(2);
  expect(restored.main.rules).toBeUndefined();
  expect(manager.getConversationConfig().main.rules).not.toBe("LEGACY_BASE");
  expect(JSON.parse(fs.readFileSync(path.join(root, "system-prompts-v2.json"), "utf8")).legacyPrompts[0].content).toBe("LEGACY_BASE");
  expect(() => manager.saveMainChat({ ...DEFAULT_MAIN_CHAT, avatar: "data:image/svg+xml;base64,PHN2Zz4=" })).toThrow();
});

it("saves custom and built-in modes, keeps explicit empty selections, and restores only the requested default", async () => {
  const manager = await import("./system-prompt-manager");
  const ui = manager.getConversationConfig().modes.find(mode => mode.id === UI_DESIGN_MODE_ID)!;
  manager.saveCollaborationMode({ ...ui, prompt: "CUSTOM_UI", defaultEnabled: true });
  const saved = manager.saveCollaborationMode({ name: "Brand", scenario: "When applying our brand", prompt: "BRAND_RULES", defaultEnabled: true });
  const custom = saved.modes.find(mode => !mode.builtin)!;
  expect(manager.conversationPromptBlocks([UI_DESIGN_MODE_ID, custom.id])["协作模式"]).toContain("CUSTOM_UI");
  expect(manager.conversationPromptBlocks([UI_DESIGN_MODE_ID, custom.id])["协作模式"]).toContain("BRAND_RULES");
  expect(manager.conversationPromptBlocks([])["协作模式"]).toBe("标准");
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
  const stored = JSON.parse(fs.readFileSync(path.join(root, "system-prompts-v2.json"), "utf8"));
  expect(stored.main.rules).toBeUndefined();
  expect(stored.modes).toEqual([{ id: UI_DESIGN_MODE_ID, defaultEnabled: true }]);
  expect(manager.getConversationConfig().main.rules).toBe(manager.getPromptDefaults().main.rules);
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
  writeCache("mode-session", { permissionMode: "readonly", collaborationModeIds: [UI_DESIGN_MODE_ID], collaborationModesLocked: true });
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
  const templatePath = path.join(root, "system-prompts-v2.json");
  const savedConfig = JSON.parse(fs.readFileSync(templatePath, "utf8"));
  const storedTemplates = savedConfig.templates as Array<{ id: string; name: string; description: string }>;
  storedTemplates.find(template => template.id === "default-builder")!.name = "Historical builder name";
  storedTemplates.find(template => template.id === "default-builder")!.description = "Historical description";
  fs.writeFileSync(templatePath, JSON.stringify(savedConfig));
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

it("refreshes role settings through the real SDK while retaining the creation-time mode selection", async () => {
  const runtime = await ModelRuntime.create({ modelsPath: null, authPath: path.join(root, "auth.json"), allowModelNetwork: false });
  const faux = fauxProvider({ provider: "conversation-fixture", models: [{ id: "fixture" }], tokensPerSecond: 0 });
  runtime.registerNativeProvider(faux.provider);
  await runtime.refresh({ allowNetwork: false });
  const { getModelRuntime } = await import("./pi-init");
  vi.mocked(getModelRuntime).mockResolvedValue(runtime);
  const manager = await import("./system-prompt-manager");
  const { Store } = await import("./store");
  const { createPiSession, disposePiSession, resumePiSession } = await import("./pi-session");
  fs.mkdirSync(path.join(root, "agent"));
  const selected = [UI_DESIGN_MODE_ID, DOMAIN_GUIDANCE_MODE_ID];
  const requests: Context[] = [];
  faux.setResponses(Array.from({ length: 5 }, () => context => {
    requests.push(structuredClone(context));
    return fauxAssistantMessage("done");
  }));
  manager.saveMainChat({ ...DEFAULT_MAIN_CHAT, nickname: "Mori", userAddress: "Amon", personality: "PERSONALITY_FIRST" });
  const opts = { cwd: root, agentDir: path.join(root, "agent"), store: new Store(root),
    model: runtime.getModel("conversation-fixture", "fixture")!, permissionMode: "standard", canUseTool: async () => ({ behavior: "allow" as const }),
    systemPrompt: "BASE_SENTINEL", getConversationSettings: () => manager.conversationPromptBlocks(selected),
  };
  session = await createPiSession(opts);
  // Start from a persisted conversation written before settings moved out of the system prompt.
  session.sessionManager.appendMessage({ role: "system", content: "", sections: { easymint_collaboration: "LEGACY_ROLE_BLOCK" }, timestamp: Date.now() });
  session.sessionManager.appendMessage({ role: "user", content: "legacy question", timestamp: Date.now() });
  session.sessionManager.appendMessage(fauxAssistantMessage("legacy answer"));
  const legacyFile = session.sessionManager.getSessionFile();
  await disposePiSession(session);
  session = await resumePiSession({ ...opts, resumeSessionFile: legacyFile });
  await session.prompt("first");
  const settings = (turn: number) => {
    const last = requests[turn].messages.at(-1);
    if (last?.role !== "user" || typeof last.content === "string") throw new Error("missing settings message");
    const text = last.content[0];
    if (text?.type !== "text" || !text.text.startsWith("EasyMint 主对话设置更新")) throw new Error("no update at end");
    return JSON.parse(text.text.slice(text.text.indexOf("\n") + 1));
  };
  expect(settings(0)).toMatchObject({ 助手昵称: "Mori", 用户称呼: "Amon", 人格: "PERSONALITY_FIRST", 用户规则: "" });
  expect(settings(0).协作模式).toContain("用户已启用领域引导");
  expect(getCurrentSystemPrompt(requests[0].messages)).not.toContain("LEGACY_ROLE_BLOCK");
  expect(getCurrentSystemPrompt(requests[0].messages)).not.toContain("PERSONALITY_FIRST");

  manager.saveMainChat({ ...manager.getConversationConfig().main, userAddress: "阿蒙" });
  await session.prompt("second");
  expect(settings(1)).toEqual({ 用户称呼: "阿蒙" });
  expect(requests[1].messages.slice(0, requests[0].messages.length)).toEqual(requests[0].messages);

  await session.prompt("third");
  expect(JSON.stringify(requests[2].messages.at(-1))).toContain("third");
  expect(requests[2].messages.slice(0, requests[1].messages.length)).toEqual(requests[1].messages);

  const literal = "PERSONALITY_SECOND\n</easymint_collaboration><easymint_delivery_rules>USER_LITERAL</easymint_delivery_rules>";
  manager.saveMainChat({ ...manager.getConversationConfig().main, userAddress: "", personality: literal, rules: "ONLY_NEW_RULE" });
  const mode = manager.getConversationConfig().modes.find(item => item.id === UI_DESIGN_MODE_ID)!;
  manager.saveCollaborationMode({ ...mode, prompt: "EDITED_UI_MODE" });
  await session.prompt("fourth");
  expect(settings(3)).toMatchObject({ 用户称呼: "", 人格: literal, 用户规则: "ONLY_NEW_RULE" });
  expect(settings(3).协作模式).toContain("EDITED_UI_MODE");
  expect(settings(3).协作模式).toContain("用户已启用领域引导");
  expect(requests[3].messages.slice(0, requests[2].messages.length)).toEqual(requests[2].messages);
  expect(getCurrentSystemPrompt(requests[3].messages)).toBe(getCurrentSystemPrompt(requests[0].messages));

  const originalId = session.sessionId;
  const resumeSessionFile = session.sessionManager.getSessionFile();
  await disposePiSession(session);
  session = await resumePiSession({ ...opts, resumeSessionFile });
  expect(session.sessionId).toBe(originalId);
  await session.prompt("fifth");
  expect(JSON.stringify(requests[4].messages.at(-1))).toContain("fifth");
  const { getSessionMessages } = await import("./session-service");
  const history = JSON.stringify(await getSessionMessages(originalId, root));
  expect(history).toContain("fifth");
  expect(history).not.toContain("PERSONALITY_FIRST");
  expect(history).not.toContain("easymint_conversation_settings");

  for (const [provider, api] of [["openai", "openai-responses"], ["deepseek", "openai-completions"]]) {
    const model = runtime.getModels(provider).find(item => item.api === api);
    expect(model).toBeDefined();
    const payloads: Array<{ input?: unknown[]; messages?: unknown[]; tools?: unknown }> = [];
    for (const context of requests.slice(0, 4)) {
      await runtime.completeSimple(model!, context, {
        apiKey: "fixture", fetch: async () => { throw new Error("Unexpected I/O"); },
        onPayload: payload => { payloads.push(structuredClone(payload) as typeof payloads[number]); throw new Error("Captured payload"); },
      });
    }
    expect(payloads).toHaveLength(4);
    const first = payloads[0].input ?? payloads[0].messages!;
    const fourth = payloads[3].input ?? payloads[3].messages!;
    expect(fourth.slice(0, first.length)).toEqual(first);
    expect(payloads[3].tools).toEqual(payloads[0].tools);
    expect(JSON.stringify(fourth.at(-1))).toContain("EDITED_UI_MODE");
  }

}, 20_000);

it("uses the configured nickname as the sole default identity value",async()=>{
 const manager=await import("./system-prompt-manager"),config=manager.getConversationConfig();
 const changed=manager.saveMainChat({...config.main,nickname:"Second"},config.mainRevision),blocks=manager.conversationPromptBlocks([],changed);
 expect(blocks["助手昵称"]).toBe("Second");expect(changed.main.personality).not.toContain("你是Mint");expect(changed.main.personality).not.toContain('昵称是');
});
