/**
 * 缓存模型列表与 SDK 目录的对齐（syncNativeModels）。
 *
 * 语义：内置供应商的 config.models 以 SDK 目录为准「增 + 删」——集合与用户在供应商页保存一次
 * 的结果一致；顺序取最小扰动（保留现有顺序、剔除失效项、新模型追加尾部）。
 * 自定义供应商与 extraModels 显式声明的条目不参与剔除。
 *
 * 断言纪律：期望值一律取自 getProviderStaticModels() 的实际输出，**不硬编码官方模型 id**。
 * 硬编码会在 SDK 升级改名/增删模型时变成假红（2026-09-20：0.86.0 把 deepseek-v4-flash
 * 改名为 deepseek-flash，就 red 掉了一个硬编码旧 id 的用例）。
 * 隔离手段同 __model-params.test.ts：临时 HOME + 临时 PI_CODING_AGENT_DIR。
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() } }));

let dataDir = "";
/** 目标供应商（deepseek）的 SDK 目录 id，顺序即目录顺序 */
let dirIds: string[] = [];

/** 夹具里"必定不在任何 SDK 目录"的假 id */
const GHOST = "ghost-removed-model";
/** 夹具里用户显式声明的第三方请求标识（官方目录未收录） */
const THIRD_PARTY = "third-party-x";
/** 旧形态声明（无 name，请求标识在 alias）归一化后的请求标识 */
const LEGACY_ALIAS = "legacy-alias-x";

beforeAll(async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "em-models-sync-"));
  process.env.HOME = home;
  process.env.PI_CODING_AGENT_DIR = path.join(home, ".easymint", "agent");
  dataDir = path.join(home, ".easymint");
  mkdirSync(dataDir, { recursive: true });

  const { getProviderStaticModels } = await import("./pi-init-static");
  dirIds = [...getProviderStaticModels("deepseek").keys()];
  // 前置探针：本用例依赖目录至少两个模型（用于验证"保序不重排"）；不足时报明确原因
  expect(dirIds.length, "deepseek 目录模型不足 2 个，无法验证保序").toBeGreaterThanOrEqual(2);

  writeFileSync(
    path.join(dataDir, "em-settings.json"),
    JSON.stringify(
      {
        defaultProjectDir: "~/Desktop",
        apiProviders: {
          current: "ds-1",
          configs: {
            // 内置供应商：目录序被打乱 + 混入失效残留 + 含一条重复项（存量脏数据）+ extraModels
            // 有目录外的显式声明。只保留一个**不同**的目录 id——另一个必须由对齐逻辑**补入**
            // （覆盖「SDK 新增模型自动出现」这条核心路径；两个都留着的话该分支永远不被执行）
            "ds-1": {
              id: "ds-1", presetId: "deepseek", name: "DeepSeek", apiKey: "sk-test",
              model: "keep-me", createdAt: 1,
              models: [dirIds[1], GHOST, dirIds[1]],
              extraModels: [
                { id: THIRD_PARTY, name: "第三方", contextWindow: 128000, maxTokens: 16384 },
                { id: "legacy-name", alias: LEGACY_ALIAS, contextWindow: 128000, maxTokens: 16384 },
              ],
            },
            // 内置供应商 + 手填了「官方目录已有」的模型：这条声明不生效（参数一律取官方），
            // 还会让界面显示手填的名字而非官方名 → 应被清理；同表里不在目录的那条必须留下
            "ds-2": {
              id: "ds-2", presetId: "deepseek", name: "DeepSeek 备用", apiKey: "sk-test",
              model: dirIds[0], createdAt: 2,
              models: [dirIds[0]],
              extraModels: [
                { id: dirIds[0], name: "我手填的名字", contextWindow: 1, maxTokens: 1 },
                { id: THIRD_PARTY, name: "第三方", contextWindow: 128000, maxTokens: 16384 },
              ],
            },
            // 自定义供应商：模型清单完全由用户声明，一律不许碰。
            // 特意放一个与官方目录**同名**的 id（网关转售官方模型的常见形态），锚住"不误伤"。
            // 注：custom 眼下有双重保护（本函数显式跳过 + getProviderStaticModels("custom") 恒空），
            // 本用例锚的是**行为**——即使将来该 provider 有了目录数据，这几条也不能被剔除。
            "custom-1": {
              id: "custom-1", presetId: "custom", name: "网关", apiKey: "sk-test",
              baseUrl: "https://gw.example.com/v1", apiType: "anthropic-messages",
              model: "my-model", createdAt: 1,
              models: [dirIds[0], "my-model", "another-model", GHOST],
              extraModels: [{ id: "my-model", name: "我的模型", contextWindow: 128000, maxTokens: 16384 }],
            },
            // 目录缺失的 presetId（不在 PROVIDER_FILES）：不清空，整条跳过
            "ghost-provider-1": {
              id: "ghost-provider-1", presetId: "not-a-real-provider", name: "未知", apiKey: "sk",
              model: "whatever", models: ["whatever", GHOST], createdAt: 1,
            },
          },
        },
      },
      null,
      2,
    ),
  );
});

