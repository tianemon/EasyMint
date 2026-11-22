import { describe, expect, it } from "vitest";
import { summarizeWindowsSandboxInitError, windowsWorkerKey } from "./windows-execution-manager";
import type { ExecutionContext } from "../permission/execution-context";
import { buildExecutionPolicy } from "../permission/access-policy";

function context(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    mode: "standard",
    workspaceRealPath: "C:\\work\\demo",
    runtimeRoot: "C:\\Users\\alice\\.easymint\\runtimes\\demo",
    environment: {},
    policyVersion: "2",
    ...overrides,
  };
}

describe("Windows 动态沙盒 worker 隔离键", () => {
  it("按会话、工作区、运行区与权限模式隔离，防止 ACL 授权串用", () => {
    const base = windowsWorkerKey(context({ ownerId: "session-a" }));
    expect(windowsWorkerKey(context({ ownerId: "session-b" }))).not.toBe(base);
    expect(windowsWorkerKey(context({ mode: "full", ownerId: "session-a" }))).not.toBe(base);
    expect(windowsWorkerKey(context({ workspaceRealPath: "D:\\work\\demo", ownerId: "session-a" }))).not.toBe(base);
    expect(windowsWorkerKey(context({ bundledRuntimeRoot: "C:\\tools\\v2", ownerId: "session-a" }))).not.toBe(base);
    expect(windowsWorkerKey(context({ runtimeRoot: "C:\\runtime\\other", ownerId: "session-a" }))).not.toBe(base);
  });
  it("策略变化后不复用旧 worker", () => {
    const ctx = context({ ownerId: "session-a" });
    const policy = buildExecutionPolicy(ctx);
    const changed = { ...policy, network: { ...policy.network, allowedDomains: [...policy.network.allowedDomains, "changed.example"] } };
    expect(windowsWorkerKey(ctx, changed)).not.toBe(windowsWorkerKey(ctx, policy));
  });
});

it("reports real ACL failures instead of the preceding successful placeholder notice", () => {
  const detail = [
    "srt-win acl grant --persistent exited 1 (failed): srt-win: deny target 'C:\\p\\.easymint\\mcp.json' does not exist; created 1 placeholder component(s)",
    "srt-win: deny '\\\\?\\D:\\profile\\agent\\auth.json': recompose failed: WIN32_ERROR=0x00000005",
    "srt-win: error: 7 of 84 path(s) could not be granted; batch rolled back",
  ].join("\r\n");
  const summary = summarizeWindowsSandboxInitError(detail);
  expect(summary).toContain("7 项文件权限");
  expect(summary).toContain("D:\\profile\\agent\\auth.json");
  expect(summary).not.toContain("mcp.json");
  expect(summarizeWindowsSandboxInitError("temporary worker exit")).toBe("temporary worker exit");
});
