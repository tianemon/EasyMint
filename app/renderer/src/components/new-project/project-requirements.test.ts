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
it.each(["本地", "云端", "混合"] as const)("keeps %s deployment separate from storage and authentication requirements", deployPlatform => {
  const data = { ...DEFAULT_DATA, deployPlatform, aiIntegration: "agent" as const };
  const profile = projectProfile(data);
  const prompt = buildInitTriggerPrompt("/project", "context", buildInitInstruction(profile), data.targets, profile);
  expect(prompt).toContain("Agent");
  expect(prompt).not.toContain("docs/技术架构.md");
  expect(prompt).not.toContain("使用 PostgreSQL 数据库");
  expect(prompt).not.toContain("使用 SQLite 本地数据库");
  expect(prompt).not.toContain("云端部分：API 服务 + 数据库 + 认证");
  if (deployPlatform === "云端") expect(prompt).toContain("先判断静态托管");
  if (deployPlatform === "混合") expect(prompt).toContain("不因混合部署一并创建");
  if (deployPlatform === "本地") expect(prompt).toContain("有持久化需求时");
});

it("does not turn an online static page into a database-backed authenticated service", () => {
  const data = { ...DEFAULT_DATA, name: "静态作品展示", description: "单文件静态页，无需数据库或登录", deployPlatform: "云端" as const };
  const profile=projectProfile(data),instruction=buildInitInstruction(profile);
  expect(instruction).toContain("静态托管");
  expect(instruction).not.toContain("数据库使用云数据库");
  expect(instruction).not.toContain("docs/");
  expect(instruction).toContain("不为极简项目补建架构文档");
  expect(profile.platformSpec).not.toContain("需有 ErrorBoundary");
  expect(profile.platformSpec).toContain("不为静态页面引入组件框架");
});

it("retains an explicitly requested database without inferring one from deployment",async()=>{
  const {composeProfile}=await import("../../../../shared/prompts");
  const explicit={product:"web" as const,deploy:"cloud" as const,ai:"none" as const,storage:"postgres" as const,productUsesAI:false,needsAuth:false,needsPayment:false};
  expect(buildInitInstruction(composeProfile(explicit))).toContain("使用 PostgreSQL 数据库");
  expect(buildInitInstruction(composeProfile({...explicit,product:"cli",deploy:"local",storage:"sqlite"}))).toContain("使用 SQLite 本地数据库");
});
