/** Integration tests against the installed SDK, with explicit temporary paths. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Store } from "./store";
import { NativeConfig } from "./native-config";
import { NativeConfigStorage, atomicWrite, encode } from "./native-config-storage";
import { getProviderStaticModels } from "./pi-init-static";
import { apiKeysFromDisk } from "./em-settings-schema";

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
    // apiKeys 已拆成「能力增强」的结构化位置，旧扁平键不再保留；
    // 断言「组装回来与写入前等价」——保护强度不低于原来那条 toEqual
    expect(em.apiKeys).toBeUndefined();
    expect(em.capabilities.web.apiKey).toBe(old.apiKeys.TAVILY_API_KEY);
    expect(apiKeysFromDisk(em)).toEqual(old.apiKeys);
    expect(em.migration.nativeConfigMigration.duplicateConfigIds).toEqual(["ds-other"]);
    expect(repo.resolveProviderId("ds-active")).toBe("deepseek");
    // 结构迁移与原生迁移各建一个备份目录（commit 按 label 命名）；readdir 顺序 POSIX 未定义，
    // 断言「备份 == 迁移前原文」必须点名结构迁移那一个——否则 Linux 上可能取到原生那份（已是新结构）。
    const backups = fs.readdirSync(path.join(dir, "config-backups"));
    const shapeBackup = backups.find((n) => n.startsWith("em-settings-shape-"));
    expect(shapeBackup, "应存在结构迁移备份").toBeDefined();
    const backupDir = path.join(dir, "config-backups", shapeBackup!);
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

  it("rejects malformed native files without touching them or marking the native step done", async () => {
    const { dir, store, file } = fixture({ apiProviders: { current: custom.id, configs: { [custom.id]: custom } } });
    atomicWrite(file("models"), "{ broken");
    await expect(NativeConfig.create(store)).rejects.toThrow();
    // 原生文件一个字节不动、原生迁移标记不落盘 → 下次启动只重试这一步
    expect(fs.readFileSync(file("models"), "utf8")).toBe("{ broken");
    const em = read(path.join(dir, "em-settings.json"));
    expect(em.migration?.nativeConfigVersion).toBeUndefined();
    // 结构重排是**前一步、独立事务**，它自身完整且幂等，此时已提交；读侧对新旧两种结构都能读，
    // 所以"原生步骤失败"不会让这一步的成果变成坏状态（见 native-config.ts 的 migrate 顺序说明）。
    expect(em.migration?.schemaVersion).toBe(1);
    expect(em.apiProviders).toEqual({ current: custom.id, configs: { [custom.id]: custom } });
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

  it("rejects adding a provider without an API key; re-saving an existing one is not blocked", async () => {
    const { store, file } = fixture();
    const repo = await NativeConfig.create(store);
    // 新增 + 空 key → 拒绝，且不写凭据条目（auth.json 本身在初始化时就会被 SDK 建为空文件）
    const first = repo.view().apiProviders;
    await expect(repo.saveProviders({ ...first, configs: { ...first.configs, [custom.id]: { ...custom, apiKey: "" } } }))
      .rejects.toThrow("缺少 API Key");
    expect(read(file("auth"))[custom.id]).toBeUndefined();
    expect(fs.existsSync(file("models"))).toBe(false);
    // 新增 + 带 key → 成功
    const second = repo.view().apiProviders;
    await repo.saveProviders({ ...second, configs: { ...second.configs, [custom.id]: custom } });
    expect(read(file("auth"))[custom.id]).toEqual({ type: "api_key", key: "test-key" });
    // 编辑态（凭据已在 auth.json）→ 不被拦
    await repo.saveProviders(repo.view().apiProviders);
    expect(read(file("auth"))[custom.id].key).toBe("test-key");
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
