import { TOOL_DISPLAY_DESCRIPTION } from "../../../shared/tool-intent";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { createEnhancedBashTool } from "./tool";
import { sandboxGitBashPath } from "./registry";
import { EXECUTION_POLICY } from "../permission/wrap-tool";
import { createExecutionContext } from "../permission/execution-context";

describe("前台 bash 增量输出", () => {
  it("Windows 受保护调用使用探测到的 Git Bash", () => {
    expect(sandboxGitBashPath("win32", () => "C:\\Program Files\\Git\\bin\\bash.exe"))
      .toBe("C:\\Program Files\\Git\\bin\\bash.exe");
    expect(sandboxGitBashPath("darwin", () => "unused")).toBeUndefined();
  });

  it("uses the user-language caption requirement in both tool and parameter descriptions", async () => {
    const tool = await createEnhancedBashTool(process.cwd());
    expect(tool.description).toContain(TOOL_DISPLAY_DESCRIPTION);
    const parameters = tool.parameters as unknown as { properties: { description: { description: string } } };
    expect(parameters.properties.description.description).toBe(TOOL_DISPLAY_DESCRIPTION);
    expect(tool.description).not.toContain("一句话中文");
  });

  it("执行中经 onUpdate 推送 stdout", async () => {
    const tool = await createEnhancedBashTool(process.cwd());
    const updates: string[] = [];
    const onUpdate = (partial: { content: Array<{ type: string; text: string }> }): void => {
      updates.push(partial.content.map((c) => c.text).join(""));
    };
    // 显式用完全访问上下文：本用例测的是**增量输出通道**，不该依赖真实 OS 沙盒——
    // 标准档现在默认套沙盒，而收紧型 sandbox-exec 在嵌套沙盒内必被拒（见 skill §4）。
    const context = createExecutionContext(process.cwd(), "full");
    const res = await (tool as unknown as {
      execute: (id: string, p: Record<string, unknown>, s: undefined, u: typeof onUpdate, ctx: unknown) => Promise<{ content: Array<{ text: string }> }>;
    }).execute("id1", { command: "echo hello-em-live", [EXECUTION_POLICY]: context }, undefined, onUpdate, {});
    expect(updates.join("")).toContain("hello-em-live");
    expect(res.content[0]!.text).toContain("hello-em-live");
  }, 60_000);
});
