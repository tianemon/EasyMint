import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: { fromId: () => null } }));

import { waitForProjectWindow } from "./window-manager";

describe("waitForProjectWindow（手机端开窗后的登记等待）", () => {
  it("已登记时立即返回，不多轮询", async () => {
    const isOpen = vi.fn(() => true);
    await expect(waitForProjectWindow("p1", { isOpen, timeoutMs: 50, pollMs: 1 })).resolves.toBeUndefined();
    expect(isOpen).toHaveBeenCalledOnce();
  });

  it("延迟登记后成功返回", async () => {
    let calls = 0;
    const isOpen = () => ++calls >= 3;
    await expect(waitForProjectWindow("p1", { isOpen, timeoutMs: 200, pollMs: 1 })).resolves.toBeUndefined();
    expect(calls).toBe(3);
  });

  it("超时抛错，文案如实说明窗口已在桌面端打开", async () => {
    await expect(waitForProjectWindow("p1", { isOpen: () => false, timeoutMs: 20, pollMs: 1 }))
      .rejects.toThrow("项目窗口已在桌面端打开");
  });
});
