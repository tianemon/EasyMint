/**
 * 静态供应商模型表的 id 契约。
 *
 * 背景：Pi 自 v1.0.0 起把 `pi-ai/dist/providers/data/*.json` 的 key 写成
 * `<type>:<id>`（`chat:` / `image:` / `classifier:`），而 `ModelRuntime` 暴露的
 * `model.id` 是剥掉前缀的裸 id。本模块绕过 SDK 直读原始 JSON，必须自己剥前缀，
 * 否则 `getProviderStaticModels()` 的表key 与 runtime、`models.json` 的
 * `modelOverrides` 键对不上——用户设置的上下文长度会静默失效。
 *
 * 本测试直接读锁定 SDK 的真实数据档，不构造假数据：只有真实档才能反映上游格式。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { getProviderStaticModels, getModelSpecLookup, getStaticModelSpec, getStaticModelSpecWithAlias } from "./pi-init-static";

/** 定位锁定 SDK 内pi-ai 的静态数据目录（与 pi-init-static.findDataDir 同一候选顺序）。 */
function findDataDir(): string | undefined {
  const require = createRequire(path.join(__dirname, "static-anchor.cjs"));
  const root = (require.resolve.paths("@earendil-works/pi-ai") ?? [])
    .map((r) => path.join(r, "@earendil-works", "pi-ai", "dist", "providers", "data"))
    .find((p) => fs.existsSync(p));
  return root;
}

