import { getPromptDefaults } from "./system-prompt-manager";
const MINT_DESIGN_BOOST = getPromptDefaults().modes.find(item => item.id === "ui-design")!.prompt;
const DESIGNER_AGENT_PROMPT = getPromptDefaults().legacyDesigner;
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() }, BrowserWindow: { getAllWindows: () => [] } }));
let root: string;
const priorHome = process.env.EASYMINT_HOME, priorPi = process.env.PI_CODING_AGENT_DIR;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "em-ui-guidance-"));
  process.env.EASYMINT_HOME = root;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  fs.mkdirSync(process.env.PI_CODING_AGENT_DIR);
});
afterAll(() => {
  if (priorHome === undefined) delete process.env.EASYMINT_HOME; else process.env.EASYMINT_HOME = priorHome;
  if (priorPi === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = priorPi;
  fs.rmSync(root, { recursive: true, force: true });
});
it("routes enhanced Mint and the seeded Mint-D through the actual SDK skill location and read tool", async () => {
  const [{ AgentService }, { Store }, { seedDefaults, getTemplate }, { saveProjectDesign }, { createPiSession, disposePiSession }] = await Promise.all([
    import("./agent-service"), import("./store"), import("./agent-templates"), import("./project-design"), import("./pi-session"),
  ]);
  const project = path.join(root, "project"); fs.mkdirSync(project);
  saveProjectDesign(project, { styleId: "glass" }, "technical", path.resolve("resources"));
  const store = new Store(root);
  void AgentService;
  const manager = await import("./system-prompt-manager");
  const enhanced = manager.conversationPromptSection(["ui-design"]), standard = manager.conversationPromptSection([]);
  expect(enhanced).toContain(MINT_DESIGN_BOOST);
  expect(standard).not.toContain(MINT_DESIGN_BOOST);
  seedDefaults();
  const designer = getTemplate("mint-designer")!;
  expect(designer.prompt).toBe(DESIGNER_AGENT_PROMPT);
  for (const systemPrompt of [enhanced, designer.prompt]) {
    const session = await createPiSession({ cwd:project,agentDir:process.env.PI_CODING_AGENT_DIR!,store,systemPrompt,permissionMode:"standard",canUseTool:async()=>({behavior:"allow"}) });
    try {
      const skill = session.resourceLoader.getSkills().skills.find(skill=>skill.name==="ui-aesthetic");
      expect(skill).toBeDefined();
      expect(skill!.filePath).toBe(path.resolve("resources/skills/ui-aesthetic/SKILL.md"));
      expect(session.systemPrompt).toContain(skill!.filePath);
      // 公共责任在语言尾段之前注入；分别核对原角色正文与尾段均完整保留。
      const [role, language] = systemPrompt.split("<thinking_language>");
      expect(session.systemPrompt).toContain(role.trimEnd());
      if (language) expect(session.systemPrompt).toContain("<thinking_language>" + language);
      const read = session.agent.state.tools.find(tool=>tool.name==="read")!;
      const content = await read.execute("load-ui-craft",{path:skill!.filePath},new AbortController().signal);
      const body = JSON.stringify(content.content);
      expect(body).toContain("references/style-craft.md");
      expect(fs.existsSync(path.join(skill!.baseDir,"references/style-craft.md"))).toBe(true);
    } finally { await disposePiSession(session); }
  }
}, 20000);
