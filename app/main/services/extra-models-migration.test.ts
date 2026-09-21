/** Legacy model identities/parameters survive the one-time move to native files. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Store } from "./store";
import { NativeConfig } from "./native-config";
import { atomicWrite, encode } from "./native-config-storage";
import { getProviderStaticModels } from "./pi-init-static";
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() } }));
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
describe("legacy model migration", () => {
  it("keeps request aliases, explicit limits and custom defaults; does not activate dormant official overrides", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "em-model-migration-")); dirs.push(dir);
    const store = new Store(dir);
    const nativeModel = [...getProviderStaticModels("deepseek").keys()][0]!;
    atomicWrite(path.join(dir, "em-settings.json"), encode({ apiProviders: { current: "ds-old", configs: {
      "ds-old": { id: "ds-old", presetId: "deepseek", name: "DS", apiKey: "test", model: nativeModel,
        models: [nativeModel], createdAt: 1, extraModels: [{ id: "Display", alias: "request-id", contextWindow: 512000, maxTokens: 32000, samplingParams: { temperature: 0.4 } }],
        modelOverrides: { [nativeModel]: { contextWindow: 1 } } },
      local: { id: "local", presetId: "custom", name: "Local", apiKey: "test", model: "bar-id", createdAt: 2,
        baseUrl: "http://localhost:1234/v1", apiType: "openai-completions", models: ["bar-id", "other"],
        extraModels: [{ id: "Bar", alias: "bar-id", contextWindow: 1000000, maxTokens: 128000 }] },
    } } }));
    atomicWrite(path.join(dir, "session-cache", "old-session.json"), encode({ provider: "ds-old", model: nativeModel, permissionMode: "readonly", other: "keep" }));
    const repo = await NativeConfig.create(store);
    const rt = await repo.getRuntime();
    expect(rt.getModel("deepseek", "request-id")).toMatchObject({ name: "Display", contextWindow: 512000, maxTokens: 32000 });
    expect(JSON.parse(fs.readFileSync(repo.files.models, "utf8")).providers.deepseek.models[0].samplingParams).toEqual({ temperature: 0.4 });
    expect(rt.getModel("local", "bar-id")).toMatchObject({ name: "Bar", contextWindow: 1000000, maxTokens: 128000 });
    expect(rt.getModel("local", "other")?.contextWindow).toBe(200000);
    expect(rt.getModel("deepseek", nativeModel)?.contextWindow).not.toBe(1);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "session-cache", "old-session.json"), "utf8"))).toMatchObject({ provider: "deepseek", permissionMode: "readonly", other: "keep" });
    const data = repo.view().apiProviders;
    (data.configs.deepseek!.extraModels![0] as any).contextWindow = 200000;
    await repo.saveProviders(data);
    expect((await repo.getRuntime()).getModel("deepseek", "request-id")?.contextWindow).toBe(200000);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "em-settings.json"), "utf8")).apiProviders).toBeUndefined();
  }, 60000);
});
