import {getCurrentSystemPrompt} from "@earendil-works/pi-ai";
import {markProjectRuleChanged} from "./project-rule-files";
import { getPromptDefaults } from "./system-prompt-manager";
const MINT_SYSTEM_PROMPT = getPromptDefaults().main.rules;
const BUILDER_AGENT_PROMPT = getPromptDefaults().templates.find(item => item.id === "default-builder")!.prompt;
const EVALUATOR_AGENT_PROMPT = getPromptDefaults().templates.find(item => item.id === "default-evaluator")!.prompt;
const DESIGNER_AGENT_PROMPT = getPromptDefaults().legacyDesigner;
const THINKING_LANGUAGE_PROMPT = "<thinking_language>USER_CUSTOM_LANGUAGE_HINT</thinking_language>";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelRuntime, type AgentSession } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createPiSession, resumePiSession, disposePiSession } from "./pi-session";
import { getModelRuntime } from "./pi-init";
import { Store } from "./store";
import { getAgentDeliveryRules } from "./agent-context-rules";
import type { AgentDeliveryMode } from "./agent-context-rules";


vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() }, BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null } }));
vi.mock("./pi-init", async original => ({ ...await original<object>(), getModelRuntime: vi.fn() }));
const AGENT_DELIVERY_RULES = getAgentDeliveryRules();
const roots: string[] = [], sessions: AgentSession[] = [];
const priorHome = process.env.EASYMINT_HOME, priorPi = process.env.PI_CODING_AGENT_DIR;
afterEach(async () => {
  await Promise.all(sessions.splice(0).map(disposePiSession));
  vi.restoreAllMocks();
  if (priorHome === undefined) delete process.env.EASYMINT_HOME; else process.env.EASYMINT_HOME = priorHome;
  if (priorPi === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = priorPi;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function setup(files: Record<string, string> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-delivery-session-")); roots.push(root);
  const cwd = path.join(root, "project"), agentDir = path.join(root, "agent");
  fs.mkdirSync(cwd); fs.mkdirSync(agentDir);
  process.env.EASYMINT_HOME = root; process.env.PI_CODING_AGENT_DIR = agentDir;
  vi.spyOn(os, "homedir").mockReturnValue(root);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(cwd, name), content);
  const runtime = await ModelRuntime.create({ modelsPath: null, authPath: path.join(root, "auth.json"), allowModelNetwork: false });
  const faux = fauxProvider({ provider: "delivery-fixture", models: [{ id: "fixture" }], tokensPerSecond: 0 });
  runtime.registerNativeProvider(faux.provider); await runtime.refresh({ allowNetwork: false });
  vi.mocked(getModelRuntime).mockResolvedValue(runtime);
  const opts = { cwd, agentDir, store: new Store(root), model: runtime.getModel("delivery-fixture", "fixture")!, permissionMode: "readonly" };
  return { root, cwd, faux, opts, async create(systemPrompt?: string, deliveryMode: AgentDeliveryMode = "conversation") {
    const session = await createPiSession({ ...opts, systemPrompt, deliveryMode }); sessions.push(session); return session;
  } };
}

// Production create/resume + real SDK transport; scripted provider proves delivery, not model judgment.
describe("delivery rules in production sessions", () => {
  it.each([
    ["mint", MINT_SYSTEM_PROMPT, "conversation"], ["builder", BUILDER_AGENT_PROMPT, "task"], ["evaluator", EVALUATOR_AGENT_PROMPT, "task"],
    ["designer", DESIGNER_AGENT_PROMPT, "task"], ["custom-main", "CUSTOM_ROLE", "conversation"], ["custom-task", "CUSTOM_ROLE", "task"],
    ["no-template-main", undefined, "conversation"], ["no-template-task", undefined, "task"],
  ] as const)("%s receives one responsibility block without project files or skills", async (_role, base, mode) => {
    const env = await setup();
    const session = await env.create(base, mode);
    const prompt = session.systemPrompt;
    expect(prompt.split(getAgentDeliveryRules(mode))).toHaveLength(2);
    expect(prompt.split("<easymint_delivery_rules>")).toHaveLength(2);
    if (base) expect(prompt).toContain(base);
    else expect(prompt).toContain("You are a coding assistant running inside pi");
    expect(session.resourceLoader.getAgentsFiles().agentsFiles).toEqual([]);
    expect(fs.readdirSync(env.cwd)).toEqual([]);
  });

  it.each([
    [{ "AGENTS.md": "" , "CLAUDE.md": "TEAM_RULE" }, []],
    [{ "AGENTS.md": "USE_PNPM" }, ["USE_PNPM"]],
    [{ "CLAUDE.md": "CLAUDE_ONLY" }, ["CLAUDE_ONLY"]],
    [{ "AGENTS.override.md": "OVERRIDE", "AGENTS.md": "IGNORED", "CLAUDE.md": "IGNORED" }, ["OVERRIDE"]],
  ] as [Record<string, string>, string[]][])("loads applicable rules while keeping responsibility: %j", async (files, expected) => {
    const env = await setup(files);
    const session = await env.create("CUSTOM_ROLE");
    expect(session.systemPrompt).toContain(AGENT_DELIVERY_RULES);
    for (const marker of expected) expect(session.systemPrompt).toContain(marker);
    expect(session.systemPrompt).not.toContain("IGNORED");
    expect(fs.readdirSync(env.cwd).sort()).toEqual(Object.keys(files).sort());
  });

  it.each(["conversation", "task"] as const)("sends %s rules once across a tool turn and disk resume, preserving the complete editable body", async mode => {
    const env = await setup({ "AGENTS.md": "USE_PNPM", "CLAUDE.md": "TEAM_RULE" });
    const requests: string[] = [];
    env.faux.setResponses([
      ctx => { requests.push(JSON.stringify(ctx.messages)); return fauxAssistantMessage(fauxToolCall("read", { path: "AGENTS.md" }), { stopReason: "toolUse" }); },
      ctx => { requests.push(JSON.stringify(ctx.messages)); return fauxAssistantMessage("fixture read complete"); },
      ctx => { requests.push(JSON.stringify(ctx.messages)); return fauxAssistantMessage("fixture resumed"); },
    ]);
    const base = `CUSTOM_ROLE\n\n${THINKING_LANGUAGE_PROMPT}`;
    const first = await env.create(base, mode);
    expect(first.resourceLoader.getSystemPrompt()).toContain(base);
    await first.prompt("Read the existing project rule");
    const resumeSessionFile = first.sessionFile!;
    await disposePiSession(first);
    const resumed = await resumePiSession({ ...env.opts, systemPrompt: base, resumeSessionFile, deliveryMode: mode }); sessions.push(resumed);
    await resumed.prompt("Continue");
    expect(requests).toHaveLength(3);
    for (const prompt of requests) {
      expect(prompt.split(JSON.stringify(getAgentDeliveryRules(mode)).slice(1, -1))).toHaveLength(2);
      expect(prompt).toContain("CUSTOM_ROLE");
      expect(prompt).toContain("USE_PNPM");
      expect(prompt).not.toContain("TEAM_RULE");
    }
  });

  it.each([[undefined, "conversation"], ["CUSTOM_ROLE", "conversation"], [undefined, "task"], ["CUSTOM_ROLE", "task"]] as const)("keeps the session usable with base %s and %s responsibilities", async (base, mode) => {
    const env = await setup({ "AGENTS.md": "UNREADABLE_RULE" });
    const read = fs.readFileSync;
    vi.spyOn(fs, "readFileSync").mockImplementation((...args: Parameters<typeof fs.readFileSync>) => {
      if (String(args[0]).toLowerCase() === path.join(fs.realpathSync(env.cwd), "AGENTS.md").toLowerCase()) throw Object.assign(new Error("fixture denied"), { code: "EACCES" });
      return read(...args);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const session = await env.create(base, mode);
    expect(session.systemPrompt).not.toContain("UNREADABLE_RULE");
    expect(session.systemPrompt).toContain("EACCES");
    expect(session.systemPrompt).toContain("不得声称已读这些文件");
    expect(session.systemPrompt.split("<easymint_rule_loading>")).toHaveLength(2);
    expect(session.systemPrompt.split(getAgentDeliveryRules(mode))).toHaveLength(2);
    expect(warn).toHaveBeenCalledOnce();
  });
  it("refreshes controlled rule edits and explicit reloads without reloading the SDK session",async()=>{
    const env=await setup({"AGENTS.md":"ORIGINAL_RULE"}),requests:string[]=[];
    env.faux.setResponses(Array.from({length:4},()=>ctx=>{requests.push(getCurrentSystemPrompt(ctx.messages));return fauxAssistantMessage("DONE");}));
    const session=await env.create("ROLE");const reload=vi.spyOn(session,"reload");
    await session.prompt("first");
    fs.writeFileSync(path.join(env.cwd,"AGENTS.md"),"CONTROLLED_RULE");markProjectRuleChanged(path.join(env.cwd,"AGENTS.md"));await session.prompt("second");
    fs.writeFileSync(path.join(env.cwd,"AGENTS.override.md"),"NEW_OVERRIDE");await session.prompt("重新读取项目规则");
    fs.unlinkSync(path.join(env.cwd,"AGENTS.override.md"));fs.writeFileSync(path.join(env.cwd,"AGENTS.md"),"");markProjectRuleChanged(path.join(env.cwd,"AGENTS.md"));await session.prompt("last");
    expect(requests[0]).toContain("ORIGINAL_RULE");expect(requests[1]).toContain("CONTROLLED_RULE");expect(requests[2]).toContain("NEW_OVERRIDE");expect(requests[2]).not.toContain("CONTROLLED_RULE");expect(requests[3]).not.toContain("NEW_OVERRIDE");expect(reload).not.toHaveBeenCalled();
  });

});
