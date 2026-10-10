import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ModelRuntime, type ModelRouteRequest } from "@earendil-works/pi-coding-agent";
import { autoModelRoute, configureAutoModelRouting } from "./auto-model-routing";
import { AUTO_MODEL_ID } from "../../shared/native-ai";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const config = { planning: { provider: "fixture", model: "strong" }, execution: { provider: "fixture", model: "fast" } };
async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-routing-")); roots.push(root);
  fs.writeFileSync(path.join(root, "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: "http://example.invalid", apiKey: "fixture", models: [
    { id: "strong", name: "Strong", contextWindow: 10000, maxTokens: 2000, input: ["text", "image"], reasoning: true },
    { id: "fast", name: "Fast", contextWindow: 10000, maxTokens: 2000, input: ["text"], reasoning: true },
  ] } } }));
  const runtime = await ModelRuntime.create({ modelsPath: path.join(root, "models.json"), authPath: path.join(root, "auth.json"), allowModelNetwork: false });
  configureAutoModelRouting(runtime, { autoRouting: config });
  return runtime;
}
function request(runtime: ModelRuntime, extra: Partial<ModelRouteRequest> = {}): ModelRouteRequest {
  return { model: runtime.getModel("fixture", AUTO_MODEL_ID)!, thinkingLevel: "medium", reason: "user", messages: [], ...extra };
}

describe("native automatic model routing", () => {
  it("registers a selectable virtual model, routes through SDK auth, and removes it when disabled", async () => {
    const runtime = await setup();
    const virtual = runtime.getModel("fixture", AUTO_MODEL_ID)!;
    expect(virtual.api).toBe("pi-virtual");
    const route = await runtime.resolveModel(virtual, [], { reason: "user", thinkingLevel: "medium" });
    expect(route.model.id).toBe("strong");
    configureAutoModelRouting(runtime, {});
    expect(runtime.getModel("fixture", AUTO_MODEL_ID)).toBeUndefined();
  });
  it("does not replace an unchanged virtual model when another capability is saved", async () => {
    const runtime = await setup();
    const before = runtime.getModel("fixture", AUTO_MODEL_ID);
    configureAutoModelRouting(runtime, { autoRouting: config, imageModel: { provider: "image", model: "image" } });
    expect(runtime.getModel("fixture", AUTO_MODEL_ID)).toBe(before);
  });
  it("advertises image input when only the execution model supports images", async () => {
    const runtime = await setup();
    const reversed = { planning: config.execution, execution: config.planning };
    configureAutoModelRouting(runtime, { autoRouting: reversed });
    expect(runtime.getModel("fixture", AUTO_MODEL_ID)?.input).toContain("image");
    const imageRequest = request(runtime, { messages: [{ role: "user", timestamp: 1, content: [{ type: "image", data: "image", mimeType: "image/png" }] }] });
    expect(autoModelRoute(runtime, reversed, imageRequest).model.id).toBe("strong");
  });
  it("changes only after a successful edit, stays in execution, and resets on a user request", async () => {
    const runtime = await setup();
    const tool = { role: "toolResult" as const, toolName: "edit", toolCallId: "edit", content: [{ type: "text" as const, text: "ok" }], isError: false, timestamp: 1 };
    expect(autoModelRoute(runtime, config, request(runtime, { reason: "continuation", messages: [{ ...tool, isError: true }] })).model.id).toBe("strong");
    const result = autoModelRoute(runtime, config, request(runtime, { reason: "continuation", messages: [tool] }));
    expect(result.model.id).toBe("fast");
    expect(autoModelRoute(runtime, config, request(runtime, { reason: "continuation", state: result.state })).model.id).toBe("fast");
    expect(autoModelRoute(runtime, config, request(runtime, { reason: "user", state: result.state })).model.id).toBe("strong");
    expect(autoModelRoute(runtime, config, request(runtime, { reason: "continuation", messages: [{ ...tool, toolName: "codemode", nestedCalls: { complete: true, calls: [{ id: "nested", name: "write", status: "ok" }] } }] })).model.id).toBe("fast");
  });
  it("keeps retries on their physical model and preserves image input", async () => {
    const runtime = await setup();
    const fast = runtime.getModel("fixture", "fast")!;
    expect(autoModelRoute(runtime, config, request(runtime, { reason: "retry", failed: { model: fast, thinkingLevel: "low", message: {} as never } })).model.id).toBe("fast");
    const withImage = request(runtime, { reason: "continuation", state: { phase: "execution" }, messages: [{ role: "user", timestamp: 1, content: [{ type: "image", data: "image", mimeType: "image/png" }] }] });
    expect(autoModelRoute(runtime, config, withImage).model.id).toBe("strong");
    expect(autoModelRoute(runtime, config, { ...withImage, reason: "direct", previous: { model: fast } }).model.id).toBe("strong");
    const foreign = { ...fast, provider: "previous-provider", id: "previous-model" };
    expect(autoModelRoute(runtime, config, request(runtime, { reason: "direct", previous: { model: foreign } })).model.id).toBe("strong");
    expect(() => autoModelRoute(runtime, { ...config, execution: { provider: "fixture", model: "missing" } }, request(runtime, { reason: "continuation", state: { phase: "execution" } }))).toThrow("unavailable");
  });
});
