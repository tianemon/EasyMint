import { describe, it, expect } from "vitest";
import { formatShellResult } from "./tool";

/** 构造最小 BackgroundShell(仅格式化所需字段) */
function shell(partial: { command: string; exitCode: number | null; stopped?: boolean; output?: string; startedAt?: number }): any {
  return {
    id: "shell-test",
    command: partial.command,
    startedAt: partial.startedAt ?? Date.now() - 12000,
    exitCode: partial.exitCode,
    stopped: partial.stopped ?? false,
    output: partial.output ?? "",
  };
}

describe("formatShellResult 后台命令结果格式化", () => {
  it("自然退出(0) → 完成,含命令/退出码/输出", () => {
    const text = formatShellResult(shell({ command: "npm run dev", exitCode: 0, output: "Ready on 3000" }));
    expect(text).toContain("● 后台命令 — 完成 · 12s");
    expect(text).toContain("命令: npm run dev");
    expect(text).toContain("退出码: 0");
    expect(text).toContain("Ready on 3000");
  });

  it("被停止 → 中止(与自然失败区分)", () => {
    const text = formatShellResult(shell({ command: "sleep 30", exitCode: null, stopped: true }));
    expect(text).toContain("● 后台命令 — 中止");
  });

  it("非零退出 → 失败", () => {
    const text = formatShellResult(shell({ command: "false", exitCode: 1 }));
    expect(text).toContain("● 后台命令 — 失败");
  });

  it("无输出 → (无输出)", () => {
    const text = formatShellResult(shell({ command: "true", exitCode: 0, output: "" }));
    expect(text).toContain("(无输出)");
  });
});
