import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ToolDefinition } from "../pi-sdk";

const mocks = vi.hoisted(() => ({
  defineTool: vi.fn(),
  runSubagents: vi.fn(),
}));

vi.mock("../pi-sdk", () => ({
  getDefineToolFn: vi.fn().mockResolvedValue(mocks.defineTool),
}));
vi.mock("./executor", () => ({
  runSubagents: mocks.runSubagents,
}));
vi.mock("../agent-templates", () => ({
  getTemplate: () => undefined,
}));

import { createTaskTool } from "./tool";
import { resetRegistry, finishDelegation } from "./registry";

async function createExecute(ctx?: Partial<Parameters<typeof createTaskTool>[0]>) {
  mocks.defineTool.mockImplementation((def: ToolDefinition) => def);
  const tool = await createTaskTool({
    cwd: "/proj",
    agentDir: "/agent",
    store: {} as any,
    parentSessionId: "session-mint",
    ...ctx,
  });
  return tool.execute!;
}

describe("task tool 异步委派", () => {
  beforeEach(() => {
    resetRegistry();
    vi.clearAllMocks();
    mocks.defineTool.mockClear();
    mocks.runSubagents.mockReset();
  });

  it("execute 立即返回(不等待子 Agent),并启动后台执行", async () => {
    mocks.runSubagents.mockResolvedValue(undefined);
    const execute = await createExecute();
    const t0 = Date.now();
    const ret = await (execute as any)("tc1", {
      description: "T1: 实现登录",
      prompt: "执行 task.json 中 id=1 的任务",
      agent: "builder",
    });
    expect((ret.content[0] as { text: string }).text).toContain("已启动 1 个子 Agent");
    expect(Date.now() - t0).toBeLessThan(500); // 立即返回
    expect(mocks.runSubagents).toHaveBeenCalledTimes(1);
    const recordArg = mocks.runSubagents.mock.calls[0]![0] as any;
    expect(recordArg.parentSessionId).toBe("session-mint");
    expect(recordArg.tasks).toHaveLength(1);
    expect(recordArg.tasks[0].agent).toBe("builder");
  });

  it("委派完成后 onComplete 收到格式化结果(无重复累积文本)", async () => {
    const onComplete = vi.fn();
    mocks.runSubagents.mockImplementation((record: any) => {
      // 模拟后台执行完成后 finishDelegation
      finishDelegation(record, "completed", {
        result: { results: [{ index: 0, id: "s1", agent: "coder", task: "T1", exitCode: 0, output: "最终完整结果", stderr: "", truncated: false, durationMs: 5, tokens: 0, requests: 0 }], totalDurationMs: 5, aborted: false },
      });
      return Promise.resolve();
    });
    const execute = await createExecute({ onComplete });
    await (execute as any)("tc1", { description: "T1", prompt: "任务" });

    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete.mock.calls[0]![0]).toBe("session-mint");
    expect(onComplete.mock.calls[0]![1]).toContain("最终完整结果");
  });

  it("空参数返回错误提示,不创建委派", async () => {
    const execute = await createExecute();
    const ret = await (execute as any)("tc1", {});
    expect((ret.content[0] as { text: string }).text).toContain("请提供");
    expect(mocks.runSubagents).not.toHaveBeenCalled();
  });

  it("批量任务(tasks 数组)启动多个子 Agent", async () => {
    mocks.runSubagents.mockResolvedValue(undefined);
    const execute = await createExecute();
    await (execute as any)("tc1", {
      tasks: [
        { description: "T1", prompt: "p1", agent: "builder" },
        { description: "T2", prompt: "p2", agent: "evaluator" },
      ],
    });
    const recordArg = mocks.runSubagents.mock.calls[0]![0] as any;
    expect(recordArg.tasks).toHaveLength(2);
  });
});
