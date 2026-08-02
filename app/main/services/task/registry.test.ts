import { describe, it, expect, beforeEach } from "vitest";
import {
  createDelegation,
  getDelegation,
  getRunningDelegations,
  abortDelegations,
  finishDelegation,
  updateParentSessionId,
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

  it("updateParentSessionId 回填真实 ID,双匹配仍生效", () => {
    const r = createDelegation("temp-uuid", tasks);
    expect(r.tempParentSessionId).toBe("temp-uuid");
    updateParentSessionId("temp-uuid", "019f-real-id");
    expect(r.parentSessionId).toBe("019f-real-id");
    expect(r.tempParentSessionId).toBe("temp-uuid");
    // 双匹配:真实 ID 和临时 ID 都能找到
    expect(getRunningDelegations("019f-real-id")).toHaveLength(1);
    expect(getRunningDelegations("temp-uuid")).toHaveLength(1);
    // 回填后 abort 仍能命中
    abortDelegations("temp-uuid");
    expect(r.abortController.signal.aborted).toBe(true);
  });

  it("finishDelegation 幂等(已完成不可重复 resolve)", async () => {
    const r = createDelegation("mint-A", tasks);
    finishDelegation(r, "completed", { result: { results: [], totalDurationMs: 1, aborted: false } });
    finishDelegation(r, "failed", { error: "不该生效" });
    expect(r.status).toBe("completed");
    await expect(r.completion).resolves.toMatchObject({ totalDurationMs: 1 });
  });
});
