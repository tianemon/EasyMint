import { describe, expect, it, vi } from "vitest";
import { createDependencyTool, dependencyToolInternals } from "./dependency-tool";
import { wrapToolWithPermission } from "../permission/wrap-tool";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), wrap: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("electron", () => ({ app: { getPath: () => "/tmp", isPackaged: false } }));
vi.mock("../pi-sdk", () => ({ getDefineToolFn: async () => (tool: unknown) => tool }));
vi.mock("../project-rule-files", () => ({ markProjectRuleChanged: vi.fn() }));
vi.mock("../background-shell/registry", () => ({ backgroundShellRegistry: {}, resolveSpawn: vi.fn() }));
vi.mock("../sandbox/manager", () => ({
  isSandboxBypassedForMode: () => true,
  wrapForSandbox: mocks.wrap,
}));

describe("受管理依赖安装", () => {
  it("包名始终作为单个 shell 参数，不能注入命令", () => {
    const command = dependencyToolInternals.installCommand("npm", ["a; touch /tmp/pwn", "@scope/pkg@1"], "project", true, "/work");
    expect(command).toBe("npm install --save-dev 'a; touch /tmp/pwn' '@scope/pkg@1'");
  });

  it("用户级安装使用包管理器的用户范围", () => {
    expect(dependencyToolInternals.installCommand("cargo", ["cargo-edit"], "user", false, "/work"))
      .toBe("cargo install 'cargo-edit'");
    expect(dependencyToolInternals.installCommand("mise", ["node@22"], "user", false, "/work"))
      .toBe("mise use --global 'node@22'");
  });

  it("拒绝空列表和换行参数", () => {
    expect(() => dependencyToolInternals.packageArgs([])).toThrow("至少提供");
    expect(() => dependencyToolInternals.packageArgs(["ok\nevil"])).toThrow("格式无效");
  });

  it("把 Windows 沙盒租约传递给执行层", () => {
    const release = async (): Promise<void> => {};
    const target = dependencyToolInternals.executionTarget({
      kind: "argv",
      argv: ["srt-win.exe", "run"],
      env: {},
      release,
    });
    expect(target.release).toBe(release);
  });

  it("权限在安装准备期间收紧时释放租约并拒绝启动", async () => {
    let prepared!: (target: unknown) => void;
    let revoked = false;
    const startCheck = vi.fn(() => {
      if (revoked) throw new Error("mock permission revoked");
    });
    const release = vi.fn(async () => {});
    mocks.wrap.mockReturnValue(new Promise(resolve => { prepared = resolve; }));
    const tool = wrapToolWithPermission(await createDependencyTool("/fixture"), {
      canUseTool: async (_name, input) => ({
        behavior: "allow",
        updatedInput: input,
        executionPolicy: { workspaceRealPath: "/fixture", mode: "full" } as never,
        assertExecutionCanStart: startCheck,
      }),
    });
    const result = tool.execute("fixture", { manager: "npm", scope: "user", packages: ["fixture-test"] }, undefined, undefined, {} as never);
    const rejected = expect(result).rejects.toThrow("mock permission revoked");
    await vi.waitFor(() => expect(mocks.wrap).toHaveBeenCalledOnce());
    revoked = true;
    prepared({ kind: "argv", argv: ["mock-only"], env: {}, release });
    await rejected;
    expect(startCheck).toHaveBeenCalledOnce();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
});
