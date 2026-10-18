import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSession, type ToolDefinition, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configureAutoModelRouting } from "./auto-model-routing";
import { createImageGenerationTool } from "./tools/image-generation-tool";
import { Store } from "./store";

const imageApi = vi.hoisted(() => ({ getModelOfType: vi.fn(() => ({ input: ["text", "image"] })), generateImages: vi.fn() }));
vi.mock("./pi-init", () => ({ getModelRuntime: async () => imageApi }));
const roots: string[] = [], sessions: AgentSession[] = [];
afterEach(() => { for (const session of sessions.splice(0)) session.dispose(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

async function setup(extensionFactories: InlineExtension[] = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-native-ai-session-")); roots.push(root);
  const runtime = await ModelRuntime.create({ modelsPath: null, authPath: path.join(root, "auth.json"), allowModelNetwork: false });
  const faux = fauxProvider({ provider: "fixture", models: ["strong", "fast"].map(id => ({ id, reasoning: true, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })), tokensPerSecond: 0 });
  runtime.registerNativeProvider(faux.provider);
  await runtime.refresh({ allowNetwork: false });
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, cacheWarming: "off" });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager: settings, noExtensions: true, extensionFactories });
  await loader.reload();
  const create = async (modelId: string, tool: ToolDefinition) => {
    const { session } = await createAgentSession({ cwd: root, agentDir: root, modelRuntime: runtime,
      model: runtime.getModel("fixture", modelId), resourceLoader: loader, sessionManager: SessionManager.inMemory(root),
      settingsManager: settings, noTools: "builtin", customTools: [tool] });
    if (extensionFactories.length) await session.bindExtensions({ mode: "rpc" });
    sessions.push(session); return session;
  };
  return { root, runtime, faux, create, loader, settings };
}

