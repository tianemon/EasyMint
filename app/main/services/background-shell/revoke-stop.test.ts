import { describe, expect, it } from "vitest";
import { formatShellResult } from "./tool";
import type { BackgroundShell } from "./registry";

describe("后台命令停止通知", () => {
  const shell = {
    command: "sleep 900",
    startedAt: Date.now(),
    exitCode: null,
    stopped: true,
    output: "",
    logPath: "/tmp/shell.log",
  } as BackgroundShell;

  it("权限切换撤销时不冒充用户手动停止", () => {
    expect(formatShellResult({ ...shell, stoppedBy: "revoke" })).toContain("后台命令 - 已随权限切换中止");
  });

  it("用户手动停止仍保持原文案", () => {
    expect(formatShellResult({ ...shell, stoppedBy: "user" })).toContain("后台命令 - 已由用户中止");
  });
});
