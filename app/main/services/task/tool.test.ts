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

describe("task tool 同步委派（cc/omp Task 语义）", () => {
  beforeEach(() => {
    resetRegistry();
    vi.clearAllMocks();
    mocks.defineTool.mockClear();
    mocks.runSubagents.mockReset();
  });

  it("execute 等待子 Agent 完成,返回结果文本作为工具结果", async () => {
    mocks.runSubagents.mockImplementation((record: any) => {
      // 模拟后台执行完成
      finishDelegation(record, "completed", {
        result: {
          results: [{ index: 0, id: "s1", agent: "coder", task: "T1", exitCode: 0, output: "最终完整结果", stderr: "", truncated: false, durationMs: 5, tokens: 0, requests: 0 }],
          totalDurationMs: 5,
          aborted: false,
        },
      });
      return Promise.resolve();
    });
    const execute = await createExecute();
    const ret = await (execute as any)("tc1", {
      description: "T1: 实现登录",
      prompt: "执行任务",
      agent: "builder",
    });
    const text = (ret.content[0] as { text: string }).text;
    expect(text).toContain("✓ 完成");
    expect(text).toContain("最终完整结果");
    const recordArg = mocks.runSubagents.mock.calls[0]![0] as any;
    expect(recordArg.parentSessionId).toBe("session-mint");
    expect(recordArg.tasks).toHaveLength(1);
    expect(recordArg.tasks[0].agent).toBe("builder");
  });

  it("被 abort 时返回中止结果,不阻塞调用方", async () => {
    mocks.runSubagents.mockImplementation((record: any) => {
      // 模拟用户插话中止:先 abort,再 finish
      finishDelegation(record, "aborted", {
        result: { results: [], totalDurationMs: 3, aborted: true },
      });
      return Promise.resolve();
    });
    const execute = await createExecute();
    const ret = await (execute as any)("tc1", { description: "T1", prompt: "任务" });
    const text = (ret.content[0] as { text: string }).text;
    expect(text).toContain("中止");
  });

  it("结构化输出字段进入结果文本", async () => {
    mocks.runSubagents.mockImplementation((record: any) => {
      finishDelegation(record, "completed", {
        result: {
          results: [{
            index: 0, id: "s1", agent: "coder", task: "T1", exitCode: 0,
            output: "完成", stderr: "", truncated: false, durationMs: 5, tokens: 0, requests: 0,
            structuredOutput: { status: "valid", data: { message: "收到", note: "ok" } },
          }],
          totalDurationMs: 5,
          aborted: false,
        },
      });
      return Promise.resolve();
    });
    const execute = await createExecute();
    const ret = await (execute as any)("tc1", {
      description: "T1",
      prompt: "任务",
      outputSchema: { message: "string", note: "string" },
    });
    const text = (ret.content[0] as { text: string }).text;
    expect(text).toContain('"message":"收到"');
  });

  it("空参数返回错误提示,不创建委派", async () => {
    const execute = await createExecute();
    const ret = await (execute as any)("tc1", {});
    expect((ret.content[0] as { text: string }).text).toContain("请提供");
    expect(mocks.runSubagents).not.toHaveBeenCalled();
  });

  it("批量任务(tasks 数组)启动多个子 Agent", async () => {
    mocks.runSubagents.mockImplementation((record: any) => {
      finishDelegation(record, "completed", { result: { results: [], totalDurationMs: 1, aborted: false } });
      return Promise.resolve();
    });
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
