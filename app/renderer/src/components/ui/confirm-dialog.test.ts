// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConfirmHost, confirmDialog } from "./ConfirmDialog";

/**
 * 确认弹窗的按钮观感回归。
 *
 * 2026-10-29 用户要求「按钮不要边框、重置确认不要红色」：本文件的断言锚住两件事——
 * 两个按钮的 className 里不再出现 border*（项目弹窗基调是无边框），以及**非删除类**确认
 * （额度重置）用强调色主按钮而不是危险红。策略是断言「没有边框类」+「危险语义仍在」，
 * 不锁死具体配色 token——换色时不必改测试，但把描边加回来一定会红。
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(ConfirmHost)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === text);
  if (!found) throw new Error(`找不到按钮：${text}`);
  return found;
}

it("draws cancel and danger buttons without any border, keeping the danger tone", async () => {
  await act(async () => {
    void confirmDialog({ title: "删除供应商", message: "该操作不可撤销", confirmText: "删除", danger: true });
  });
  const danger = button("删除");
  expect(danger.className).toContain("text-danger");
  expect(danger.className).not.toContain("border");
  expect(button("取消").className).not.toContain("border");
  await act(async () => button("取消").click());
  expect(document.querySelectorAll("button")).toHaveLength(0);
});

it("uses the accent button for the non-destructive plan-reset confirmation", async () => {
  await act(async () => {
    void confirmDialog({ title: "消耗 1 次手动重置", message: "消耗后不可撤销", confirmText: "使用一次重置" });
  });
  const confirm = button("使用一次重置");
  expect(confirm.className).toContain("btn-accent");
  expect(confirm.className).not.toContain("danger");
  expect(confirm.className).not.toContain("border");
  await act(async () => confirm.click());
  expect(document.querySelectorAll("button")).toHaveLength(0);
});
