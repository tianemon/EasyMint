/**
 * 完整升级路径的端到端回归（真实用户形态）。
 *
 * 为什么单开一个文件：现有两组测试各覆盖一半——`__em-settings-shape.test.ts` 的样本有 shape 段
 * 的全部扁平键但**不含投影字段**（apiProviders / model / availableModels / chatThinkingLevel），
 * `native-config.test.ts` 有 apiProviders 但只有 4 个键；而真实用户升级时两边都有。这个组合此前
 * 没有覆盖（2026-09-22 的迁移健康度检查就是在这里发现缺口、补完演练后固化下来的）。
 *
 * 另外锚住同一批修掉的三处行为：
 * - settings.json 的默认供应商悬空时，不再在界面上造出一个点不开的空壳条目；
 * - 会话缓存里指向「已删除供应商」的绑定会被清掉（删供应商时源头清 + 启动时兜底清）；
 * - 备份目录有保留上限——里面有 `auth.json`（明文 api_key），不能无限堆积。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Store } from "./store";
import { NativeConfig } from "./native-config";
import { atomicWrite, encode } from "./native-config-storage";
import { apiKeysFromDisk } from "./em-settings-schema";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() } }));

const dirs: string[] = [];
const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture(em: Record<string, unknown> | null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "em-migration-e2e-")); dirs.push(dir);
  const store = new Store(dir);
  const emFile = path.join(dir, "em-settings.json");
  if (em) atomicWrite(emFile, encode(em));
  return { dir, store, emFile, file: (n: string) => path.join(dir, "agent", `${n}.json`) };
}

/** v0.28.0 用户的完整真实形态：`writeEmSettings` 会写出的全部扁平键 + apiProviders + 投影字段。 */
const FULL: Record<string, unknown> = {
  setupComplete: true, defaultProjectDir: "/Users/amon/EasyMintProject", lastProjectId: "proj-1",
  contextThreshold: 75, chatPermissionMode: "standard", sandboxDisabled: false,
  sandboxExtraDomains: ["a.example.com", "b.example.com"],
  uiFontScale: 1, chatFontScale: 1, chatFontLevel: 3,
  glowEffect: "orbit", glowColorMode: "multi", glowColorLight: "#16a34a", glowColorDark: "#c8c8c8",
  glowGroupsLight: [{ id: "glow-custom-1", name: "自定义 1", colors: ["#111111", "#222222"] }],
  glowGroupsDark: [], activeGlowGroupLight: "glow-custom-1", activeGlowGroupDark: "glow-builtin-dark",
  statusTextStyle: "shimmer", statusColorLight: "#333333", statusColorDark: "#444444",
  statusTextGroupsLight: [], statusTextGroupsDark: [{ id: "status-custom-1", name: "自定义 1", colors: ["#555555"] }],
  activeStatusGroupLight: "status-builtin-light", activeStatusGroupDark: "status-custom-1",
  manageSkillEnabled: true, learnEnabled: true, importExternalSkills: true,
  hiddenSkills: ["some-skill"], hiddenMcpServers: ["some-mcp"], mcpApproved: ["/p::srv"],
  apiKeys: {
    VISION_MODE: "openai", VISION_BASE_URL: "https://vision.example/v1", VISION_MODEL: "vl-1",
    VISION_API_KEY: "vk-1", TAVILY_API_KEY: "tvly-1", CUSTOM_MCP_TOKEN: "tok-1",
  },
  // 投影字段（Store 从 apiProviders 同步出来的旧字段）
  model: "deepseek-flash", availableModels: ["deepseek-flash", "deepseek-v4-pro"], chatThinkingLevel: "high",
  apiProviders: {
    current: "deepseek-1781160801049",
    configs: {
      "deepseek-1781160801049": {
        id: "deepseek-1781160801049", presetId: "deepseek", name: "DeepSeek", apiKey: "sk-ds",
        createdAt: 1781160801049, model: "deepseek-flash", models: ["deepseek-flash", "deepseek-v4-pro"],
        extraModels: [],
      },
      "custom-1787796375140": {
        id: "custom-1787796375140", presetId: "custom", name: "阿里百炼", apiKey: "sk-ali",
        createdAt: 1787796375140, baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiType: "openai-completions", model: "qwen3.7-flash",
        models: ["qwen3.7-flash"], extraModels: [{ id: "qwen3.7-flash", name: "Qwen", contextWindow: 1000000, maxTokens: 32000 }],
      },
      "openai-codex": {
        id: "openai-codex", presetId: "openai-codex", name: "OpenAI Codex", apiKey: "",
        createdAt: 1789000000000, model: "gpt-5", models: ["gpt-5"], extraModels: [],
      },
      "github-copilot": {
        id: "github-copilot", presetId: "github-copilot", name: "GitHub Copilot", apiKey: "",
        createdAt: 1789000000001, model: "claude-sonnet-4", models: ["claude-sonnet-4"], extraModels: [],
      },
    },
  },
  modelParamsMigrated: true, modelIdentityMigrated: true,
  someFutureField: "keep-me",
};

