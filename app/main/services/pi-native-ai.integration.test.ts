import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSession, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configureAutoModelRouting } from "./auto-model-routing";
import { createImageGenerationTool } from "./tools/image-generation-tool";
import { Store } from "./store";

const imageApi = vi.hoisted(() => ({ getModelOfType: vi.fn(() => ({ input: ["text", "image"] })), generateImages: vi.fn() }));
vi.mock("./pi-init", () => ({ getModelRuntime: async () => imageApi }));
const roots: string[] = [], sessions: AgentSession[] = [];
afterEach(() => { for (const session of sessions.splice(0)) session.dispose(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-native-ai-session-")); roots.push(root);
  const runtime = await ModelRuntime.create({ modelsPath: null, authPath: path.join(root, "auth.json"), allowModelNetwork: false });
  const faux = fauxProvider({ provider: "fixture", models: ["strong", "fast"].map(id => ({ id, reasoning: true, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })), tokensPerSecond: 0 });
  runtime.registerNativeProvider(faux.provider);
  await runtime.refresh({ allowNetwork: false });
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, cacheWarming: "off" });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager: settings, noExtensions: true });
  await loader.reload();
  const create = async (modelId: string, tool: ToolDefinition) => {
    const { session } = await createAgentSession({ cwd: root, agentDir: root, modelRuntime: runtime,
      model: runtime.getModel("fixture", modelId), resourceLoader: loader, sessionManager: SessionManager.inMemory(root),
      settingsManager: settings, noTools: "builtin", customTools: [tool] });
    sessions.push(session); return session;
  };
  return { root, runtime, faux, create };
}

describe("native AI full SDK pipeline", () => {
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
