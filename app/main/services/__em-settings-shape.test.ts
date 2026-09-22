/**
 * em-settings 结构迁移（扁平 → 分组）的回归测试。
 *
 * 保护目标：升级用户**无感**（值一个不变）+ **安全**（旧键清空、未识别字段保留、
 * 高版本拒绝、重复启动不改文件）。这里的样本刻意覆盖全部搬迁类别：
 * Store 管字段、native-config 管字段、外部直写字段、apiKeys 拆分、未识别字段。
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

/** 迁移前的旧扁平结构样本（字段名与改造前一致） */
const LEGACY: Record<string, unknown> = {
  setupComplete: true,
  defaultProjectDir: "/tmp/projects",
  lastProjectId: "p-1",
  contextThreshold: 80,
  chatPermissionMode: "full",
  sandboxDisabled: true,
  sandboxExtraDomains: ["example.com"],
  uiFontScale: 1.1,
  chatFontScale: 1.2,
  chatFontLevel: 4,
  glowEffect: "orbit",
  glowColorMode: "multi",
  glowColorLight: "#111111",
  glowColorDark: "#222222",
  glowGroupsLight: [{ id: "g1", name: "自定义 1", colors: ["#111111"] }],
  glowGroupsDark: [],
  activeGlowGroupLight: "g1",
  activeGlowGroupDark: "glow-builtin-dark",
  statusTextStyle: "shimmer",
  statusColorLight: "#333333",
  statusColorDark: "#444444",
  statusTextGroupsLight: [],
  statusTextGroupsDark: [{ id: "g2", name: "自定义 1", colors: ["#555555"] }],
  activeStatusGroupLight: "status-builtin-light",
  activeStatusGroupDark: "g2",
  manageSkillEnabled: true,
  learnEnabled: false,
  importExternalSkills: true,
  hiddenSkills: ["legacy-skill"],
  hiddenMcpServers: ["legacy-mcp"],
  mcpApproved: ["/tmp/proj::srv"],
  apiKeys: {
    VISION_MODE: "anthropic", VISION_BASE_URL: "https://vision.example/v1",
    VISION_MODEL: "vm-1", VISION_API_KEY: "vk", TAVILY_API_KEY: "tk",
    CUSTOM_MCP_TOKEN: "ct",
  },
  providerPreferences: { deepseek: { createdAt: 1, lastModel: "m" } },
  legacyProviderIds: { "old-id": "deepseek" },
  someFutureField: "keep-me",
};

/** 旧扁平键名 → 用于断言"搬迁后不残留" */
const LEGACY_FLAT_KEYS = [
  "setupComplete", "defaultProjectDir", "lastProjectId", "contextThreshold", "chatPermissionMode",
  "sandboxDisabled", "sandboxExtraDomains", "uiFontScale", "chatFontScale", "chatFontLevel",
  "glowEffect", "glowColorMode", "glowColorLight", "glowColorDark", "glowGroupsLight", "glowGroupsDark",
  "activeGlowGroupLight", "activeGlowGroupDark", "statusTextStyle", "statusColorLight", "statusColorDark",
  "statusTextGroupsLight", "statusTextGroupsDark", "activeStatusGroupLight", "activeStatusGroupDark",
  "manageSkillEnabled", "learnEnabled", "importExternalSkills", "hiddenSkills", "hiddenMcpServers",
  "mcpApproved", "apiKeys", "providerPreferences", "legacyProviderIds", "nativeConfigVersion",
  "nativeConfigMigration",
];

function fixture(em: Record<string, unknown>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "em-shape-")); dirs.push(dir);
  const store = new Store(dir);
  const emFile = path.join(dir, "em-settings.json");
  atomicWrite(emFile, encode(em));
  return { dir, store, emFile };
}

