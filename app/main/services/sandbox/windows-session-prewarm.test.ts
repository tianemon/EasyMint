vi.mock("../../../shared/windows-sandbox", () => ({ WINDOWS_SANDBOX_ENABLED: true }));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), revoke: vi.fn(), cleanup: vi.fn(), create: vi.fn() }));
vi.mock("./manager", () => ({ prepareWindowsSessionSandbox: mocks.prepare }));
vi.mock("./windows-execution-manager", () => ({ revokeWindowsExecutionOwners: mocks.revoke, waitWindowsOwnerCleanup: mocks.cleanup }));
vi.mock("../permission/execution-context", async importOriginal => {
  const actual = await importOriginal<typeof import("../permission/execution-context")>();
  return { ...actual, createExecutionContext: mocks.create };
});
import { startWindowsSessionPrewarm, stopWindowsSessionPrewarm } from "./windows-session-prewarm";

beforeEach(() => {
  const win = Object.create(process); Object.defineProperty(win, "platform", { value: "win32" }); vi.stubGlobal("process", win);
  mocks.create.mockReset().mockReturnValue({ mode: "standard", workspaceRealPath: "work", runtimeRoot: "runtime", environment: {}, policyVersion: "2" });
  mocks.prepare.mockReset().mockResolvedValue(undefined); mocks.revoke.mockReset().mockResolvedValue(undefined);
  mocks.cleanup.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());
describe("Windows session prewarm", () => {
  it("starts once for standard mode and uses the session owner", async () => {
    const session = {}; startWindowsSessionPrewarm(session, "work", "session-a", () => "standard");
    startWindowsSessionPrewarm(session, "work", "session-a", () => "standard");
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.prepare.mock.calls[0]![0]).toMatchObject({ ownerId: "session-a", mode: "standard" });
    await stopWindowsSessionPrewarm(session); expect(mocks.revoke).toHaveBeenCalledWith(["session-a"]);
  });
  it("does not start in full or readonly mode", () => {
    startWindowsSessionPrewarm({}, "work", "full", () => "full");
    startWindowsSessionPrewarm({}, "work", "readonly", () => "readonly");
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("aborts and revokes while preparation is still pending", async () => {
    let finish!: () => void;
    mocks.prepare.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const session = {}; startWindowsSessionPrewarm(session, "work", "session-b", () => "standard");
    const signal = mocks.prepare.mock.calls[0]![1] as AbortSignal;
    const stopping = stopWindowsSessionPrewarm(session);
    expect(stopWindowsSessionPrewarm(session)).toBe(stopping);
    expect(signal.aborted).toBe(true); expect(mocks.revoke).toHaveBeenCalledWith(["session-b"]);
    let done = false; void stopping.then(() => { done = true; }); await Promise.resolve(); expect(done).toBe(false);
    finish(); await stopping; expect(done).toBe(true);
    expect(mocks.revoke).toHaveBeenCalledOnce();
  });
  it("reports a failed shutdown instead of declaring preparation stopped", async () => {
    const session = {}, status = vi.fn();
    startWindowsSessionPrewarm(session, "work", "session-c", () => "standard", status);
    mocks.revoke.mockRejectedValueOnce(new Error("cleanup failed"));
    await expect(stopWindowsSessionPrewarm(session)).rejects.toThrow("cleanup failed");
    expect(status.mock.calls.some(([state]) => state === "stopped")).toBe(false);
    expect(status).toHaveBeenCalledWith("failed", "cleanup failed", expect.any(String));
  });
  it("reports a late cleanup failure after the old worker's leases drain", async () => {
    let rejectCleanup!: (error: Error) => void;
    mocks.cleanup.mockImplementation(() => new Promise<void>((_, reject) => { rejectCleanup = reject; }));
    const session = {}, status = vi.fn();
    startWindowsSessionPrewarm(session, "work", "session-d", () => "standard", status);
    await stopWindowsSessionPrewarm(session);
    expect(status.mock.calls.map(([state]) => state)).toEqual(["preparing", "stopping"]);
    rejectCleanup(new Error("late cleanup failure"));
    await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith("failed", "late cleanup failure", expect.any(String)));
  });
});
