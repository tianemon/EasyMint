import { describe, expect, it, vi } from "vitest";
vi.mock("../../stores/settings-store", () => ({ useSettingsStore: { getState: () => ({ defaultProjectDir: "/projects" }) } }));
const { DEFAULT_DATA } = await import("./ProjectFormTypes");
const { deploymentChoices, normalizeCreationData, updateCreationData, freshCreationData } = await import("./creation-rules");
const { parseProjectDraft } = await import("./project-draft");
const { deliveryContext, projectProfile } = await import("./project-requirements");
const { buildInitInstruction, buildInitTriggerPrompt } = await import("../../../../shared/prompts");

describe("creation dependencies and generation", () => {
  it("offers service choices for mini programs instead of local desktop deployment", () => {
    expect(deploymentChoices(["wechat-miniprogram"])).toEqual(["auto", "client-only", "cloud-dev", "云端"]);
    expect(deploymentChoices(["ios-mobile"])).not.toContain("本地");
    expect(deploymentChoices(["windows-desktop"])).toContain("本地");
  });

  it("resets an incompatible explicit choice and preserves unrelated user input", () => {
    const before = { ...DEFAULT_DATA, deployPlatform: "本地" as const, deliveryTouched: { deployPlatform: true }, name: "Keep me", features: [{ name: "Search" }] };
    const next = updateCreationData(before, { targets: ["wechat-miniprogram"] });
    expect(next.deployPlatform).toBe("auto");
    expect(next.deliveryTouched?.deployPlatform).toBe(false);
    expect(next.name).toBe(before.name);
    expect(next.features).toEqual(before.features);
    expect(before.deployPlatform).toBe("本地");
    expect(deliveryContext(next, true)).not.toContain("部署「本地」");
  });

  it("keeps a compatible explicit service selection when the platform changes", () => {
    const next = updateCreationData({ ...DEFAULT_DATA, deployPlatform: "云端", deliveryTouched: { deployPlatform: true } }, { targets: ["wechat-miniprogram", "web"] });
    expect(next.deployPlatform).toBe("云端");
    expect(next.deliveryTouched?.deployPlatform).toBe(true);
    expect(normalizeCreationData({ ...next, targets: ["web", "web"] }).targets).toEqual(["web"]);
  });

  it("normalizes old mini program drafts and reports the invalidated selection", () => {
    const restored = parseProjectDraft(JSON.stringify({ step: 3, data: { ...DEFAULT_DATA, name: "Mini", targets: ["wechat-miniprogram"], deployPlatform: "本地", deliveryTouched: { deployPlatform: true } } }))!;
    expect(restored.deploymentReset).toBe(true);
    expect(restored.data.deployPlatform).toBe("auto");
    expect(restored.data.deliveryTouched?.deployPlatform).toBe(false);
  });

  it.each(["auto", "client-only", "cloud-dev"] as const)("restores the new %s choice", deployPlatform => {
    const restored = parseProjectDraft(JSON.stringify({ data: { ...DEFAULT_DATA, name: "Mini", targets: ["wechat-miniprogram"], deployPlatform, deliveryTouched: { deployPlatform: true } } }))!;
    expect(restored.data.deployPlatform).toBe(deployPlatform);
    expect(restored.deploymentReset).toBe(false);
    expect(restored.data.deliveryTouched?.deployPlatform).toBe(true);
  });

  it("carries an undecided deployment into initialization without forcing a database", () => {
    const data = { ...DEFAULT_DATA, targets: ["wechat-miniprogram"] };
    const profile = projectProfile(data);
    const prompt = buildInitTriggerPrompt("/project", "context", buildInitInstruction(profile), data.targets, profile);
    expect(prompt).toContain("部署与存储尚未确定");
    expect(prompt).not.toContain("使用 SQLite 本地数据库");
    expect(prompt).not.toContain("使用 PostgreSQL 数据库");
    expect(deliveryContext(data, true)).toEqual([]);
  });

  it("preserves every client contract in mixed-platform initialization", () => {
    const profile = projectProfile({ ...DEFAULT_DATA, targets: ["web", "wechat-miniprogram", "cli", "ios-mobile"] });
    expect(profile.platformSpec).toContain("Web 开发规范");
    expect(profile.platformSpec).toContain("微信小程序开发规范");
    expect(profile.platformSpec).toContain("CLI 工具开发规范");
    expect(profile.platformSpec).toContain("移动端开发规范");
    expect(buildInitInstruction(profile)).toContain("CLI 无界面不影响其他客户端");
  });

  it("keeps offline AI requirements unresolved instead of silently adding a cloud API", () => {
    const data = { ...DEFAULT_DATA, targets: ["wechat-miniprogram"], deployPlatform: "client-only" as const, aiIntegration: "assistant" as const };
    const instruction = buildInitInstruction(projectProfile(data));
    expect(instruction).toContain("无需后端");
    expect(instruction).toContain("先与用户澄清");
    expect(instruction).not.toContain("需集成 LLM API");
  });

  it("uses platform storage for a mobile client with online sync", () => {
    const instruction = buildInitInstruction(projectProfile({ ...DEFAULT_DATA, targets: ["ios-mobile"], deployPlatform: "混合" }));
    expect(instruction).toContain("各平台支持的本地存储");
    expect(instruction).not.toContain("使用 SQLite 本地数据库");
  });
});

it.each([{ targets: ["cli"] }, { targets: ["cli", "web"] }])("keeps hybrid deployment compatible with $targets", ({ targets }) => {
  const data = { ...DEFAULT_DATA, targets, deployPlatform: "混合" as const };
  const profile = projectProfile(data);
  const prompt = buildInitTriggerPrompt("/project", "context", buildInitInstruction(profile), data.targets, profile);
  expect(profile.platformSpec).toContain("CLI 工具开发规范");
  expect(prompt).toContain("命令行工具，无 UI 界面");
  expect(prompt).toContain("本机运行，按需连接云端服务和同步数据");
  expect(prompt).not.toContain("本地运行 UI");
  expect(prompt).not.toContain("云端同步数据和 AI 能力");
  if (targets.includes("web")) expect(profile.platformSpec).toContain("Web 开发规范");
});

it("keeps HarmonyOS in the mobile flow without assuming an iOS/Android toolchain", () => {
  expect(deploymentChoices(["harmony-mobile"])).toEqual(deploymentChoices(["ios-mobile"]));
  const data = updateCreationData(freshCreationData(), { targets: ["ios-mobile", "android-mobile", "harmony-mobile"] });
  expect(data.targets).toEqual(["ios-mobile", "android-mobile", "harmony-mobile"]);
  const profile = projectProfile({ ...data, deployPlatform: "混合" });
  expect(profile.platformSpec).toContain("移动端开发规范");
  expect(profile.platformSpec).toContain("鸿蒙");
  expect(profile.suggestedStack).not.toContain("Flutter");
  expect(profile.initSteps).not.toContain("SQLite + 本地文件");
});

it("starts a new project with three independent blank feature inputs", () => {
  const first = freshCreationData(), second = freshCreationData();
  expect(first.features).toEqual([{ name: "" }, { name: "" }, { name: "" }]);
  first.features[0]!.name = "My feature";
  expect(second.features[0]!.name).toBe("");
  expect(DEFAULT_DATA.features).toEqual([]);
});
