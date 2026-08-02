import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AgentSessionEvent } from "../pi-sdk";
import { runSubagents } from "./executor";
import { createDelegation, resetRegistry } from "./registry";

const mocks = vi.hoisted(() => ({
  createPiSession: vi.fn(),
  getBaseTools: vi.fn(),
  getReadOnlyTools: vi.fn(),
  getActiveModel: vi.fn(),
}));

vi.mock("../pi-session", () => ({
  createPiSession: mocks.createPiSession,
  getPiSessionDir: (cwd: string) => `/sessions/${cwd.replace(/[:/\\]/g, "-")}`,
}));
vi.mock("../tool-registry", () => ({
  getBaseTools: mocks.getBaseTools,
  getReadOnlyTools: mocks.getReadOnlyTools,
}));
vi.mock("../pi-init", () => ({
  getActiveModel: mocks.getActiveModel,
}));

import { createPiSession } from "../pi-session";

/** 构造模拟 Pi 会话：按序派发事件，prompt 立即 resolve */
function fakeSession(events: AgentSessionEvent[]) {
  const aborted = { current: false };
  return {
    subscribe: (cb: (e: AgentSessionEvent) => void) => {
      for (const e of events) cb(e);
      return () => {};
    },
    prompt: vi.fn().mockImplementation(async () => { /* noop */ }),
    abort: vi.fn().mockImplementation(async () => { aborted.current = true; }),
    model: undefined,
  };
}

const runtime = { cwd: "/proj", agentDir: "/agent", store: {} as any };

describe("executor 后台委派执行", () => {
  beforeEach(() => {
    resetRegistry();
    vi.clearAllMocks();
    mocks.getBaseTools.mockResolvedValue([]);
    mocks.getReadOnlyTools.mockResolvedValue([]);
    mocks.getActiveModel.mockResolvedValue({ id: "test-model" });
  });

  it("子 Agent 完成后 record.completion resolve,结果无重复(累积帧替换)", async () => {
    const events: AgentSessionEvent[] = [
      { type: "message_update", message: { id: "m1", role: "assistant", content: [{ type: "text", text: "用户在" }] } } as any,
      { type: "message_update", message: { id: "m1", role: "assistant", content: [{ type: "text", text: "用户在做一个总结性的感慨" }] } } as any,
      { type: "message_end", message: { id: "m1", role: "assistant", content: [{ type: "text", text: "用户在做一个总结性的感慨" }], usage: { totalTokens: 100 } } } as any,
      { type: "agent_end", messages: [{ id: "m1", role: "assistant", content: [{ type: "text", text: "用户在做一个总结性的感慨" }] }], willRetry: false } as any,
    ];
    (mocks.createPiSession as any).mockResolvedValue(fakeSession(events));

    const record = createDelegation("mint", [{ task: "T1", agent: "builder" }]);
    const done = runSubagents(record, runtime);
    const result = await record.completion;

    expect(record.status).toBe("completed");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.output).toBe("用户在做一个总结性的感慨");
    expect(result.results[0]!.output).not.toContain("用户在\n用户在");
    await done;
  });

  it("abort 后 status 为 aborted,结果标记中止", async () => {
    const events: AgentSessionEvent[] = [
      { type: "message_update", message: { id: "m1", role: "assistant", content: [{ type: "text", text: "部分" }] } } as any,
    ];
    (mocks.createPiSession as any).mockResolvedValue(fakeSession(events));

    const record = createDelegation("mint", [{ task: "T1" }]);
    const done = runSubagents(record, runtime);
    record.abort(); // 立即中止
    const result = await record.completion;

    expect(record.status).toBe("aborted");
    expect(result.aborted).toBe(true);
    await done;
  });

  it("signal abort 时立即中止子会话(等待模型输出期间也生效)", async () => {
    const session = fakeSession([]);
    (mocks.createPiSession as any).mockResolvedValue(session);
    const record = createDelegation("mint", [{ task: "T1" }]);
    const done = runSubagents(record, runtime);
    // 子 Agent 等待模型输出期间(无事件),用户点打断 → signal abort → session.abort 立即被调用
    record.abort();
    await record.completion;
    expect(session.abort).toHaveBeenCalled();
    expect(record.status).toBe("aborted");
    await done;
  });

  it("无 outputSchema 时不创建 yield 工具", async () => {
    (mocks.createPiSession as any).mockResolvedValue(fakeSession([]));
    const record = createDelegation("mint", [{ task: "T1" }]);
    const done = runSubagents(record, runtime);
    await record.completion;
    expect(createPiSession).toHaveBeenCalledTimes(1);
    await done;
  });
});