describe("静态供应商模型表", () => {
  it("读取 Qwen Token Plan Individual 国内入口的 SDK 模型表", () => {
    expect(getProviderStaticModels("qwen-token-plan-individual-cn").size).toBeGreaterThan(0);
  });
  it("跨供应商窗口与能力索引也接受裸 id 和网关别名，只包含对话模型", () => {
    const models = getProviderStaticModels("deepseek");
    expect(models.size).toBeGreaterThan(0);
    const [id, spec] = [...models][0]!;
    expect(getModelSpecLookup().get(id)?.contextWindow).toBeGreaterThanOrEqual(spec.contextWindow);
    expect(getStaticModelSpec(id)).toMatchObject({ reasoning: spec.reasoning, input: spec.input });
    expect(getStaticModelSpecWithAlias(`${id}-gateway`)).toEqual(getStaticModelSpec(id));
    for (const key of getModelSpecLookup().keys()) expect(key).not.toMatch(/^(chat|image|classifier):/);
    const dir = findDataDir()!;
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".json"))) {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      for (const group of Object.values(data) as Record<string, unknown>[]) {
        for (const key of Object.keys(group)) {
          if (/^(image|classifier):/.test(key)) {
            const bare = key.slice(key.indexOf(":") + 1);
            expect(getStaticModelSpec(bare)?.type).not.toBe("image");
            expect(getStaticModelSpec(bare)?.type).not.toBe("classifier");
          }
        }
      }
    }
  });
  it("SDK 约定成立：数据档文件名就是 provider id（pi-init-static 按此拼路径读档）", () => {
    // pi-init-static.ts 不维护供应商清单，直接读 providers/data/<providerId>.json。
    // 这里对照 SDK 源码锁住这条约定：上游改了命名，本用例失败，必须回头改 pi-init-static。
    // 数据目录是 <pi-ai>/dist/providers/data，其上一级就是 providers/
    const providersDir = path.dirname(findDataDir()!);
    const files = fs.readdirSync(providersDir).filter(f => f.endsWith(".models.js"));
    expect(files.length).toBeGreaterThan(30);
    for (const file of files) {
      const source = fs.readFileSync(path.join(providersDir, file), "utf8");
      const id = /flatten(?:Chat|Image|Classifier)ModelCatalog\("([^"]+)"/.exec(source)?.[1];
      const dataFile = /\.\.\/data\/([a-z0-9.-]+)\.json/.exec(source)?.[1]
        ?? /\.\/data\/([a-z0-9.-]+)\.json/.exec(source)?.[1];
      expect(dataFile, file).toBe(id);
      expect(file, file).toBe(`${id}.models.js`);
    }
  });

  it("每个带对话模型的 SDK 数据档都能按 id 读到，且模型数与档内一致", () => {
    const dir = findDataDir()!;
    let seen = 0;
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".json") && !f.startsWith("."))) {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as Record<string, Record<string, unknown>>;
      const chatIds = Object.values(data).flatMap(group => Object.keys(group ?? {}))
        .filter(key => /^chat:/.test(key)).map(key => key.slice("chat:".length));
      if (chatIds.length === 0) continue;
      seen += 1;
      const providerId = file.slice(0, -".json".length);
      const models = getProviderStaticModels(providerId);
      expect([...models.keys()].sort(), `${providerId} 应能按 id 读到对话模型`).toEqual([...new Set(chatIds)].sort());
    }
    expect(seen).toBeGreaterThan(30);
  });

  it("曾漏登记的供应商按内置处理，只有分类模型的供应商不算内置", () => {
    // 回归点：手维护清单曾停在 SDK 1.0.3 之前，azure(原 azure-openai-responses)/meta/radius 被误判为自定义。
    for (const providerId of ["azure", "meta", "radius"]) {
      expect(getProviderStaticModels(providerId).size, providerId).toBeGreaterThan(0);
    }
    // 旧名已无数据档；typesafe 只有分类模型。两者都应判为非内置。
    expect(getProviderStaticModels("azure-openai-responses").size).toBe(0);
    expect(getProviderStaticModels("typesafe").size).toBe(0);
  });

  it("供应商 id 不合法时不拼路径，读不到数据目录之外", () => {
    for (const id of ["../package", "../../package", "a/b", "..", "", "Anthropic", "deepseek.json"]) {
      expect(getProviderStaticModels(id).size, JSON.stringify(id)).toBe(0);
    }
  });

  it("剥掉 Pi v1.0.0 起给静态表 key 加的模型类型前缀，只留 chat 类", () => {
    const dir = findDataDir();
    expect(dir).toBeDefined();

    const prefixRe = /^(chat|image|classifier):/;
    let sawPrefixedKey = false;

    for (const file of fs.readdirSync(dir!).filter((f) => f.endsWith(".json"))) {
      const raw = JSON.parse(fs.readFileSync(path.join(dir!, file), "utf-8")) as Record<string, unknown>;
      for (const apiGroup of Object.values(raw)) {
        if (!apiGroup || typeof apiGroup !== "object") continue;
        for (const key of Object.keys(apiGroup as Record<string, unknown>)) {
          if (prefixRe.test(key)) sawPrefixedKey = true;
        }
      }
    }
    // 锁一个事实：当前 SDK 的静态表确实带类型前缀。若上游将来改回无前缀，本断言会提醒
    // 重新审视 stripModelTypePrefix 是否还必要（无害，但不能据此认为前缀已被验证）。
    expect(sawPrefixedKey).toBe(true);

    // 行为断言：任何内置供应商的表内 id 都不带类型前缀。
    for (const providerId of ["deepseek", "anthropic", "openai", "google"]) {
      const models = getProviderStaticModels(providerId);
      if (models.size === 0) continue; // 该供应商在当前 SDK 无静态档
      for (const id of models.keys()) {
        expect(id, `${providerId} 的模型 id 不应带类型前缀`).not.toMatch(prefixRe);
      }
    }
  });

  it("deepseek 表内的 id 能与 Pi 运行时对得上（modelOverrides 键必须匹配）", async () => {
    const models = getProviderStaticModels("deepseek");
    if (models.size === 0) return; // 当前 SDK 无 deepseek 静态档

    const require = createRequire(path.join(__dirname, "static-anchor.cjs"));
    const sdkEntry = (require.resolve.paths("@earendil-works/pi-coding-agent") ?? [])
      .map((r) => path.join(r, "@earendil-works", "pi-coding-agent", "dist", "index.js"))
      .find((p) => fs.existsSync(p));
    expect(sdkEntry).toBeDefined();

    const { ModelRuntime } = await import(pathToFileURL(sdkEntry!).href);
    const os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-static-anchor-"));
    const modelsPath = path.join(dir, "models.json");
    const authPath = path.join(dir, "auth.json");
    const [firstId] = [...models.keys()];
    fs.writeFileSync(modelsPath, JSON.stringify({ providers: { deepseek: { name: "DS", modelOverrides: { [firstId]: { contextWindow: 654321 } } } } }));
    fs.writeFileSync(authPath, JSON.stringify({}));

    try {
      const rt = await ModelRuntime.create({ modelsPath, authPath, modelsStorePath: path.join(dir, "store.json"), allowModelNetwork: false });
      // 表里的裸 id 正是 runtime 认的 id —— override 因此能生效（这是 0.87.1→1.0.4 的真实回归点）
      expect(rt.getModel("deepseek", firstId)?.contextWindow).toBe(654321);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