describe("em-settings 结构迁移（扁平 → 分组）", () => {
  it("按主题归位、旧键清空、外部字段与 apiKeys 一并搬迁，且未识别字段保留", async () => {
    const { store, emFile } = fixture(LEGACY);
    await NativeConfig.create(store);
    const em = read(emFile);

    expect(em.project).toEqual({ defaultDir: "/tmp/projects", lastId: "p-1", setupComplete: true });
    expect(em.session.compactThreshold).toBe(80);
    expect(em.permissions).toEqual({ chatMode: "full", sandboxDisabled: true });
    expect(em.sandbox.extraDomains).toEqual(["example.com"]);
    expect(em.appearance.font).toEqual({ ui: 1.1, chat: 1.2, legacyLevel: 4 });
    expect(em.appearance.glow.effect).toBe("orbit");
    expect(em.appearance.glow.groupsLight).toEqual(LEGACY.glowGroupsLight);
    expect(em.appearance.status.style).toBe("shimmer");
    expect(em.appearance.status.groupsDark).toEqual(LEGACY.statusTextGroupsDark);
    expect(em.skills).toEqual({ manageEnabled: true, learnEnabled: false, importExternal: true, hidden: ["legacy-skill"] });
    expect(em.mcp).toEqual({ hidden: ["legacy-mcp"], approved: ["/tmp/proj::srv"] });
    expect(em.capabilities.vision).toEqual({ mode: "anthropic", baseUrl: "https://vision.example/v1", model: "vm-1", apiKey: "vk" });
    expect(em.capabilities.web.apiKey).toBe("tk");
    // 非 VISION/TAVILY 的键进 env 池——它们要原样注入给 MCP server
    expect(em.env).toEqual({ CUSTOM_MCP_TOKEN: "ct" });

    for (const key of LEGACY_FLAT_KEYS) {
      expect(em[key], `旧扁平键 ${key} 应已搬迁、不该残留`).toBeUndefined();
    }
    expect(em.someFutureField).toBe("keep-me");
    expect(em.migration.schemaVersion).toBe(1);
    // MCP env 注入的数据源：组装回来必须与迁移前逐键等价
    expect(apiKeysFromDisk(em)).toEqual(LEGACY.apiKeys);
  }, 60000);

  it("幂等：第二次启动不再改写文件（连字节都不变）", async () => {
    const { store, emFile } = fixture(LEGACY);
    await NativeConfig.create(store);
    const bytes = fs.readFileSync(emFile, "utf8");
    await NativeConfig.create(new Store(path.dirname(emFile)));
    expect(fs.readFileSync(emFile, "utf8")).toBe(bytes);
  }, 60000);

  it("拒绝更高的结构版本，且不改动文件", async () => {
    const { store, emFile } = fixture({ ...LEGACY, migration: { schemaVersion: 2 } });
    const before = fs.readFileSync(emFile, "utf8");
    await expect(NativeConfig.create(store)).rejects.toThrow("更新版本");
    expect(fs.readFileSync(emFile, "utf8")).toBe(before);
  }, 60000);

  it("读侧按新结构取值：分组字段、默认值与组装后的 apiKeys 都对得上", async () => {
    const { store } = fixture(LEGACY);
    const repo = await NativeConfig.create(store);
    const s = store.getSettings();
    expect(s.defaultProjectDir).toBe("/tmp/projects");
    expect(s.contextThreshold).toBe(80);
    expect(s.chatPermissionMode).toBe("full");
    expect(s.sandboxDisabled).toBe(true);
    expect(s.uiFontScale).toBe(1.1);
    expect(s.glowEffect).toBe("orbit");
    expect(s.statusTextStyle).toBe("shimmer");
    expect(s.manageSkillEnabled).toBe(true);
    expect(s.learnEnabled).toBe(false);
    expect(s.apiKeys).toEqual(LEGACY.apiKeys);
    expect(repo.resolveProviderId("old-id")).toBe("deepseek");
  }, 60000);

  it("旧结构下的读写往返：Store 保存后磁盘已是分组结构，读回值不变", async () => {
    const { store, emFile } = fixture(LEGACY);
    await NativeConfig.create(store);
    const before = store.getSettings();
    store.saveSettings({ ...before, lastProjectId: "p-2" });
    const em = read(emFile);
    expect(em.project.lastId).toBe("p-2");
    expect(em.lastProjectId).toBeUndefined();
    expect(store.getSettings().uiFontScale).toBe(1.1);
    expect(store.getSettings().apiKeys).toEqual(LEGACY.apiKeys);
  }, 60000);

  it("迁移完成前的 Store 写入不得抹掉 pi 原生迁移要读的投影字段", async () => {
    // 真实启动时序：`createWindow()` 不等 `getNativeConfig`（SDK 冷导入数秒），
    // 渲染层 ProjectPage 挂载即写 lastProjectId → `Store.setLastProjectId` 会先落一次盘。
    const { dir, store, emFile } = fixture({
      setupComplete: true,
      chatThinkingLevel: "high",
      apiProviders: {
        current: "ds",
        configs: { ds: { id: "ds", presetId: "deepseek", name: "DS", apiKey: "k", createdAt: 1, model: "deepseek-flash", models: ["deepseek-flash"] } },
      },
    });
    store.saveSettings({ ...store.getSettings(), lastProjectId: "p-1" });
    // 投影字段（apiProviders / chatThinkingLevel）必须留到迁移读完才能删
    expect(read(emFile).apiProviders, "迁移前不该被 Store 删掉").toBeDefined();

    await NativeConfig.create(store);

    expect(Object.keys(read(path.join(dir, "agent", "models.json")).providers ?? {})).toEqual(["deepseek"]);
    expect(read(path.join(dir, "agent", "settings.json"))).toMatchObject({
      defaultProvider: "deepseek", defaultModel: "deepseek-flash", defaultThinkingLevel: "high",
    });
    // 迁移完成后它们才从磁盘消失（真源已转到 pi 原生文件）
    const em = read(emFile);
    expect(em.apiProviders).toBeUndefined();
    expect(em.chatThinkingLevel).toBeUndefined();
    expect(em.project.lastId).toBe("p-1");
  }, 60000);
});
