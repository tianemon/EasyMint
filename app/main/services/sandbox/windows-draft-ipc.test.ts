vi.mock("../../../shared/windows-sandbox", () => ({ WINDOWS_SANDBOX_ENABLED: true }));
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ start: vi.fn(), cancel: vi.fn(), close: vi.fn() }));
vi.mock("./windows-draft-prewarm", () => ({ startWindowsDraftPrewarm: mocks.start, cancelWindowsDraftPrewarm: mocks.cancel, cancelWindowsDraftsForWindow: mocks.close, windowsDraftKey: (id: number, tab: string) => `${id}:${tab}` }));
import { createWindowsDraftHandlers } from "./windows-draft-ipc";
let root: string; let destroyed: () => void; let savedMode: string; let active: boolean; let blank: boolean;
const sender = { id: 42, isDestroyed: () => false, send: vi.fn(), once: (_event: "destroyed", fn: () => void) => { destroyed = fn; } };
const handlers = createWindowsDraftHandlers({ projectRootContaining: candidate => candidate === root ? root : null, deferProjectPrewarm: () => blank, defaultMode: () => savedMode, sessionMode: () => savedMode, hasSessionPrewarm: () => active });
beforeEach(() => {
  const win = Object.create(process); Object.defineProperty(win, "platform", { value: "win32" }); vi.stubGlobal("process", win);
  root = fs.mkdtempSync(path.join(os.tmpdir(), "em-sandbox-ipc-")); savedMode = "standard"; active = false; blank = false;
  mocks.start.mockReset().mockResolvedValue(undefined); mocks.cancel.mockReset().mockResolvedValue(undefined); mocks.close.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); vi.unstubAllGlobals(); });
const input = () => ({ projectPath: root, tabId: "tab", token: "token", mode: "standard" });
it("never starts a project ACL worker for a blank-project tab", async () => {
  blank = true;
  expect(await handlers.prepare(sender, input())).toEqual({ state: "skipped" });
  expect(mocks.start).not.toHaveBeenCalled();
});
it("skips a stale standard UI when saved mode is full or readonly", async () => {
  for (const mode of ["full", "readonly"]) { savedMode = mode; expect(await handlers.prepare(sender, input())).toEqual({ state: "skipped" }); }
  expect(mocks.start).not.toHaveBeenCalled();
});
it("starts only for the registered project and scopes cleanup to the sending window", async () => {
  expect(await handlers.prepare(sender, input())).toEqual({ state: "ready" });
  expect(mocks.start).toHaveBeenCalledWith("42:tab", "token", root, expect.any(Function));
  await handlers.cancel(sender, input()); expect(mocks.cancel).toHaveBeenCalledWith("42:tab", "token");
  destroyed(); expect(mocks.close).toHaveBeenCalledWith(42);
  await expect(handlers.prepare(sender, { ...input(), projectPath: path.join(root, "outside") })).rejects.toThrow("项目目录不可用");
});
it("does not create a second draft when the session already has a prewarm", async () => {
  active = true; expect(await handlers.prepare(sender, { ...input(), sessionId: "session" })).toEqual({ state: "skipped" });
  expect(mocks.start).not.toHaveBeenCalled();
});
it("reports preparation failure and distinguishes cancellation", async () => {
  mocks.start.mockRejectedValueOnce(new Error("fixture failure"));
  expect(await handlers.prepare(sender, input())).toEqual({ state: "failed", error: "fixture failure" });
  mocks.start.mockRejectedValueOnce(new DOMException("cancelled", "AbortError"));
  expect(await handlers.prepare(sender, input())).toEqual({ state: "cancelled" });
});
it("rejects tab or token delimiters that could corrupt worker ownership", async () => {
  await expect(handlers.prepare(sender, { ...input(), tabId: "tab\u0000other" })).rejects.toThrow();
  await expect(handlers.cancel(sender, { tabId: "tab", token: "token\u0000other" })).rejects.toThrow();
  expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
});
