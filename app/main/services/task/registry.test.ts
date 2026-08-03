import { describe, it, expect, beforeEach } from "vitest";
import {
  createDelegation,
  getDelegation,
  getRunningDelegations,
  getRunningSummary,
  abortDelegations,
  finishDelegation,
  setTaskStatus,
  registerSessionIdMapping,
  resolveParentSessionId,
  resetRegistry,
} from "./registry";
import type { BatchResult } from "./types";

describe("task registry 委派记录表", () => {
  beforeEach(() => resetRegistry());

  const tasks = [{ task: "T1 实现登录", agent: "builder" }];

  it("createDelegation 生成记录 + completion Promise", () => {
    const r = createDelegation("session-mint", tasks);
    expect(r.delegationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.status).toBe("running");
    expect(r.parentSessionId).toBe("session-mint");
    expect(r.completion).toBeInstanceOf(Promise);
    expect(getDelegation(r.delegationId)).toBe(r);
  });

  it("finishDelegation 更新状态并 resolve completion", async () => {
    const r = createDelegation("session-mint", tasks);
    const result: BatchResult = { results: [], totalDurationMs: 10, aborted: false };
    finishDelegation(r, "completed", { result });
    expect(r.status).toBe("completed");
    await expect(r.completion).resolves.toBe(result);
  });

  it("abort 后 status 由执行器置为 aborted", async () => {
    const r = createDelegation("session-mint", tasks);
    r.abort();
    expect(r.abortController.signal.aborted).toBe(true);
    // 模拟执行器响应中止
    finishDelegation(r, "aborted");
    expect(r.status).toBe("aborted");
    await expect(r.completion).resolves.toMatchObject({ aborted: true });
  });

  it("abortDelegations 中止某主会话全部运行中委派", () => {
    const r1 = createDelegation("mint-A", tasks);
    const r2 = createDelegation("mint-A", tasks);
    createDelegation("mint-B", tasks);
    const n = abortDelegations("mint-A");
    expect(n).toBe(2);
    expect(r1.abortController.signal.aborted).toBe(true);
    expect(r2.abortController.signal.aborted).toBe(true);
    expect(getRunningDelegations("mint-B")).toHaveLength(1);
  });

  it("registerSessionIdMapping + resolveParentSessionId:委派创建时解析为真实 ID", () => {
    // 委派在 createPiSession 之后创建(回填映射已注册)→ 创建时解析
    registerSessionIdMapping("temp-uuid", "019f-real-id");
    const r = createDelegation(resolveParentSessionId("temp-uuid"), tasks, "temp-uuid");
    expect(r.parentSessionId).toBe("019f-real-id");
    expect(r.tempParentSessionId).toBe("temp-uuid");
    // 双匹配:真实 ID 和临时 ID 都能 abort
    expect(getRunningDelegations("019f-real-id")).toHaveLength(1);
    expect(getRunningDelegations("temp-uuid")).toHaveLength(1);
    abortDelegations("temp-uuid");
    expect(r.abortController.signal.aborted).toBe(true);
  });

  it("resolveParentSessionId 无映射时原样返回(恢复会话直接是真实 ID)", () => {
    expect(resolveParentSessionId("019f-direct")).toBe("019f-direct");
  });

  it("finishDelegation 幂等(已完成不可重复 resolve)", async () => {
    const r = createDelegation("mint-A", tasks);
    finishDelegation(r, "completed", { result: { results: [], totalDurationMs: 1, aborted: false } });
    finishDelegation(r, "failed", { error: "不该生效" });
    expect(r.status).toBe("completed");
    await expect(r.completion).resolves.toMatchObject({ totalDurationMs: 1 });
  });
});

describe("task registry 任务级状态与列表过滤", () => {
  beforeEach(() => { resetRegistry(); });

  it("setTaskStatus 回写状态,getRunningSummary 只返回运行中的任务", () => {
    const record = createDelegation("parent-1", [
      { task: "T1", title: "任务一" },
      { task: "T2", title: "任务二" },
    ]);
    // 任务 0 中止 → 列表只留任务 1
    setTaskStatus(record.delegationId, 0, "aborted");
    const summary = getRunningSummary();
    expect(summary.tasks).toHaveLength(1);
    expect(summary.tasks[0]!.index).toBe(1);
    expect(summary.tasks[0]!.title).toBe("任务二");
  });

  it("全部任务终态后委派不再出现在运行摘要", () => {
    const record = createDelegation("parent-1", [{ task: "T1" }]);
    setTaskStatus(record.delegationId, 0, "completed");
    finishDelegation(record, "completed", {
      result: { results: [], totalDurationMs: 1, aborted: false },
    });
    expect(getRunningSummary().count).toBe(0);
  });

  it("setTaskStatus 越界 index 安全忽略", () => {
    const record = createDelegation("parent-1", [{ task: "T1" }]);
    setTaskStatus(record.delegationId, 5, "aborted");
    expect(getRunningSummary().tasks).toHaveLength(1);
  });
});
