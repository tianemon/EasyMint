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
vi.mock("../ipc-broadcast", () => ({
  broadcast: vi.fn(),
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

describe("task tool 异步委派（对齐 cc 实测行为）", () => {
  beforeEach(() => {
    resetRegistry();
    vi.clearAllMocks();
    mocks.defineTool.mockClear();
    mocks.runSubagents.mockReset();
  });

  it("execute 立即返回「已启动」,不等待子 Agent 完成", async () => {
    mocks.runSubagents.mockImplementation(async () => { /* 后台执行,不 resolve */ });
    const execute = await createExecute();
    const ret = await (execute as any)("tc1", {
      description: "T1: 实现登录",
      prompt: "执行任务",
      agent: "builder",
    });
    const text = (ret.content[0] as { text: string }).text;
    expect(text).toContain("已启动 1 个子 Agent");
    const recordArg = mocks.runSubagents.mock.calls[0]![0] as any;
    expect(recordArg.parentSessionId).toBe("session-mint");
    expect(recordArg.tasks).toHaveLength(1);
    expect(recordArg.tasks[0].agent).toBe("builder");
  });

  it("子 Agent 完成后 onComplete 收到格式化结果(含结构化字段)", async () => {
    const onComplete = vi.fn();
    mocks.runSubagents.mockImplementation((record: any) => {
      finishDelegation(record, "completed", {
        result: {
          results: [{
            index: 0, id: "s1", agent: "coder", task: "T1", exitCode: 0,
            output: "最终完整结果", stderr: "", truncated: false, durationMs: 5, tokens: 0, requests: 0,
            structuredOutput: { status: "valid", data: { message: "收到", note: "ok" } },
          }],
          totalDurationMs: 5,
          aborted: false,
        },
      });
      return Promise.resolve();
    });
    const execute = await createExecute({ onComplete });
    await (execute as any)("tc1", { description: "T1", prompt: "任务" });

    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete.mock.calls[0]![0]).toBe("session-mint");
    const text = onComplete.mock.calls[0]![1] as string;
    expect(text).toContain("● T1 — 完成");  // 摘要行(前端绿色气泡渲染用)
    expect(text).toContain("最终完整结果");  // 详细段(Mint 汇报用)
    expect(text).toContain('"message":"收到"');
  });

  it("Pi abort signal → 中止委派(打断按钮链路),完成回调收 aborted 结果", async () => {
    const abortController = new AbortController();
    const onComplete = vi.fn();
    mocks.runSubagents.mockImplementation((record: any) => {
      abortController.signal.addEventListener("abort", () => {
        finishDelegation(record, "aborted", {
          result: { results: [], totalDurationMs: 1, aborted: true },
        });
      });
      return Promise.resolve();
    });
    const execute = await createExecute({ onComplete });
    await (execute as any)("tc1", { description: "T1", prompt: "任务" }, abortController.signal);
    abortController.abort(); // 用户点打断

    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete.mock.calls[0]![1]).toContain("中止");
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
