import { describe, expect, it } from "vitest";
import { windowsWorkerKey } from "./windows-execution-manager";
import type { ExecutionContext } from "../permission/execution-context";

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
});