describe("缓存模型列表与 SDK 目录对齐", () => {
  it("内置供应商：剔失效项 + 补入目录新增项 + 保留现有顺序 + 声明项追加尾部", async () => {
    const { Store } = await import("./store");
    const { syncNativeModels } = await import("./pi-init");

    expect(syncNativeModels(new Store(dataDir))).toBe(true);

    const cfg = new Store(dataDir).getSettings().apiProviders!.configs!["ds-1"]!;
    // 夹具原值 [dirIds[1], GHOST, dirIds[1]] → 期望：
    //   dirIds[1]  保留在首位，且**只出现一次**（重复项被 Set 去掉）
    //              （若实现按目录序重排，首位会变成 dirIds[0] → 断言失败）
    //   dirIds[0]  由目录**补入**（原列表里没有它）
    //   THIRD_PARTY / LEGACY_ALIAS 声明项追加尾部
    expect(cfg.models).toEqual([dirIds[1], dirIds[0], THIRD_PARTY, LEGACY_ALIAS]);
    // 失效残留被剔除
    expect(cfg.models).not.toContain(GHOST);
    // 默认模型不在此函数内改写（处理失效默认模型是另一件事）
    expect(cfg.model).toBe("keep-me");
  });

  it("自定义供应商完全不动（与官方目录重名的 id 也不剔除，models 与 extraModels 一字不改）", async () => {
    const { Store } = await import("./store");
    const cfg = new Store(dataDir).getSettings().apiProviders!.configs!["custom-1"]!;
    expect(cfg.models).toEqual([dirIds[0], "my-model", "another-model", GHOST]);
    expect(cfg.extraModels).toEqual([
      { id: "my-model", name: "我的模型", contextWindow: 128000, maxTokens: 16384 },
    ]);
  });

  it("目录缺失的 presetId 不清空列表", async () => {
    const { Store } = await import("./store");
    const cfg = new Store(dataDir).getSettings().apiProviders!.configs!["ghost-provider-1"]!;
    expect(cfg.models).toEqual(["whatever", GHOST]);
  });

  it("清理 extraModels 中已在官方目录的声明（同表里不在目录的保留）", async () => {
    const { Store } = await import("./store");
    // 第一个用例已跑过一轮对齐（遍历全部配置），这里直接看结果
    const cfg = new Store(dataDir).getSettings().apiProviders!.configs!["ds-2"]!;
    expect(cfg.extraModels).toHaveLength(1);
    expect((cfg.extraModels![0] as { id: string }).id).toBe(THIRD_PARTY);
    // 声明虽被清掉，模型依然可选——官方目录本就提供它（且显示名/参数一律取官方）
    expect(cfg.models).toContain(dirIds[0]);
  });

  it("幂等：再次调用返回 false 且内容不变", async () => {
    const { Store } = await import("./store");
    const { syncNativeModels } = await import("./pi-init");
    const before = JSON.stringify(new Store(dataDir).getSettings().apiProviders);
    expect(syncNativeModels(new Store(dataDir))).toBe(false);
    expect(JSON.stringify(new Store(dataDir).getSettings().apiProviders)).toBe(before);
  });
});
