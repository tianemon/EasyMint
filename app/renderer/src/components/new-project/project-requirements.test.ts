import { expect, it, vi } from "vitest";
vi.mock("../../stores/settings-store", () => ({ useSettingsStore: { getState: () => ({ defaultProjectDir: "/projects" }) } }));
const { DEFAULT_DATA } = await import("./ProjectFormTypes");
const { deliveryContext, projectProfile } = await import("./project-requirements");
const { parseProjectDraft } = await import("./project-draft");
const { buildInitInstruction, buildInitTriggerPrompt } = await import("../../../../shared/prompts");

it("preserves explicit delivery choices, including a user choosing default values", () => {
  expect(deliveryContext(DEFAULT_DATA, true)).toEqual([]);
  const data = { ...DEFAULT_DATA, completeness: "full" as const, deployPlatform: "云端" as const, aiIntegration: "multi-agent" as const, techBudget: "免费" as const };
  expect(deliveryContext(data, true)).toEqual(["完成度「full」", "部署「云端服务」", "AI 集成「多 Agent 协作」", "预算「免费」"]);
  expect(deliveryContext({ ...DEFAULT_DATA, deliveryTouched: { completeness: true, deployPlatform: true, aiIntegration: true, techBudget: true } }, true)).toHaveLength(4);
});
it("recovers explicit defaults and older non-default choices from editable drafts", () => {
  const restored = parseProjectDraft(JSON.stringify({ data: { ...DEFAULT_DATA, name: "Project", deployPlatform: "本地", techBudget: "免费", deliveryTouched: { deployPlatform: true, unknown: true } } }))!.data;
  expect(restored.deliveryTouched).toEqual({ deployPlatform: true, techBudget: true });
  expect(deliveryContext(restored, true)).toEqual(["部署「本地」", "预算「免费」"]);
});
it.each(["本地", "云端", "混合"] as const)("uses the selected %s profile throughout initialization", deployPlatform => {
  const data = { ...DEFAULT_DATA, deployPlatform, aiIntegration: "agent" as const };
  const profile = projectProfile(data);
  const prompt = buildInitTriggerPrompt("/project", "context", buildInitInstruction(profile), data.targets, profile);
  expect(prompt).toContain("Agent");
  if (deployPlatform === "云端") {
    expect(prompt).toContain("PostgreSQL");
    expect(prompt).not.toContain("SQLite");
    expect(prompt).not.toContain("本地运行，无需云端部署");
  } else if (deployPlatform === "混合") {
    expect(prompt).toContain("本地部分：SQLite");
    expect(prompt).toContain("云端部分：API 服务");
  } else {
    expect(prompt).toContain("SQLite");
    expect(prompt).not.toContain("PostgreSQL");
  }
});
