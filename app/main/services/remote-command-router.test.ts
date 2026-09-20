import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { RemoteCommandRouter } from "./remote-command-router";
import { backgroundShellRegistry, type BackgroundShell } from "./background-shell/registry";
import { createDelegation, resetRegistry } from "./task/registry";
import type { AgentService } from "./agent-service";
import type { SessionCoordinator } from "./session-coordinator";
import type { Store } from "./store";
import type { RemoteCommandEnvelope, RemoteCommandName } from "../../shared/remote-protocol";

/**
 * 远程停止命令（shell.stop / delegation.stop）的归属校验。
 *
 * 停止是破坏性操作：远端只递交 ID，能不能停由 PC 判定——必须拒绝「不属于该会话」的目标，
 * 否则手机端可以凭任意 ID 停掉别的会话（甚至别的项目）正在跑的后台命令与委派。
 */

vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [] } }));
// 只用到 agent-service 的两个模块级函数；避免在测试里加载整个 agent-service（pi SDK / 会话栈）
vi.mock("./agent-service", () => ({
  getPendingAskSnapshots: () => [],
  respondAsk: vi.fn(() => null),
}));

afterEach(() => {
  vi.restoreAllMocks();
  resetRegistry();
});

function envelope(command: RemoteCommandName, data: Record<string, unknown>, sessionId = "session-1"): RemoteCommandEnvelope {
  return {
    version: 1,
    connectionId: "connection-1",
    sequence: 1,
    sentAt: Date.now(),
    kind: "command",
    requestId: "request-1",
    projectId: "project-1",
    sessionId,
    payload: { command, data },
  };
}

function createRouter() {
  const requireSession = vi.fn(async () => ({
    project: { path: "/tmp/project" },
    session: { sessionId: "session-1" },
  }));
  const stopDelegationTask = vi.fn(async () => {});
  const router = new RemoteCommandRouter(
    { requireSession } as unknown as SessionCoordinator,
    { stopDelegationTask } as unknown as AgentService,
    {} as unknown as Store,
    {} as unknown as Electron.BrowserWindow,
  );
  return { router, requireSession, stopDelegationTask };
}

function stubShells(shells: Array<{ id: string; sessionId?: string; logPath?: string }>): void {
  vi.spyOn(backgroundShellRegistry, "list")
    .mockReturnValue(shells.map((shell) => shell as unknown as BackgroundShell));
}

describe("RemoteCommandRouter · shell.stop", () => {
  it("停止本会话的后台命令：走 registry.stop 且来源记为用户", async () => {
    stubShells([{ id: "shell-1", sessionId: "session-1" }]);
    const stop = vi.spyOn(backgroundShellRegistry, "stop").mockReturnValue(true);
    const { router } = createRouter();

    await expect(router.handle("device-1", envelope("shell.stop", { shellId: "shell-1" })))
      .resolves.toEqual({ ok: true });
    expect(stop).toHaveBeenCalledWith("shell-1", "user");
  });

  it("拒绝其他会话的后台命令，且不触发停止", async () => {
    stubShells([{ id: "shell-1", sessionId: "session-2" }]);
    const stop = vi.spyOn(backgroundShellRegistry, "stop").mockReturnValue(true);
    const { router } = createRouter();

    await expect(router.handle("device-1", envelope("shell.stop", { shellId: "shell-1" })))
      .rejects.toMatchObject({ code: "SHELL_NOT_FOUND" });
    expect(stop).not.toHaveBeenCalled();
  });

  it("拒绝无会话归属（sessionId 缺失）与不存在的后台命令", async () => {
    stubShells([{ id: "shell-1" }]);
    vi.spyOn(backgroundShellRegistry, "stop").mockReturnValue(true);
    const { router } = createRouter();

    await expect(router.handle("device-1", envelope("shell.stop", { shellId: "shell-1" })))
      .rejects.toMatchObject({ code: "SHELL_NOT_FOUND" });
    await expect(router.handle("device-1", envelope("shell.stop", { shellId: "shell-404" })))
      .rejects.toMatchObject({ code: "SHELL_NOT_FOUND" });
  });
});

describe("RemoteCommandRouter · shell.readLog", () => {
  it("按 shellId 读本会话命令的日志尾部，不回传本机路径", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "em-shell-log-"));
    const logPath = path.join(dir, "shell.log");
    fs.writeFileSync(logPath, "line-1\nline-2\n");
    stubShells([{ id: "shell-1", sessionId: "session-1", logPath }]);
    const { router } = createRouter();

    const result = await router.handle("device-1", envelope("shell.readLog", { shellId: "shell-1" }));
    expect(result).toEqual({ content: "line-1\nline-2\n", truncated: false });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("拒绝其他会话的后台命令与不存在的命令（归属校验与 shell.stop 同一条）", async () => {
    stubShells([{ id: "shell-1", sessionId: "session-2", logPath: "/tmp/whatever.log" }]);
    const { router } = createRouter();

    await expect(router.handle("device-1", envelope("shell.readLog", { shellId: "shell-1" })))
      .rejects.toMatchObject({ code: "SHELL_NOT_FOUND" });
    await expect(router.handle("device-1", envelope("shell.readLog", { shellId: "shell-404" })))
      .rejects.toMatchObject({ code: "SHELL_NOT_FOUND" });
  });
});

describe("RemoteCommandRouter · delegation.stop", () => {
  it("停止本会话的委派任务：复用主进程 stopDelegationTask", async () => {
    const record = createDelegation("session-1", [{ task: "做事" }], "session-1");
    const { router, stopDelegationTask } = createRouter();

    await expect(router.handle("device-1", envelope("delegation.stop", {
      delegationId: record.delegationId,
      taskIndex: 0,
    }))).resolves.toEqual({ ok: true });
    expect(stopDelegationTask).toHaveBeenCalledWith(record.delegationId, 0);
  });

  it("拒绝其他会话的委派，且不触发停止", async () => {
    const record = createDelegation("session-2", [{ task: "做事" }], "session-2");
    const { router, stopDelegationTask } = createRouter();

    await expect(router.handle("device-1", envelope("delegation.stop", {
      delegationId: record.delegationId,
      taskIndex: 0,
    }))).rejects.toMatchObject({ code: "DELEGATION_NOT_FOUND" });
    expect(stopDelegationTask).not.toHaveBeenCalled();
  });

  it("拒绝越界任务序号与非法委派 ID", async () => {
    const record = createDelegation("session-1", [{ task: "做事" }], "session-1");
    const { router, stopDelegationTask } = createRouter();

    await expect(router.handle("device-1", envelope("delegation.stop", {
      delegationId: record.delegationId,
      taskIndex: 3,
    }))).rejects.toMatchObject({ code: "DELEGATION_NOT_FOUND" });
    await expect(router.handle("device-1", envelope("delegation.stop", {
      delegationId: "not-a-uuid",
      taskIndex: 0,
    }))).rejects.toThrow();
    expect(stopDelegationTask).not.toHaveBeenCalled();
  });
});
