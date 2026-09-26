import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "./store";
import { createPiSession, disposePiSession } from "./pi-session";
import { discoverAvailableExtensions, setPiExtensionApproved } from "./pi-extension-service";

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => os.tmpdir() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
}));

const roots: string[] = [];
const originalEmHome = process.env.EASYMINT_HOME;
const originalPiDir = process.env.PI_CODING_AGENT_DIR;
afterEach(() => {
  if (originalEmHome === undefined) delete process.env.EASYMINT_HOME; else process.env.EASYMINT_HOME = originalEmHome;
  if (originalPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = originalPiDir;
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Pi extension session integration", () => {
  it("does not execute native or EM project code before approval, then binds approved extension", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-session-ext-"));
    roots.push(root);
    vi.spyOn(os, "homedir").mockReturnValue(root);
    const emDir = path.join(root, ".easymint");
    const agentDir = path.join(emDir, "agent");
    const cwd = path.join(root, "project");
    process.env.EASYMINT_HOME = emDir;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    fs.mkdirSync(cwd, { recursive: true });
    const nativeExt = path.join(root, ".pi", "agent", "extensions", "native.ts");
    const emExt = path.join(cwd, ".easymint", "extensions", "local.ts");
    fs.mkdirSync(path.dirname(nativeExt), { recursive: true });
    fs.mkdirSync(path.dirname(emExt), { recursive: true });
    const skillDir = path.join(agentDir, "fixture-package", "skills", "fixture-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: fixture-skill\ndescription: fixture\n---\nFixture skill body\n");
    fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ packages: ["./fixture-package", "npm:missing-fixture-package@1.0.0"] }));
    const marker = path.join(root, "loaded.txt");
    fs.writeFileSync(nativeExt, `import fs from 'node:fs'; export default (pi) => { fs.appendFileSync(${JSON.stringify(marker)}, 'native'); pi.on('session_shutdown', () => fs.appendFileSync(${JSON.stringify(marker)}, 's')); pi.registerTool({ name: 'native_tool', label: 'Native', description: 'fixture', parameters: { type: 'object', properties: {} }, execute: async () => ({ content: [{ type: 'text', text: 'ok' }], details: undefined }) }); };`);
    fs.writeFileSync(emExt, `import fs from 'node:fs'; export default () => fs.appendFileSync(${JSON.stringify(marker)}, 'em');`);
    const store = new Store(emDir);
    const first = await createPiSession({ cwd, agentDir, store });
    expect(first.resourceLoader.getSkills().skills.some((skill) => skill.name === "fixture-skill")).toBe(true);
    await disposePiSession(first);
    expect(fs.existsSync(marker)).toBe(false);
    expect(fs.existsSync(path.join(agentDir, "npm", "node_modules", "missing-fixture-package"))).toBe(false);
    const native = (await discoverAvailableExtensions({ projectPath: cwd, settingsDir: emDir })).find((item) => item.name === "native")!;
    await setPiExtensionApproved(native.id, native.fingerprint, true, { projectPath: cwd, settingsDir: emDir });
    const standard = await createPiSession({ cwd, agentDir, store, permissionMode: "standard" });
    expect(fs.existsSync(marker)).toBe(false);
    await disposePiSession(standard);
    let liveMode = "full";
    const second = await createPiSession({ cwd, agentDir, store, permissionMode: "full", getPermissionMode: () => liveMode,
      canUseTool: async () => ({ behavior: "deny", message: "extension tool denied" }) });
    const guard = await second.agent.beforeToolCall!({ toolCall: { id: "call-1", name: "plugin_tool", arguments: {} }, args: {} } as never);
    expect(guard).toMatchObject({ block: true, reason: "extension tool denied" });
    liveMode = "standard";
    const downgraded = await second.agent.beforeToolCall!({ toolCall: { id: "call-2", name: "native_tool", arguments: {} }, args: {} } as never);
    expect(downgraded).toMatchObject({ block: true, reason: "Pi 扩展工具仅在完全访问模式可用" });
    expect(second.agent.state.tools.some((tool) => tool.name === "native_tool")).toBe(true);
    await disposePiSession(second);
    expect(fs.readFileSync(marker, "utf8")).toBe("natives");
    expect((await discoverAvailableExtensions({ projectPath: cwd, settingsDir: emDir })).find((item) => item.name === "native")?.tools).toBe(1);
    fs.writeFileSync(nativeExt, fs.readFileSync(nativeExt, "utf8").replace("native_tool", "native_tool_v2"));
    const updated = (await discoverAvailableExtensions({ projectPath: cwd, settingsDir: emDir })).find((item) => item.name === "native")!;
    expect(updated.status).toBe("pending");
    await setPiExtensionApproved(updated.id, updated.fingerprint, true, { projectPath: cwd, settingsDir: emDir });
    const third = await createPiSession({ cwd, agentDir, store, permissionMode: "full" });
    expect(third.agent.state.tools.some((tool) => tool.name === "native_tool_v2")).toBe(true);
    expect(third.agent.state.tools.some((tool) => tool.name === "native_tool")).toBe(false);
    await disposePiSession(third);
  }, 30000);
});
