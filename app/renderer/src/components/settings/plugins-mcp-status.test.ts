// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mcpIssueDetail } from "./PluginsTab";

/**
 * MCP 问题收敛到配置页后，名称下方那行红字的取值规则（2026-10-29 用户定）：
 * 只在用户该处理的异常态出现，且必须有可执行信息——主进程的原因优先，没有就按状态给一句。
 */
describe("mcpIssueDetail", () => {
  it("prefers the masked reason from the host when it exists", () => {
    expect(mcpIssueDetail({ state: "failed", error: "spawn codegraph ENOENT" }, true)).toContain("ENOENT");
  });

  it("still says something actionable when a failure carries no reason", () => {
    expect(mcpIssueDetail({ state: "failed" }, true)).toContain("重试");
    expect(mcpIssueDetail({ state: "disconnected" }, true)).toContain("重试");
    expect(mcpIssueDetail({ state: "needs-auth" }, true)).toContain("登录");
  });

  it("stays silent for healthy, disabled, pending-approval and unknown servers", () => {
    expect(mcpIssueDetail({ state: "connected" }, true)).toBe("");
    expect(mcpIssueDetail({ state: "connecting" }, true)).toBe("");
    expect(mcpIssueDetail({ state: "failed", error: "boom" }, false)).toBe("");
    expect(mcpIssueDetail({ state: "failed", error: "boom" }, true, true)).toBe("");
    expect(mcpIssueDetail(undefined, true)).toBe("");
  });
});
