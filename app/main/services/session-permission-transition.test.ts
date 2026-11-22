import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("./session-cache", () => ({ readCache: mocks.read, writeClientCache: mocks.write }));
import { applySessionPermissionTransition, waitForSessionPermissionTransition } from "./session-permission-transition";
import { withSessionCreationLock } from "./session-permission-gate";
const activeSession = {};
const service = { sandboxSessionIdentity: () => activeSession, stopSandboxPrewarm: vi.fn(), revokeElevatedExecution: vi.fn(), schedulePermissionToolRebuild: vi.fn(), refreshPermissionMcp: vi.fn() };
beforeEach(() => { mocks.read.mockReset().mockReturnValue({ permissionMode: "standard" }); mocks.write.mockReset(); service.stopSandboxPrewarm.mockReset().mockResolvedValue(undefined); service.revokeElevatedExecution.mockReset().mockResolvedValue(undefined); service.schedulePermissionToolRebuild.mockReset(); });
it("waits for prewarm cleanup before committing standard to full", async () => {
  let finish!: () => void; service.stopSandboxPrewarm.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const changing = applySessionPermissionTransition("session", { permissionMode: "full" }, service);
  const sent = vi.fn(() => mocks.write.mock.lastCall?.[1]);
  const send = waitForSessionPermissionTransition("session").then(sent);
  await vi.waitFor(() => expect(service.stopSandboxPrewarm).toHaveBeenCalledWith("session"));
  // A session in a different project can be created while the slow cleanup is pending.
  await expect(withSessionCreationLock(async () => "other session created")).resolves.toBe("other session created");
  expect(mocks.write).not.toHaveBeenCalled();
  expect(sent).not.toHaveBeenCalled();
  finish(); await changing; expect(mocks.write).toHaveBeenCalledWith("session", { permissionMode: "full" });
  expect(service.schedulePermissionToolRebuild).toHaveBeenCalledWith("session", false);
  expect(service.refreshPermissionMcp).toHaveBeenCalledWith("session");
  await expect(send).resolves.toEqual({ permissionMode: "full" });
});
it("keeps the prior cached mode when prewarm cleanup fails", async () => {
  service.stopSandboxPrewarm.mockRejectedValue(new Error("cleanup failed"));
  await expect(applySessionPermissionTransition("session", { permissionMode: "full" }, service)).rejects.toThrow("cleanup failed");
  expect(mocks.write).not.toHaveBeenCalled(); expect(service.schedulePermissionToolRebuild).not.toHaveBeenCalled();
});
it("preserves the full-to-standard revocation and rebuild sequence", async () => {
  mocks.read.mockReturnValue({ permissionMode: "full" });
  await applySessionPermissionTransition("session", { permissionMode: "standard" }, service);
  expect(service.stopSandboxPrewarm).not.toHaveBeenCalled(); expect(mocks.write).toHaveBeenCalledOnce();
  expect(service.revokeElevatedExecution).toHaveBeenCalledWith("session"); expect(service.schedulePermissionToolRebuild).toHaveBeenCalledWith("session", true);
});
