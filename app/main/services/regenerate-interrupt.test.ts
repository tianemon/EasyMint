import { afterEach, describe, expect, it } from "vitest";
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("重新生成后无回答即打断", () => {
  it("磁盘当前分支保留重发的提问，不恢复旧回答", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "em-regen-interrupt-"));
    dirs.push(dir);
    const mgr = SessionManager.create(dir, dir);
    const oldQuestion = mgr.appendMessage({ role: "user", content: "原提问", timestamp: Date.now() });
    const oldAnswer = mgr.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "旧回答" }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "test",
      usage: {
        input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    const { session } = await createAgentSession({
      cwd: dir,
      agentDir: path.join(dir, "agent"),
      sessionManager: mgr,
      noTools: "all",
    });

    await session.navigateTree(oldQuestion, { summarize: false });
    mgr.appendCustomEntry("em_rewind_pin", { leaf: oldQuestion });
    const newQuestion = mgr.appendMessage({ role: "user", content: "原提问", timestamp: Date.now() });
    session.dispose();

    const reopened = SessionManager.open(mgr.getSessionFile()!, dir, dir);
    const branch = new Set(reopened.getBranch().map((entry) => entry.id));
    expect(branch.has(oldQuestion)).toBe(false);
    expect(branch.has(oldAnswer)).toBe(false);
    expect(branch.has(newQuestion)).toBe(true);
  });

  it("新会话第一条消息从根节点撤回后，重开也不复活", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "em-first-interrupt-"));
    dirs.push(dir);
    const mgr = SessionManager.create(dir, dir);
    const question = mgr.appendMessage({ role: "user", content: "尚未回答的首问", timestamp: Date.now() });
    mgr.resetLeaf();
    mgr.appendCustomEntry("em_rewind_pin", { leaf: null });

    const reopened = SessionManager.open(mgr.getSessionFile()!, dir, dir);
    expect(reopened.getBranch().some((entry) => entry.id === question)).toBe(false);
  });
});
