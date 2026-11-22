vi.mock("../../../shared/windows-sandbox", () => ({ WINDOWS_SANDBOX_ENABLED: true }));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), revoke: vi.fn(), adopt: vi.fn(), create: vi.fn() }));
vi.mock("./manager", () => ({ prepareWindowsSessionSandbox: mocks.prepare }));
vi.mock("./windows-execution-manager", () => ({ revokeWindowsExecutionOwners: mocks.revoke, adoptWindowsWorker: mocks.adopt }));
vi.mock("../permission/execution-context", async importOriginal => {
  const actual = await importOriginal<typeof import("../permission/execution-context")>();
  return { ...actual, createExecutionContext: mocks.create };
});
import { abandonWindowsDraftPrewarm, adoptWindowsDraftPrewarm, cancelAdoptedWindowsDrafts, cancelWindowsDraftPrewarm, commitWindowsDraftPrewarm, startWindowsDraftPrewarm } from "./windows-draft-prewarm";
beforeEach(() => {
  const win = Object.create(process); Object.defineProperty(win, "platform", { value: "win32" }); vi.stubGlobal("process", win);
  mocks.create.mockReset().mockReturnValue({ mode: "standard", workspaceRealPath: "work", runtimeRoot: "runtime", environment: {}, policyVersion: "2" });
  mocks.prepare.mockReset().mockResolvedValue(undefined); mocks.revoke.mockReset().mockResolvedValue(undefined); mocks.adopt.mockReset().mockReturnValue(true);
});
afterEach(() => vi.unstubAllGlobals());
describe("draft session sandbox preparation", () => {
  it("adopts a draft and ignores a late UI cleanup", async () => {
    let finish!: () => void; mocks.prepare.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = startWindowsDraftPrewarm("tab-a", "token-a", "work");
    await vi.waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
    expect(adoptWindowsDraftPrewarm("tab-a", "real-session", "work")).toBe(true);
    const currentOwner = mocks.prepare.mock.calls[0]![3] as () => string; expect(currentOwner()).toBe("real-session");
    await cancelWindowsDraftPrewarm("tab-a", "token-a"); expect(mocks.revoke).not.toHaveBeenCalled();
    commitWindowsDraftPrewarm("tab-a", "real-session"); finish(); await pending;
  });
  it("does not adopt another project and revokes a cancelled draft", async () => {
    const pending = startWindowsDraftPrewarm("tab-b", "token-b", "work"); await pending;
    expect(adoptWindowsDraftPrewarm("tab-b", "real-session", "another")).toBe(false);
    await cancelWindowsDraftPrewarm("tab-b", "token-b"); expect(mocks.revoke).toHaveBeenCalledWith(["draft:tab-b:token-b"]);
  });
  it("cleans an adopted worker when session creation fails", async () => {
    await startWindowsDraftPrewarm("tab-c", "token-c", "work");
    expect(adoptWindowsDraftPrewarm("tab-c", "real-session", "work")).toBe(true);
    await abandonWindowsDraftPrewarm("tab-c", "real-session"); expect(mocks.revoke).toHaveBeenCalledWith(["real-session"]);
  });
  it("cancels an adopted draft that is still preparing when the session changes mode", async () => {
    let finish!: () => void; mocks.prepare.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = startWindowsDraftPrewarm("tab-d", "token-d", "work");
    await vi.waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
    expect(adoptWindowsDraftPrewarm("tab-d", "session-d", "work")).toBe(true);
    commitWindowsDraftPrewarm("tab-d", "session-d");
    const signal = mocks.prepare.mock.calls[0]![1] as AbortSignal;
    const cancelled = cancelAdoptedWindowsDrafts("session-d");
    expect(signal.aborted).toBe(true); expect(mocks.revoke).toHaveBeenCalledWith(["session-d"]);
    finish(); await pending; await cancelled;
  });
  it("does not report a failed cleanup as successful on retries or replacement", async () => {
    await startWindowsDraftPrewarm("tab-failure", "one", "work");
    mocks.revoke.mockRejectedValueOnce(new Error("cleanup failed"));
    await expect(cancelWindowsDraftPrewarm("tab-failure", "one")).rejects.toThrow("cleanup failed");
    await expect(cancelWindowsDraftPrewarm("tab-failure", "one")).rejects.toThrow("cleanup failed");
    await expect(startWindowsDraftPrewarm("tab-failure", "two", "work")).rejects.toThrow("cleanup failed");
    await expect(cancelWindowsDraftPrewarm("tab-failure", "two")).rejects.toThrow("cleanup failed");
  });
});
