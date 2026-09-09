/**
 * 模型参数统一管理·数据层（迁移 + models.json 写入 + 生效模型）。
 *
 * 真跑一遍 Pi SDK 的 ModelRuntime:验证 models.json 的 models[] 被 SDK 接受且生效
 * （别名映射、取消近似匹配后的回落值、官方同名模型以 SDK 为准）。
 * 用临时 HOME + 临时 PI_CODING_AGENT_DIR 隔离，不碰用户真实数据。
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() } }));

let dataDir = "";
beforeAll(() => {
  const home = mkdtempSync(path.join(os.tmpdir(), "em-model-params-"));
  process.env.HOME = home;
  process.env.PI_CODING_AGENT_DIR = path.join(home, ".easymint", "agent");
  dataDir = path.join(home, ".easymint");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, "em-settings.json"), JSON.stringify({
    defaultProjectDir: "~/Desktop",
    apiProviders: {
      current: "deepseek-1",
      configs: {
        "deepseek-1": {
          id: "deepseek-1", presetId: "deepseek", name: "DeepSeek", apiKey: "sk-test",
          model: "deepseek-v4-flash", models: ["deepseek-v4-flash", "deepseek-v4-pro"], createdAt: 1,
          // 存量数据:纯字符串条目 / 缺参对象条目 / 带别名条目
          extraModels: ["deepseek-v4-flash-x", { id: "glm-5.3-x" }, { id: "foo", alias: "foo-x", contextWindow: 512000, maxTokens: 32768 }],
          // 官方模型参数覆盖(空对象 = 全跟随官方,应跳过不写)
          modelOverrides: { "deepseek-v4-flash": { contextWindow: 512000 }, "deepseek-v4-pro": {} },
        },
        "custom-1": {
          id: "custom-1", presetId: "custom", name: "网关", apiKey: "sk-test",
          baseUrl: "https://gw.example.com/v1", apiType: "anthropic-messages",
          model: "bar-x", models: ["bar-x", "baz-y"], createdAt: 1,
          extraModels: [{ id: "bar", alias: "bar-x", contextWindow: 1000000, maxTokens: 384000 }],
        },
        // 只有官方模型参数覆盖、无手动模型的供应商
        "anthropic-1": {
          id: "anthropic-1", presetId: "anthropic", name: "Anthropic", apiKey: "sk-test",
          model: "claude-opus-4-6", models: ["claude-opus-4-6"], createdAt: 1,
          modelOverrides: { "claude-opus-4-6": { maxTokens: 64000 } },
        },
      },
    },
  }, null, 2));
});

describe("模型参数统一管理·数据层", () => {
  it("存量迁移 / 参数覆盖 / 别名映射 / 取消近似匹配", async () => {
    const { Store } = await import("./store");
    const { migrateExtraModels } = await import("./extra-models-migration");
    const { getModelRuntime, resetModelRuntime } = await import("./pi-init");
    const store = new Store(dataDir);

    // ① 迁移:存量条目显式化,已声明字段不被改写
    expect(migrateExtraModels(store)).toBe(true);
    const extras = store.getSettings().apiProviders!.configs!["deepseek-1"]!.extraModels as unknown as Array<Record<string, unknown>>;
    expect(extras[0]).toMatchObject({ id: "deepseek-v4-flash-x" });
    expect(extras[0]!.contextWindow).toBeGreaterThan(200000); // 旧版推断的生效窗口被保留
    expect(extras[1]).toMatchObject({ id: "glm-5.3-x" });
    expect(typeof extras[1]!.maxTokens).toBe("number");
    expect(extras[2]).toMatchObject({ id: "foo", alias: "foo-x", contextWindow: 512000, maxTokens: 32768 });
    // 一次性标记:再次调用不再迁移
    expect(migrateExtraModels(store)).toBe(false);

    // ② 升级后新增的模型(旧 UI 写的纯字符串)不再推断参数
    const settings = store.getSettings();
    const cfg = settings.apiProviders!.configs!["deepseek-1"]!;
    cfg.extraModels = [...(cfg.extraModels ?? []), "deepseek-v4-pro-x"];
    store.saveSettings(settings);
    expect(migrateExtraModels(store)).toBe(false);
    resetModelRuntime();

    const rt = await getModelRuntime(store);
    const json = JSON.parse(readFileSync(path.join(dataDir, "agent", "models.json"), "utf-8"));
    // 官方目录里已有同名模型 → 以 SDK 为准:EM 不写出覆盖,存量覆盖也不再生效
    expect(json.providers.deepseek.modelOverrides).toBeUndefined();
    // 既无手动模型也无有效覆盖的供应商:整条不写(空 models 会被 SDK 判非法)
    expect(json.providers.anthropic).toBeUndefined();
    expect(rt.getModel("anthropic", "claude-opus-4-6")!.maxTokens).not.toBe(64000);
    expect(rt.getModel("deepseek", "deepseek-v4-flash")!.contextWindow).not.toBe(512000);
    expect(rt.getModel("deepseek", "deepseek-v4-pro")!.contextWindow).not.toBe(512000);
    // 别名:请求 id = alias,展示名 = 名称
    const foo = rt.getModel("deepseek", "foo-x")!;
    expect(foo.name).toBe("foo");
    expect(foo.contextWindow).toBe(512000);
    // 自定义供应商:别名映射 + 声明参数
    const bar = rt.getModel("custom-1", "bar-x")!;
    expect(bar.name).toBe("bar");
    expect(bar.contextWindow).toBe(1000000);
    expect(bar.maxTokens).toBe(384000);
    // 自定义供应商未声明参数的模型 → 回落默认(不再按官方同族推断)
    expect(rt.getModel("custom-1", "baz-y")!.contextWindow).toBe(200000);
    // 迁移后的存量条目仍在 models.json 中,升级后新增的条目回落默认值
    expect(rt.getModel("deepseek", "deepseek-v4-flash-x")!.contextWindow).toBeGreaterThan(200000);
    expect(rt.getModel("deepseek", "deepseek-v4-pro-x")!.contextWindow).toBe(200000);
    // 身份迁移:旧「id=显示名 + alias=请求标识」→ 新「id=请求标识 + name=显示名」,请求标识不变
    const { migrateModelIdentity } = await import("./extra-models-migration");
    expect(migrateModelIdentity(store)).toBe(true);
    const after = store.getSettings().apiProviders!.configs!["deepseek-1"]!.extraModels as unknown as Array<Record<string, unknown>>;
    const fooEntry = after.find((e) => e.id === "foo-x") as Record<string, unknown> | undefined;
    expect(fooEntry).toMatchObject({ id: "foo-x", name: "foo", contextWindow: 512000 });
    expect(fooEntry!.alias).toBeUndefined();
    // 一次性:再次调用不再改写
    expect(migrateModelIdentity(store)).toBe(false);
    expect(existsSync(path.join(dataDir, "agent", "models.json"))).toBe(true);
  }, 60000);
});
