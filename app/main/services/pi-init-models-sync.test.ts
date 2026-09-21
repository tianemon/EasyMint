/** Integration tests against the installed SDK, with explicit temporary paths. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Store } from "./store";
import { NativeConfig } from "./native-config";
import { NativeConfigStorage, atomicWrite, encode } from "./native-config-storage";
import { getProviderStaticModels } from "./pi-init-static";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() } }));
const dirs: string[] = [];
const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
function fixture(em: Record<string, any> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "em-native-config-")); dirs.push(dir);
  const store = new Store(dir);
  atomicWrite(path.join(dir, "em-settings.json"), encode(em));
  return { dir, store, file: (name: string) => path.join(dir, "agent", `${name}.json`) };
}
const custom = {
  id: "custom-local", presetId: "custom", name: "Local", apiKey: "test-key", createdAt: 1,
  baseUrl: "http://localhost:1234/v1", apiType: "openai-completions", model: "test-model",
  models: ["test-model"], extraModels: [{ id: "test-model", name: "Test", contextWindow: 100000, maxTokens: 8000 }],
};
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("pi-native configuration", () => {
  it("migrates credentials, custom models and defaults once, with exact backups and duplicate selection", async () => {
    const id = [...getProviderStaticModels("deepseek").keys()][0]!;
    const builtin = { ...custom, id: "ds-active", presetId: "deepseek", model: id, models: [id], extraModels: [] };
    const old = { setupComplete: true, apiKeys: { TAVILY_API_KEY: "search-test" }, chatThinkingLevel: "high", apiProviders: {
      current: "ds-active", configs: { "ds-other": { ...builtin, id: "ds-other", apiKey: "other-key" }, "ds-active": builtin, [custom.id]: custom },
    } };
    const { dir, store, file } = fixture(old);
    atomicWrite(file("auth"), encode({ "openai-codex": { type: "oauth", access: "test-access", refresh: "test-refresh", expires: 9999999999999 } }));
    const before = fs.readFileSync(path.join(dir, "em-settings.json"), "utf8");
    const repo = await NativeConfig.create(store);
    expect(read(file("auth")).deepseek).toEqual({ type: "api_key", key: "test-key" });
    expect(read(file("auth"))["openai-codex"].refresh).toBe("test-refresh");
    expect(read(file("settings"))).toMatchObject({ defaultProvider: "deepseek", defaultModel: id, defaultThinkingLevel: "high" });
    expect((await repo.getRuntime()).getModel(custom.id, "test-model")?.contextWindow).toBe(100000);
    const em = read(path.join(dir, "em-settings.json"));
    expect(em.apiProviders).toBeUndefined(); expect(em.chatThinkingLevel).toBeUndefined();
    expect(em.apiKeys).toEqual(old.apiKeys);
    expect(em.nativeConfigMigration.duplicateConfigIds).toEqual(["ds-other"]);
    expect(repo.resolveProviderId("ds-active")).toBe("deepseek");
    const backupDir = path.join(dir, "config-backups", fs.readdirSync(path.join(dir, "config-backups"))[0]!);
    expect(fs.readFileSync(path.join(backupDir, "em-settings.json"), "utf8")).toBe(before);
    const snapshot = [file("models"), file("auth"), file("settings")].map(p => fs.readFileSync(p, "utf8"));
    await NativeConfig.create(new Store(dir));
    expect([file("models"), file("auth"), file("settings")].map(p => fs.readFileSync(p, "utf8"))).toEqual(snapshot);
    store.saveSettings({ ...store.getSettings(), lastProjectId: "project" });
    expect(read(path.join(dir, "em-settings.json")).apiProviders).toBeUndefined();
  }, 60000);

  it("reads existing pi files and edits only requested fields, preserving advanced declarations", async () => {
    const { store, file } = fixture();
    const native = { providers: { local: {
      name: "Hand written", api: "openai-completions", baseUrl: "http://localhost:1234/v1", headers: { "X-Test": "keep" },
      models: [{ id: "m", name: "M", contextWindow: 50000, maxTokens: 4000, samplingParams: { temperature: 0.3 }, compat: { supportsDeveloperRole: false } }],
    } } };
    atomicWrite(file("models"), encode(native));
    const repo = await NativeConfig.create(store);
    expect(repo.view().apiProviders.configs.local?.models).toEqual(["m"]);
    const view = repo.view().apiProviders;
    view.configs.local!.extraModels![0] = { ...(view.configs.local!.extraModels![0] as any), contextWindow: 60000 };
    view.current = "local";
    await repo.saveProviders(view);
    expect(read(file("models")).providers.local.models[0]).toMatchObject({ contextWindow: 60000, samplingParams: { temperature: 0.3 }, compat: { supportsDeveloperRole: false } });
    expect(read(file("models")).providers.local.headers).toEqual({ "X-Test": "keep" });
    expect((await repo.getRuntime()).getModel("local", "m")?.contextWindow).toBe(60000);
    const bytes = fs.readFileSync(file("models"), "utf8");
    await repo.saveProviders(repo.view().apiProviders);
    expect(fs.readFileSync(file("models"), "utf8")).toBe(bytes);
  }, 60000);

  it("does not rewrite commented models files on startup, provider selection or default edits", async () => {
    const { store, file } = fixture();
    const modelId = [...getProviderStaticModels("deepseek").keys()][0]!;
    const text = `{\n// retain this comment\n"providers":{"deepseek":{"name":"DS","modelOverrides":{"${modelId}":{"contextWindow":654321}}}}}\n`;
    atomicWrite(file("models"), text);
    const repo = await NativeConfig.create(store);
    expect((await repo.getRuntime()).getModel("deepseek", modelId)?.contextWindow).toBe(654321);
    await repo.setThinkingLevel("high");
    const view = repo.view().apiProviders; view.current = "deepseek";
    await repo.saveProviders(view);
    expect(fs.readFileSync(file("models"), "utf8")).toBe(text);
  }, 60000);

  it("rejects malformed original files without marking migration complete or rewriting originals", async () => {
    const { dir, store, file } = fixture({ apiProviders: { current: custom.id, configs: { [custom.id]: custom } } });
    atomicWrite(file("models"), "{ broken");
    await expect(NativeConfig.create(store)).rejects.toThrow();
    expect(fs.readFileSync(file("models"), "utf8")).toBe("{ broken");
    expect(read(path.join(dir, "em-settings.json")).nativeConfigVersion).toBeUndefined();
  });

  it("rejects invalid model edits and stale saves without changing credentials or disk", async () => {
    const { store, file } = fixture({ apiProviders: { current: custom.id, configs: { [custom.id]: custom } } });
    const repo = await NativeConfig.create(store);
    const view = repo.view().apiProviders;
    (view.configs[custom.id]!.extraModels![0] as any).input = ["invalid"];
    const before = fs.readFileSync(file("models"), "utf8");
    await expect(repo.saveProviders(view)).rejects.toThrow("校验失败");
    expect(fs.readFileSync(file("models"), "utf8")).toBe(before);
    const stale = repo.view().apiProviders;
    await repo.setThinkingLevel("low");
    await expect(repo.saveProviders(stale)).rejects.toThrow("已更新");
  }, 60000);

  it("recovers a partially completed transaction before reading configuration", async () => {
    const { dir } = fixture();
    const target = path.join(dir, "agent", "settings.json");
    atomicWrite(target, encode({ defaultModel: "after" }));
    atomicWrite(path.join(dir, "native-config-transaction.json"), encode({ version: 1, backup: "test", changes: [
      { file: target, before: encode({ defaultModel: "before" }), after: encode({ defaultModel: "after" }) },
    ] }));
    await new NativeConfigStorage(dir).initialize();
    expect(read(target).defaultModel).toBe("before");
    expect(fs.existsSync(path.join(dir, "native-config-transaction.json"))).toBe(false);
  });

  it("does not overwrite an independent edit when recovering", async () => {
    const { dir } = fixture(); const target = path.join(dir, "agent", "settings.json");
    atomicWrite(target, encode({ defaultModel: "external" }));
    atomicWrite(path.join(dir, "native-config-transaction.json"), encode({ version: 1, backup: "test", changes: [
      { file: target, before: "{}", after: encode({ defaultModel: "after" }) },
    ] }));
    const storage = new NativeConfigStorage(dir);
    await expect(storage.initialize()).rejects.toThrow("外部修改");
    await expect(storage.commit(new Map([[target, {}]]), "new-edit")).rejects.toThrow("未完成");
    expect(read(target).defaultModel).toBe("external");
  });
  it("rolls back earlier credential writes when a later file write fails", async () => {
    const { dir, file } = fixture();
    const storage = new NativeConfigStorage(dir); await storage.initialize();
    atomicWrite(file("settings"), encode({ defaultModel: "before" }));
    const rename = fs.renameSync;
    let failOnce = true;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (to === file("settings") && failOnce) { failOnce = false; throw new Error("simulated write failure"); }
      return rename(from, to);
    });
    await expect(storage.commit(new Map([
      [file("auth"), { test: { type: "api_key", key: "new-key" } }],
      [file("settings"), { defaultModel: "after" }],
    ]), "failure-test")).rejects.toThrow("simulated write failure");
    expect(fs.existsSync(file("auth"))).toBe(false);
    expect(read(file("settings"))).toEqual({ defaultModel: "before" });
    expect(fs.existsSync(path.join(dir, "native-config-transaction.json"))).toBe(false);
  });

  it("refuses newer migration versions and preserves the original", async () => {
    const { dir, store } = fixture({ nativeConfigVersion: 2, future: "keep" });
    await expect(NativeConfig.create(store)).rejects.toThrow("更新版本");
    expect(read(path.join(dir, "em-settings.json"))).toEqual({ nativeConfigVersion: 2, future: "keep" });
  });

  it("keeps runtime identity after editing and rejects an old editor even with a fresh list revision", async () => {
    const { store } = fixture({ apiProviders: { current: custom.id, configs: { [custom.id]: custom } } });
    const repo = await NativeConfig.create(store);
    const runtime = await repo.getRuntime();
    const oldEditor = repo.view().apiProviders.configs[custom.id]!;
    await repo.setThinkingLevel("high");
    expect(await repo.getRuntime()).toBe(runtime);
    const fresh = repo.view().apiProviders;
    fresh.configs[custom.id] = { ...oldEditor, name: "Stale edit" };
    await expect(repo.saveProviders(fresh)).rejects.toThrow("编辑期间已更新");
  }, 60000);

  it("persists a selected model as the pi-native default", async () => {
    const { store, file } = fixture({ apiProviders: { current: custom.id, configs: { [custom.id]: custom } } });
    const repo = await NativeConfig.create(store);
    const view = repo.view().apiProviders;
    const second = { id: "second-model", name: "Second", contextWindow: 64000, maxTokens: 8000 };
    view.configs[custom.id]!.extraModels = [...(view.configs[custom.id]!.extraModels ?? []), second];
    await repo.saveProviders(view);
    await repo.setDefaultModel(second.id);
    expect(read(file("settings"))).toMatchObject({ defaultProvider: custom.id, defaultModel: second.id });
    expect(repo.view().model).toBe(second.id);
  }, 60000);

});
