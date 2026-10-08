import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForAbortSettlement, settleSessionIdle } from "./abort-settlement";

afterEach(() => vi.useRealTimers());

describe("停止回合等待", () => {
  it("SDK 和 prompt 都收尾后允许继续撤回判定", async () => {
    expect(await waitForAbortSettlement(Promise.resolve(), Promise.resolve(), 100)).toBe(true);
  });

  it("SDK 永远不进入 idle 时在预算内返回，不无限挂住停止 IPC", async () => {
    const never = new Promise<void>(() => {});
    expect(await waitForAbortSettlement(never, never, 5)).toBe(false);
  });

  it("残留忙碌态恢复超时会返回失败并释放定时器", async () => {
    vi.useFakeTimers();
    const never = new Promise<void>(() => {});
    const result = settleSessionIdle({ abort: () => never, waitForIdle: () => never, isStreaming: true }, 8000);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await result).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("只有 SDK 确认不再 streaming 才允许继续，已结束时清掉超时任务", async () => {
    vi.useFakeTimers();
    for (const isStreaming of [true, false]) {
      expect(await settleSessionIdle({ abort: async () => {}, waitForIdle: async () => {}, isStreaming }, 8000)).toBe(!isStreaming);
      expect(vi.getTimerCount()).toBe(0);
    }
  });
});
