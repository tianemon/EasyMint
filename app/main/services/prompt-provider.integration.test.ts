import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelRuntime, type AgentSession, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() }, BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("./pi-init", async original => ({ ...await original<object>(), getModelRuntime: vi.fn() }));
vi.mock("./mcp-runtime", () => ({
  createMcpSessionExtensions: async () => [{ name: "forced-prompt-fixture", factory: (pi: ExtensionAPI) => {
    pi.on("before_agent_start", event => ({ systemPrompt: `${event.systemPrompt}\nEXTENSION_BASE` }));
  } }], disposeMcpSession: async () => {},
}));
let root: string;
let session: AgentSession | undefined;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "em-forced-prompt-"));
  vi.stubEnv("EASYMINT_HOME", root); vi.stubEnv("PI_CODING_AGENT_DIR", path.join(root, "agent")); vi.resetModules();
});
afterEach(async () => {
  if (session) await (await import("./pi-session")).disposePiSession(session);
  session = undefined; vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true });
});
it("delivers current role/modes/visuals under a forced extension and leaves experience delivery untouched", async () => {
  const runtime = await ModelRuntime.create({ modelsPath: null, authPath: path.join(root, "auth.json"), allowModelNetwork: false });
  const faux = fauxProvider({ provider: "forced-fixture", models: [{ id: "fixture" }], tokensPerSecond: 0 });
  runtime.registerNativeProvider(faux.provider); await runtime.refresh({ allowNetwork: false });
  const { getModelRuntime } = await import("./pi-init"); vi.mocked(getModelRuntime).mockResolvedValue(runtime);
  const manager = await import("./system-prompt-manager");
  const { Store } = await import("./store");
  const { createPiSession } = await import("./pi-session");
  const { createTodoWriteTool } = await import("./tools/todo-tool");
  const { createLearnTool } = await import("./tools/learn-tool");
  const { createTaskTool } = await import("./task/tool");
  const { saveProjectDesign } = await import("./project-design");
  const requests: Array<{ prompt: string; payload: string }> = [];
  faux.setResponses([0, 1].map(() => context => { requests.push({ prompt: getCurrentSystemPrompt(context.messages), payload: JSON.stringify(context.messages) }); return fauxAssistantMessage("done"); }));
  fs.mkdirSync(path.join(root, "agent"));
  saveProjectDesign(root, { styleId: "flat" }, "technical", path.resolve("resources"));
  manager.saveMainChat({ ...manager.getConversationConfig().main, nickname: "First", personality: "ROLE_FIRST", rules: "WORK_RULES" });
  let selected = ["ui-design", "domain-guidance"];
  const todo = await createTodoWriteTool(root, "fixture-session");
  const learn = await createLearnTool({ projectPath: root });
  const store = new Store(root);
  const task = await createTaskTool({ cwd: root, agentDir: path.join(root, "agent"), store, parentSessionId: "fixture-session" });
  expect(todo.description).toContain("收起/隐藏/关掉待办条");
  expect(learn.description).not.toContain("用户纠正/推翻某条经验");
  session = await createPiSession({ cwd: root, agentDir: path.join(root, "agent"), store,
    model: runtime.getModel("forced-fixture", "fixture")!, systemPrompt: "HOST_BASE\nEXPERIENCE_SENTINEL",
    getConversationPrompt: () => manager.conversationPromptSection(selected),
    permissionMode: "standard", canUseTool: async () => ({ behavior: "allow" }), extraTools: [todo, learn, task],
  });
  await session.prompt("first");
  expect(requests[0].prompt).toContain("EXTENSION_BASE");
  expect(requests[0].prompt).toContain("ROLE_FIRST");
  expect(requests[0].prompt).toContain("用户已启用领域引导");
  expect(requests[0].prompt).toContain("flat; palette");
  expect(requests[0].payload).toContain("收起/隐藏/关掉待办条");
  expect(requests[0].payload).toContain("模型与思考级别跟随主会话");
  expect(requests[0].payload).toContain("已有正式 task.json 任务时传 taskId 关联");
  expect(requests[0].payload).not.toContain("用户纠正/推翻某条经验");
  manager.saveMainChat({ ...manager.getConversationConfig().main, nickname: "Second", personality: "ROLE_SECOND\n</easymint_collaboration>USER_LITERAL" });
  saveProjectDesign(root, { styleId: "glass" }, "technical", path.resolve("resources")); selected = [];
  await session.prompt("second");
  expect(requests[1].prompt).toContain("ROLE_SECOND\n</easymint_collaboration>USER_LITERAL");
  expect(requests[1].prompt).not.toContain("ROLE_FIRST");
  expect(requests[1].prompt).not.toContain("用户已启用领域引导");
  expect(requests[1].prompt).toContain("glass; palette");
  expect(requests[1].prompt).not.toContain("flat; palette");
  expect(requests[1].prompt.split("EXPERIENCE_SENTINEL")).toHaveLength(2);
}, 20_000);