describe("native AI full SDK pipeline", () => {
  it("uses official before-start semantics for user and system-triggered runs", async () => {
    const starts: Array<{ type: string; idle: boolean }> = [];
    const { faux, create } = await setup([{ name: "upgrade-starts", factory: pi => {
      pi.on("before_agent_start", (event, ctx) => { starts.push({ type: event.messageType, idle: ctx.isIdle() }); });
    } }]);
    faux.setResponses([fauxAssistantMessage("user response"), fauxAssistantMessage("system response")]);
    const session = await create("strong", { name: "noop", label: "Noop", description: "Fixture", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [], details: undefined }) });
    await session.prompt("first");
    await session.sendCustomMessage({ customType: "delegation", content: "worker done", display: false }, { triggerTurn: true });
    expect(starts).toEqual([{ type: "user", idle: false }, { type: "custom", idle: false }]);
    expect(faux.state.callCount).toBe(2);
    expect(session.isIdle).toBe(true);
  });

  it("cancels a custom run while its before-start handler is pending without calling the model", async () => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { faux, create } = await setup([{ name: "upgrade-cancel", factory: pi => {
      pi.on("before_agent_start", async () => { enter(); await gate; });
    } }]);
    faux.setResponses([fauxAssistantMessage("must not be requested")]);
    const session = await create("strong", { name: "noop", label: "Noop", description: "Fixture", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [], details: undefined }) });
    const running = session.sendCustomMessage({ customType: "shell", content: "done", display: false }, { triggerTurn: true });
    await entered;
    expect(session.isIdle).toBe(false);
    const stopping = session.abort(); release();
    await Promise.allSettled([running, stopping]);
    expect(faux.state.callCount).toBe(0);
    expect(session.isIdle).toBe(true);
  });

  it("keeps official explicit-loadout resume semantics instead of restoring deferred historical tools", async () => {
    const { root, runtime, faux, create, loader, settings } = await setup();
    const tool: ToolDefinition = { name: "historical", label: "Historical", description: "Fixture", exposure: "deferred",
      parameters: { type: "object", properties: {} }, execute: async () => ({ content: [], details: undefined }) };
    const first = await create("strong", tool);
    first.setActiveToolsByName(["historical"]);
    faux.setResponses([fauxAssistantMessage("saved")]); await first.prompt("remember tool");
    const { session: resumed } = await createAgentSession({ cwd: root, agentDir: root, modelRuntime: runtime,
      resourceLoader: loader, settingsManager: settings, sessionManager: first.sessionManager, noTools: "builtin", customTools: [tool] });
    sessions.push(resumed);
    expect(resumed.getAllTools().some(tool => tool.name === "historical")).toBe(true);
    expect(resumed.getActiveToolNames()).not.toContain("historical");
  });

  it("replays old Kimi thinking/tool messages through the official Chat Completions endpoint", async () => {
    const { runtime } = await setup();
    const model = runtime.getModel("kimi-coding", "k3")!;
    expect(model).toMatchObject({ api: "openai-completions", baseUrl: "https://api.kimi.com/coding/v1" });
    const old = { ...fauxAssistantMessage([fauxThinking("earlier reasoning"), fauxToolCall("lookup", {}, { id: "prior-call" })], { stopReason: "toolUse" }),
      api: "anthropic-messages", provider: "kimi-coding", model: "k3" };
    const context = { messages: [
      { role: "user" as const, content: "continue", timestamp: Date.now() }, old,
      { role: "toolResult" as const, toolCallId: "prior-call", toolName: "lookup", content: [{ type: "text" as const, text: "found" }], isError: false, timestamp: Date.now() },
    ], tools: [{ name: "lookup", description: "Lookup", parameters: { type: "object" as const, properties: {} } }] };
    const requests: Array<{ url: string; body: any }> = [];
    const fetchFixture: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push({ url: request.url, body: JSON.parse(await request.text()) });
      const chunk = (delta: object, finish_reason: string | null) => "data: " + JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "k3", choices: [{ index: 0, delta, finish_reason }] }) + "\n\n";
      return new Response(chunk({ role: "assistant", content: "ok" }, null) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    };
    const result = await runtime.streamSimple(model, context, { apiKey: "fixture", fetch: fetchFixture }).result();
    expect(result.stopReason).toBe("stop");
    expect(requests[0].url).toBe("https://api.kimi.com/coding/v1/chat/completions");
    expect(requests[0].body.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", tool_calls: expect.arrayContaining([expect.objectContaining({ id: "prior-call" })]) }),
      expect.objectContaining({ role: "tool", tool_call_id: "prior-call", content: "found" }),
    ]));
    await runtime.streamSimple(model, { ...context, tools: [...context.tools, { name: "later", description: "Added later", parameters: { type: "object", properties: {} } }] }, { apiKey: "fixture", fetch: fetchFixture }).result();
    expect(requests[1].body.tools.map((tool: any) => tool.function.name)).toEqual(["lookup", "later"]);
  });

  it("records routed physical replies and branch state, then resets for a new user turn", async () => {
    const { runtime, faux, create } = await setup();
    configureAutoModelRouting(runtime, { autoRouting: { planning: { provider: "fixture", model: "strong" }, execution: { provider: "fixture", model: "fast" } } });
    faux.setResponses([fauxAssistantMessage(fauxToolCall("write", {}), { stopReason: "toolUse" }), fauxAssistantMessage("done"), fauxAssistantMessage("new turn")]);
    const session = await create("easymint-auto", { name: "write", label: "Write", description: "Fixture", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "edited" }], details: undefined }) });
    await session.prompt("build");
    expect(session.messages.filter(message => message.role === "assistant").map(message => message.model)).toEqual(["strong", "fast"]);
    expect(session.sessionManager.getBranch().some(entry => entry.type === "custom" && entry.customType === "pi.virtual-model-state")).toBe(true);
    await session.prompt("next task");
    expect(session.messages.filter(message => message.role === "assistant").at(-1)?.model).toBe("strong");
    expect(session.model?.id).toBe("easymint-auto");
  });
  it("persists image-tool usage once and includes it in native session cost", async () => {
    const { root, faux, create } = await setup();
    const store = new Store(path.join(root, "settings"));
    store.saveSettings({ ...store.getSettings(), nativeAi: { imageModel: { provider: "image-provider", model: "image" } } });
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
    imageApi.generateImages.mockResolvedValue({ provider: "image-provider", model: "image", output: [{ type: "image", mimeType: "image/png", data: png }], stopReason: "stop", usage: {
      input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0.04, cacheRead: 0, cacheWrite: 0, total: 0.04 },
    } });
    faux.setResponses([fauxAssistantMessage(fauxToolCall("generate_image", { prompt: "draw", output_path: "asset" }), { stopReason: "toolUse" }), fauxAssistantMessage("saved")]);
    const session = await create("strong", createImageGenerationTool(root, store, async () => ({ behavior: "allow" })));
    await session.prompt("draw an image");
    expect(fs.existsSync(path.join(root, "asset.png"))).toBe(true);
    expect(session.getSessionStats().cost).toBeCloseTo(0.04);
    const results = session.messages.filter(message => message.role === "toolResult" && message.toolName === "generate_image");
    expect(results).toHaveLength(1);
    const result = results[0];
    if (result?.role !== "toolResult") throw new Error("Missing persisted image result");
    expect(result.usage?.cost.total).toBe(0.04);
  });
});
