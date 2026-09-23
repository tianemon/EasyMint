import { describe, expect, it } from "vitest";
import { formatDelegationResult } from "./tool";
import type { BatchResult } from "./types";

describe("委派停止通知", () => {
  const result: BatchResult = {
    aborted: true,
    totalDurationMs: 1000,
    results: [{
      index: 0, id: "child-1", agent: "SubAgent", title: "子任务", task: "执行任务",
      exitCode: -1, output: "", stderr: "", truncated: false, durationMs: 1000,
      aborted: true, tokens: 0, requests: 0,
    }],
  };

  it("权限切换撤销时标明真实来源", () => {
    const text = formatDelegationResult(result, "revoke");
    expect(text).toContain("子任务 - 已随权限切换中止");
  });

  it("其他来源保留原有摘要状态", () => {
    expect(formatDelegationResult(result, "user")).toContain("子任务 - 中止");
  });
});
