import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../ipc-broadcast", () => ({
  broadcast: vi.fn(),
}));

import { backgroundShellRegistry } from "./registry";

describe("BackgroundShellRegistry 后台进程管理", () => {
  beforeEach(() => {
    backgroundShellRegistry.reset();
    vi.clearAllMocks();
  });

  it("start 立即返回 id,命令自然退出时回调 onExit 并注销", async () => {
    const onExit = vi.fn();
    const id = backgroundShellRegistry.start("echo hello", "/tmp", onExit);
    expect(id).toMatch(/^shell-/);
    expect(backgroundShellRegistry.list()).toHaveLength(1);

    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const shell = onExit.mock.calls[0]![0] as { exitCode: number; output: string; stopped: boolean };
    expect(shell.exitCode).toBe(0);
    expect(shell.output).toContain("hello");
    expect(backgroundShellRegistry.list()).toHaveLength(0);
  });

  it("输出累积且尾部截断(4KB 上限)", async () => {
    const onExit = vi.fn();
    backgroundShellRegistry.start("seq 1 1000", "/tmp", onExit);
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const shell = onExit.mock.calls[0]![0] as { output: string };
    expect(shell.output.length).toBeLessThanOrEqual(4096 + 64); // 截断上限 + 少量容差
    expect(shell.output).toContain("999"); // 保留尾部
  });

  it("stop 标记 stopped 并终止进程,onExit 收中止结果", async () => {
    const onExit = vi.fn();
    const id = backgroundShellRegistry.start("sleep 30", "/tmp", onExit);
    expect(backgroundShellRegistry.stop(id)).toBe(true);
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const shell = onExit.mock.calls[0]![0] as { stopped: boolean };
    expect(shell.stopped).toBe(true);
    expect(backgroundShellRegistry.list()).toHaveLength(0);
  });

  it("停止不存在的 id 返回 false", () => {
    expect(backgroundShellRegistry.stop("nope")).toBe(false);
  });

  it("stopAll 终止全部进程", async () => {
    const onExit = vi.fn();
    backgroundShellRegistry.start("sleep 30", "/tmp", onExit);
    backgroundShellRegistry.start("sleep 30", "/tmp", onExit);
    backgroundShellRegistry.stopAll();
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(2), { timeout: 5000 });
    expect(backgroundShellRegistry.list()).toHaveLength(0);
  });
});
