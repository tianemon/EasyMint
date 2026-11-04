import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelRuntime, type AgentSession } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createPiSession, resumePiSession, disposePiSession } from "./pi-session";
import { getModelRuntime } from "./pi-init";
import { Store } from "./store";
import { AGENT_DELIVERY_RULES } from "./agent-context-rules";
import { BUILDER_AGENT_PROMPT, EVALUATOR_AGENT_PROMPT, DESIGNER_AGENT_PROMPT, MINT_SYSTEM_PROMPT, THINKING_LANGUAGE_PROMPT } from "../../shared/prompts";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() }, BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null } }));
vi.mock("./pi-init", async original => ({ ...await original<object>(), getModelRuntime: vi.fn() }));
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
  return { root, cwd, faux, opts, async create(systemPrompt?: string) {
    const session = await createPiSession({ ...opts, systemPrompt }); sessions.push(session); return session;
  } };
}

// Production create/resume + real SDK transport; scripted provider proves delivery, not model judgment.
describe("delivery rules in production sessions", () => {
  it.each([
    ["mint", MINT_SYSTEM_PROMPT], ["builder", BUILDER_AGENT_PROMPT], ["evaluator", EVALUATOR_AGENT_PROMPT],
    ["designer", DESIGNER_AGENT_PROMPT], ["custom", "CUSTOM_ROLE"], ["no-template", undefined],
  ])("%s receives one responsibility block without project files or skills", async (_role, base) => {
    const env = await setup();
    const session = await env.create(base);
    const prompt = session.systemPrompt;
    expect(prompt.split(AGENT_DELIVERY_RULES)).toHaveLength(2);
    if (base) expect(prompt).toContain(base);
    else expect(prompt).toContain("You are a coding assistant running inside pi");
    expect(session.resourceLoader.getAgentsFiles().agentsFiles).toEqual([]);
    expect(fs.readdirSync(env.cwd)).toEqual([]);
  });

  it.each([
    [{ "AGENTS.md": "" , "CLAUDE.md": "TEAM_RULE" }, ["TEAM_RULE"]],
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

  it("sends the block once across a tool turn and disk resume, preserving the language tail", async () => {
    const env = await setup({ "AGENTS.md": "USE_PNPM", "CLAUDE.md": "TEAM_RULE" });
    const requests: string[] = [];
    env.faux.setResponses([
      ctx => { requests.push(JSON.stringify(ctx.messages)); return fauxAssistantMessage(fauxToolCall("read", { path: "AGENTS.md" }), { stopReason: "toolUse" }); },
      ctx => { requests.push(JSON.stringify(ctx.messages)); return fauxAssistantMessage("fixture read complete"); },
      ctx => { requests.push(JSON.stringify(ctx.messages)); return fauxAssistantMessage("fixture resumed"); },
    ]);
    const base = `CUSTOM_ROLE\n\n${THINKING_LANGUAGE_PROMPT}`;
    const first = await env.create(base);
    expect(first.resourceLoader.getSystemPrompt()?.endsWith(THINKING_LANGUAGE_PROMPT)).toBe(true);
    await first.prompt("Read the existing project rule");
    const resumeSessionFile = first.sessionFile!;
    await disposePiSession(first);
    const resumed = await resumePiSession({ ...env.opts, systemPrompt: base, resumeSessionFile }); sessions.push(resumed);
    await resumed.prompt("Continue");
    expect(requests).toHaveLength(3);
    for (const prompt of requests) {
      expect(prompt.split(JSON.stringify(AGENT_DELIVERY_RULES).slice(1, -1))).toHaveLength(2);
      expect(prompt).toContain("CUSTOM_ROLE");
      expect(prompt).toContain("USE_PNPM");
      expect(prompt).toContain("TEAM_RULE");
    }
  });
});
