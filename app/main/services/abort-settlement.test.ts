import { describe, expect, it } from "vitest";
import { waitForAbortSettlement } from "./abort-settlement";

describe("停止回合等待", () => {
  it("SDK 和 prompt 都收尾后允许继续撤回判定", async () => {
    expect(await waitForAbortSettlement(Promise.resolve(), Promise.resolve(), 100)).toBe(true);
  });

  it("SDK 永远不进入 idle 时在预算内返回，不无限挂住停止 IPC", async () => {
    const never = new Promise<void>(() => {});
    expect(await waitForAbortSettlement(never, never, 5)).toBe(false);
  });
});
