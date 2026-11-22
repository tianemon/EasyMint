import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ adopt: vi.fn(), commit: vi.fn(), abandon: vi.fn(), mcp: vi.fn(), disposeMcp: vi.fn(), start: vi.fn(), stop: vi.fn() }));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));
vi.mock("./sandbox/windows-draft-prewarm", () => ({ adoptWindowsDraftPrewarm: mocks.adopt, commitWindowsDraftPrewarm: mocks.commit, abandonWindowsDraftPrewarm: mocks.abandon }));
vi.mock("./sandbox/windows-session-prewarm", () => ({ startWindowsSessionPrewarm: mocks.start, stopWindowsSessionPrewarm: mocks.stop }));
vi.mock("./mcp-runtime", () => ({ createMcpSessionExtensions: mocks.mcp, disposeMcpSession: mocks.disposeMcp }));
import { createPiSession, disposePiSession } from "./pi-session";
import { Store } from "./store";

const roots: string[] = [];
const originalHome = process.env.EASYMINT_HOME, originalPi = process.env.PI_CODING_AGENT_DIR;
beforeEach(() => { mocks.adopt.mockReset().mockReturnValue(true); mocks.commit.mockReset(); mocks.abandon.mockReset().mockResolvedValue(undefined); mocks.mcp.mockReset().mockResolvedValue([]); mocks.disposeMcp.mockReset().mockResolvedValue(undefined); mocks.start.mockReset(); mocks.stop.mockReset().mockResolvedValue(undefined); });
afterEach(() => { if (originalHome === undefined) delete process.env.EASYMINT_HOME; else process.env.EASYMINT_HOME = originalHome; if (originalPi === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = originalPi; for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-sandbox-adopt-")); roots.push(root);
  const cwd = path.join(root, "project"), em = path.join(root, "em"), agentDir = path.join(em, "agent"); fs.mkdirSync(cwd);
  process.env.EASYMINT_HOME = em; process.env.PI_CODING_AGENT_DIR = agentDir;
  return { cwd, agentDir, store: new Store(em), permissionMode: "standard", sandboxDraftKey: "window:tab", canUseTool: async () => ({ behavior: "allow" as const, updatedInput: {} }) };
}
it("adopts the draft before creating MCP connections, and commits it to the real session", async () => {
  const f = fixture(); const session = await createPiSession(f);
  expect(mocks.adopt).toHaveBeenCalledWith("window:tab", session.sessionId, fs.realpathSync.native(f.cwd));
  expect(mocks.adopt.mock.invocationCallOrder[0]).toBeLessThan(mocks.mcp.mock.invocationCallOrder[0]!);
  expect(mocks.commit).toHaveBeenCalledWith("window:tab", session.sessionId);
  expect(mocks.start).toHaveBeenCalled(); await disposePiSession(session); expect(mocks.stop).toHaveBeenCalledWith(session);
});
it("abandons an adopted worker when session creation fails", async () => {
  const f = fixture(); mocks.mcp.mockRejectedValueOnce(new Error("fixture failure"));
  await expect(createPiSession(f)).rejects.toThrow("fixture failure");
  expect(mocks.abandon).toHaveBeenCalledWith("window:tab", mocks.adopt.mock.calls[0]![1]);
  expect(mocks.commit).not.toHaveBeenCalled();
});
it("does not adopt a standard draft for a full-access session", async () => {
  const f = fixture(); const session = await createPiSession({ ...f, permissionMode: "full" });
  expect(mocks.adopt).not.toHaveBeenCalled(); await disposePiSession(session);
});