const LEGACY_FLAT = [
  "setupComplete", "defaultProjectDir", "lastProjectId", "contextThreshold", "chatPermissionMode",
  "sandboxDisabled", "sandboxExtraDomains", "uiFontScale", "chatFontScale", "chatFontLevel",
  "glowEffect", "glowColorMode", "glowColorLight", "glowColorDark", "glowGroupsLight", "glowGroupsDark",
  "activeGlowGroupLight", "activeGlowGroupDark", "statusTextStyle", "statusColorLight", "statusColorDark",
  "statusTextGroupsLight", "statusTextGroupsDark", "activeStatusGroupLight", "activeStatusGroupDark",
  "manageSkillEnabled", "learnEnabled", "importExternalSkills", "hiddenSkills", "hiddenMcpServers",
  "mcpApproved", "apiKeys", "apiProviders", "model", "availableModels", "chatThinkingLevel",
  "modelParamsMigrated", "modelIdentityMigrated", "providerPreferences", "legacyProviderIds",
  "nativeConfigVersion", "nativeConfigMigration",
];

const THEME_GROUPS = ["appearance", "capabilities", "env", "mcp", "migration", "permissions",
  "project", "providers", "sandbox", "session", "skills"];

describe("完整升级路径（v0.28.0 → 当前）", () => {
  it("两段迁移一次跑完：值保真、旧键零残留、原生文件与会话缓存都到位", async () => {
    const { dir, store, emFile, file } = fixture(FULL);
    atomicWrite(file("auth"), encode({ "github-copilot": { type: "oauth", access: "a", refresh: "r", expires: 9999999999999 } }));
    atomicWrite(path.join(dir, "session-cache", "01a0aed1.json"), encode({ provider: "deepseek-1781160801049", model: "deepseek-flash", thinkingLevel: "high" }));

    const repo = await NativeConfig.create(store);
    const em = read(emFile);

    // ① 结构：主题组齐全（未识别字段原样留在顶层）+ 旧键零残留 + 两个版本标记
    expect(Object.keys(em).filter((k) => k !== "someFutureField").sort()).toEqual([...THEME_GROUPS].sort());
    for (const key of LEGACY_FLAT) expect(em[key], `旧扁平键 ${key} 不该残留`).toBeUndefined();
    expect(em.someFutureField).toBe("keep-me");
    expect(em.migration.schemaVersion).toBe(1);
    expect(em.migration.nativeConfigVersion).toBe(1);

    // ② 值保真：逐主题核对（含数组型）
    expect(em.project).toEqual({ defaultDir: "/Users/amon/EasyMintProject", lastId: "proj-1", setupComplete: true });
    expect(em.session.compactThreshold).toBe(75);
    expect(em.permissions).toEqual({ chatMode: "standard", sandboxDisabled: false });
    expect(em.sandbox.extraDomains).toEqual(["a.example.com", "b.example.com"]);
    expect(em.appearance.font).toEqual({ ui: 1, chat: 1, legacyLevel: 3 });
    expect(em.appearance.glow.effect).toBe("orbit");
    expect(em.appearance.glow.groupsLight).toEqual(FULL.glowGroupsLight);
    expect(em.appearance.glow.activeLight).toBe("glow-custom-1");
    expect(em.appearance.status.style).toBe("shimmer");
    expect(em.appearance.status.groupsDark).toEqual(FULL.statusTextGroupsDark);
    expect(em.skills).toEqual({ manageEnabled: true, learnEnabled: true, importExternal: true, hidden: ["some-skill"] });
    expect(em.mcp).toEqual({ hidden: ["some-mcp"], approved: ["/p::srv"] });
    expect(em.capabilities.vision).toEqual({ mode: "openai", baseUrl: "https://vision.example/v1", model: "vl-1", apiKey: "vk-1" });
    expect(em.capabilities.web.apiKey).toBe("tvly-1");
    expect(em.env).toEqual({ CUSTOM_MCP_TOKEN: "tok-1" });
    expect(apiKeysFromDisk(em)).toEqual(FULL.apiKeys);   // MCP env 注入契约：组装回来逐键等价
    expect(em.providers.preferences["deepseek"]).toMatchObject({ createdAt: 1781160801049, lastModel: "deepseek-flash" });
    expect(em.providers.legacyIds["deepseek-1781160801049"]).toBe("deepseek");

    // ③ 原生文件：preset 剥时间戳后缀、custom 保留原 id；补 api_key 且既有 oauth 不被覆盖
    expect(Object.keys(read(file("models")).providers).sort()).toEqual(
      ["custom-1787796375140", "deepseek", "github-copilot", "openai-codex"],
    );
    const auth = read(file("auth"));
    expect(auth.deepseek).toEqual({ type: "api_key", key: "sk-ds" });
    expect(auth["custom-1787796375140"]).toEqual({ type: "api_key", key: "sk-ali" });
    expect(auth["github-copilot"]).toMatchObject({ type: "oauth", refresh: "r" });
    // 思考等级从旧扁平键 chatThinkingLevel 搬过来——shape 段不能把它搬走、native 段必须读到它，
    // 否则升级用户的等级会静默退回默认值
    expect(read(file("settings"))).toMatchObject({
      defaultProvider: "deepseek", defaultModel: "deepseek-flash", defaultThinkingLevel: "high",
    });

    // ④ 会话缓存里的旧 provider id 被改写（否则打开的会话读不到绑定）
    const cache = read(path.join(dir, "session-cache", "01a0aed1.json"));
    expect(cache.provider).toBe("deepseek");
    expect(cache.model).toBe("deepseek-flash");

    // ⑤ 读侧视图
    expect(repo.view().apiProviders.current).toBe("deepseek");
    expect(repo.view().model).toBe("deepseek-flash");
    expect(repo.resolveProviderId("deepseek-1781160801049")).toBe("deepseek");

    // ⑥ 两段备份齐备且都有 manifest；结构迁移那份必须等于迁移前原文
    const backups = fs.readdirSync(path.join(dir, "config-backups"));
    const shape = backups.find((n) => n.startsWith("em-settings-shape-"));
    const native = backups.find((n) => n.startsWith("pi-native-v1-"));
    expect(shape).toBeDefined(); expect(native).toBeDefined();
    expect(fs.existsSync(path.join(dir, "config-backups", shape!, "manifest.json"))).toBe(true);
    expect(read(path.join(dir, "config-backups", shape!, "em-settings.json"))).toEqual(FULL);

    // ⑦ 幂等：再启动一次，所有文件字节不变、不产生新备份
    const files = [emFile, file("models"), file("auth"), file("settings"), path.join(dir, "session-cache", "01a0aed1.json")];
    const before = files.map((p) => fs.readFileSync(p, "utf8"));
    await NativeConfig.create(new Store(dir));
    expect(files.map((p) => fs.readFileSync(p, "utf8"))).toEqual(before);
    expect(fs.readdirSync(path.join(dir, "config-backups")).length).toBe(2);
  }, 90000);

  it("全新用户（无 em-settings.json）：不生成空壳原生文件", async () => {
    const { store, file } = fixture(null);
    await NativeConfig.create(store);
    expect(fs.existsSync(file("models"))).toBe(false);
    expect(fs.existsSync(file("settings"))).toBe(false);
    expect((await store.getSettings() as unknown as { defaultProjectDir?: string }).defaultProjectDir).toBeTruthy();
  }, 90000);

  it("默认供应商悬空时：不进入供应商列表（不再造出空壳条目），模型侧仍有回落", async () => {
    const { dir, file } = fixture(FULL);
    await NativeConfig.create(new Store(dir));
    // 外部把默认供应商改成已删除的 id（手改文件 / 跨版本混用）
    atomicWrite(file("settings"), encode({ defaultProvider: "已删除的供应商", defaultModel: "ghost-model", defaultThinkingLevel: "high" }));
    const repo = await NativeConfig.create(new Store(dir));
    const ids = Object.keys(repo.view().apiProviders.configs);
    expect(ids).not.toContain("已删除的供应商");
    expect(ids.sort()).toEqual(["custom-1787796375140", "deepseek", "github-copilot", "openai-codex"]);
    // 模型侧回落到一个真实可用的供应商（不是 null、也不卡住）
    expect(repo.view().apiProviders.current).toBeTruthy();
    expect(repo.getDefaultModel()).toBeTruthy();
  }, 90000);

  it("指向已删除供应商的会话缓存绑定会被清掉，且不误伤有效绑定", async () => {
    const { dir, store } = fixture(FULL);
    const cacheDir = path.join(dir, "session-cache");
    atomicWrite(path.join(cacheDir, "dangling.json"), encode({ provider: "custom-1788849871399", model: "glm-5.3-x", permissionMode: "full" }));
    atomicWrite(path.join(cacheDir, "valid.json"), encode({ provider: "custom-1787796375140", model: "qwen3.7-flash" }));
    atomicWrite(path.join(cacheDir, "no-provider.json"), encode({ permissionMode: "standard", contextUsage: 10 }));

    await NativeConfig.create(store);

    const dangling = read(path.join(cacheDir, "dangling.json"));
    expect(dangling.provider).toBeUndefined();
    expect(dangling.model).toBeUndefined();
    expect(dangling.permissionMode).toBe("full");               // 其余字段原样保留
    expect(read(path.join(cacheDir, "valid.json"))).toEqual({ provider: "custom-1787796375140", model: "qwen3.7-flash" });
    expect(read(path.join(cacheDir, "no-provider.json"))).toEqual({ permissionMode: "standard", contextUsage: 10 });
  }, 90000);

  it("删供应商时同步清理指向它的会话缓存（源头，与删除同一事务）", async () => {
    const { dir, store } = fixture(FULL);
    const cacheDir = path.join(dir, "session-cache");
    atomicWrite(path.join(cacheDir, "uses-ali.json"), encode({ provider: "custom-1787796375140", model: "qwen3.7-flash" }));
    const repo = await NativeConfig.create(store);

    const view = repo.view().apiProviders;
    delete view.configs["custom-1787796375140"];
    if (view.current === "custom-1787796375140") view.current = "deepseek";
    await repo.saveProviders(view);

    expect(read(path.join(dir, "agent", "models.json")).providers["custom-1787796375140"]).toBeUndefined();
    const cache = read(path.join(cacheDir, "uses-ali.json"));
    expect(cache.provider).toBeUndefined();
    expect(cache.model).toBeUndefined();
  }, 90000);

  it("备份目录有保留上限；含凭据的历史副本不会无限堆积", async () => {
    const { dir, store } = fixture(FULL);
    const repo = await NativeConfig.create(store);
    const backupRoot = path.join(dir, "config-backups");
    // 造出超过上限的历史备份（真实的备份目录名形如 <label>-<时间戳>-<随机>）
    for (let i = 0; i < 25; i++) {
      const d = path.join(backupRoot, `settings-${1000 + i}-old${i}`);
      fs.mkdirSync(d, { recursive: true });
      atomicWrite(path.join(d, "manifest.json"), encode({ version: 1, createdAt: new Date(1000 + i).toISOString() }));
    }
    expect(fs.readdirSync(backupRoot).length).toBeGreaterThan(20);

    await repo.setThinkingLevel("low");   // 触发一次 commit → 顺带 prune

    const left = fs.readdirSync(backupRoot);
    expect(left.length).toBeLessThanOrEqual(20);
    expect(left.some((n) => n.startsWith("settings-") && !n.includes("old"))).toBe(true);  // 本次刚建的在
    expect(left).not.toContain("settings-1000-old0");                                     // 最旧的被删
    expect(left).not.toContain("settings-1001-old1");
  }, 90000);
});
