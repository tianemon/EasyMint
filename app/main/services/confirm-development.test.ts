import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
const { broadcast } = vi.hoisted(() => ({ broadcast: vi.fn() }));
vi.mock("./ipc-broadcast", () => ({ broadcast }));
vi.mock("./pi-sdk", () => ({ getDefineToolFn: async () => (tool: unknown) => tool }));
vi.mock("./project-design-tool", () => ({ createProjectDesignTool: async () => ({ name: "set_project_design" }) }));
import { createProductTools } from "./builtin-mcp";
let root = "";
afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); root = ""; vi.clearAllMocks(); });
async function setup(getSessionId?: () => string) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "em-confirm-dev-"));
  const tools = await createProductTools(root, getSessionId);
  return tools.find(tool => tool.name === "show_confirm_dev")!;
}
it("resolves the real session lazily and broadcasts only after project prerequisites exist", async () => {
  let sessionId = "temporary";
  const tool = await setup(() => sessionId);
  await expect(tool.execute("missing", {}, new AbortController().signal, undefined, {} as never)).rejects.toThrow("task.json");
  expect(broadcast).not.toHaveBeenCalled();
  fs.writeFileSync(path.join(root, "README.md"), "readme"); fs.writeFileSync(path.join(root, "AGENTS.md"), "rules");
  fs.writeFileSync(path.join(root, "task.json"), JSON.stringify({ tasks: [] }));
  await expect(tool.execute("empty", {}, new AbortController().signal, undefined, {} as never)).rejects.toThrow("至少一个任务");
  fs.writeFileSync(path.join(root, "task.json"), JSON.stringify({ tasks: [{ id: 1, title: "Implement" }] }));
  sessionId = "real-session";
  await tool.execute("ready", {}, new AbortController().signal, undefined, {} as never);
  expect(broadcast).toHaveBeenCalledExactlyOnceWith("agent:confirm-dev", { projectPath: root, sessionId: "real-session" });
});
it("does not emit an unscoped request without a session owner", async () => {
  const tool = await setup();
  await expect(tool.execute("unowned", {}, new AbortController().signal, undefined, {} as never)).rejects.toThrow("项目会话");
  expect(broadcast).not.toHaveBeenCalled();
});
