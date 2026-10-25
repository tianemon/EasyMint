// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExecutionTimer, IdentityTime } from "./ExecutionTimer";
import { uiI18n } from "../lib/i18n";

let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(61000);
  await uiI18n.changeLanguage("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await uiI18n.changeLanguage("zh-CN");
});

it("updates the identity clock and freezes at the measured final duration", async () => {
  await act(async () => root.render(createElement(ExecutionTimer, { startedAt: 0, processed: true })));
  expect(container.textContent).toBe("已处理 1分1秒");
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(container.textContent).toBe("已处理 1分3秒");
  await act(async () => root.render(createElement(IdentityTime, { durationMs: 62500 })));
  expect(container.textContent).toBe("用时 1分钟 2秒");
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => { vi.advanceTimersByTime(10000); });
  expect(container.textContent).toBe("用时 1分钟 2秒");
});

it("keeps unknown durations blank and translates known durations", async () => {
  await act(async () => root.render(createElement(IdentityTime, {})));
  expect(container.textContent).toBe("");
  await act(async () => root.render(createElement(IdentityTime, { durationMs: 0 })));
  expect(container.textContent).toBe("用时 0分钟 0秒");
  await act(async () => { await uiI18n.changeLanguage("en"); });
  expect(container.textContent).toBe("Elapsed 0m 0s");
});
