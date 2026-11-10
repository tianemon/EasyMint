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
import type { RemoteCommandEnvelope, RemoteCommandName, RemoteProject } from "../../shared/remote-protocol";
import { isSessionOpenElsewhere, removeMobileConnection } from "./session-visibility";

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

describe("RemoteCommandRouter · 手机端列全部项目与开窗", () => {
  const routerWith = (
    coordinator: Partial<SessionCoordinator>,
    openProject?: (projectId: string) => Promise<void>,
  ) => new RemoteCommandRouter(
    coordinator as unknown as SessionCoordinator,
    {} as unknown as AgentService,
    {} as unknown as Store,
    {} as unknown as Electron.BrowserWindow,
    openProject,
  );

  it("advertises project browsing before clients use the new commands", async () => {
    const router = new RemoteCommandRouter(
      {} as SessionCoordinator, {} as AgentService,
      { getSettings: () => ({}) } as unknown as Store,
      {} as Electron.BrowserWindow,
    );
    await expect(router.handle("device-1", envelope("capability.models", {})))
      .resolves.toMatchObject({ features: { projectBrowse: true, sessionView: true } });
  });

  it("keeps mobile presence independent from message subscriptions and supports leaving", async () => {
    const router = routerWith({ getOpenProject: vi.fn() as never });
    const command = envelope("session.view", { viewerId: "viewer-1" });
    command.sessionId = "view-session";
    await expect(router.handle("device-1", command)).resolves.toEqual({ ok: true });
    expect(isSessionOpenElsewhere("view-session")).toBe(true);
    const leave = envelope("session.view", { viewerId: "viewer-1" });
    delete leave.sessionId;
    leave.sequence = command.sequence + 1;
    await router.handle("device-1", leave);
    expect(isSessionOpenElsewhere("view-session")).toBe(false);
    removeMobileConnection("device-1", command.connectionId);
  });

  it("project.list 返回全部项目（含未打开的标记）", async () => {
    const projects: RemoteProject[] = [{ id: "p1", name: "P1", status: "development", open: false }];
    const listProjects = vi.fn(() => projects);
    const router = routerWith({ listProjects });
    await expect(router.handle("device-1", envelope("project.list", {}))).resolves.toEqual(projects);
    expect(listProjects).toHaveBeenCalledOnce();
  });

  it("project.open 调用注入的开窗回调并带上项目 ID", async () => {
    const openProject = vi.fn(async () => {});
    const router = routerWith({}, openProject);
    await expect(router.handle("device-1", envelope("project.open", {})))
      .resolves.toEqual({ ok: true, projectId: "project-1" });
    expect(openProject).toHaveBeenCalledExactlyOnceWith("project-1");
  });

  it("未注入开窗回调时明确拒绝，不静默成功", async () => {
    const router = routerWith({});
    await expect(router.handle("device-1", envelope("project.open", {})))
      .rejects.toThrow("不支持打开项目窗口");
  });

  it("缺少项目 ID 时拒绝开窗，且不触发回调", async () => {
    const openProject = vi.fn(async () => {});
    const router = routerWith({}, openProject);
    const command = envelope("project.open", {});
    command.projectId = undefined;
    await expect(router.handle("device-1", command)).rejects.toThrow();
    expect(openProject).not.toHaveBeenCalled();
  });

  it("开窗回调失败时不返回成功", async () => {
    const openProject = vi.fn(async () => { throw new Error("项目窗口未就绪"); });
    const router = routerWith({}, openProject);
    await expect(router.handle("device-1", envelope("project.open", {})))
      .rejects.toThrow("项目窗口未就绪");
  });
});
