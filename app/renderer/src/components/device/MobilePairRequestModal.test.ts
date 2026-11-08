// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobilePairRequestModal } from "./MobilePairRequestModal";

/**
 * 手机配对请求弹窗的回归。
 *
 * 2026-11-08 用户要求「配对确认改成窗口中间弹窗」：本文件锚住三件事——
 *  1. 有一条待确认请求时，设备名与 6 位验证码都真的渲染出来（验证码是给人比对的，不能被简化掉）；
 *  2. 「拒绝」把当前 requestId 交给主进程，而不是关掉弹窗当作没发生；
 *  3. 没有请求时组件返回 null（不留下空遮罩挡住整个窗口）。
 */

const request = {
  requestId: "req-1",
  deviceId: "web-abcdef012345",
  deviceName: "iPhone · Safari",
  verificationCode: "427913",
  expiresAt: Date.now() + 60_000,
};

let container: HTMLDivElement;
let root: Root;
let listPending: ReturnType<typeof vi.fn>;
let acceptPair: ReturnType<typeof vi.fn>;
let rejectPair: ReturnType<typeof vi.fn>;

function stubElectron(): void {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    mobileTerminal: {
      listPending,
      acceptPair,
      rejectPair,
      onChanged: () => () => {},
      onPairRequest: () => () => {},
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  listPending = vi.fn(async () => [request]);
  acceptPair = vi.fn(async () => ({ ok: true }));
  rejectPair = vi.fn(async () => ({ ok: true }));
  stubElectron();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(): Promise<void> {
  await act(async () => {
    root.render(createElement(MobilePairRequestModal));
  });
  // listPending 是 await 的，再走一拍让状态落定
  await act(async () => { await Promise.resolve(); });
}

it("渲染设备名与 6 位验证码，验证码不能被省掉", async () => {
  await render();
  // Modal 走 createPortal 挂到 body，查询必须从 body 出发，不能在容器里找
  const text = document.body.textContent ?? "";
  expect(text).toContain("iPhone · Safari");
  expect(text).toContain("427913");
  // 验证码用等宽字体与大字距，隔一屏也能读清
  expect(document.body.querySelector(".font-mono")?.textContent).toContain("427913");
});

it("点「拒绝」把 requestId 交给主进程", async () => {
  await render();
  const reject = Array.from(document.body.querySelectorAll("button"))
    .find((button) => (button.textContent ?? "").includes("拒绝"));
  expect(reject).toBeTruthy();
  await act(async () => { reject!.click(); });
  expect(rejectPair).toHaveBeenCalledWith("req-1");
  expect(acceptPair).not.toHaveBeenCalled();
});

it("点「确认」接受同一 requestId", async () => {
  await render();
  const confirm = Array.from(document.body.querySelectorAll("button"))
    .find((button) => (button.textContent ?? "").includes("确认"));
  await act(async () => { confirm!.click(); });
  expect(acceptPair).toHaveBeenCalledWith("req-1");
});

it("没有待确认请求时不渲染任何东西，不留空遮罩", async () => {
  listPending.mockImplementation(async () => []);
  await render();
  expect(document.body.querySelector(".modal-card")).toBeNull();
  expect(container.textContent).toBe("");
  expect(document.body.textContent).toBe("");
});

it("请求已过期（本地时间越过 expiresAt）就不再弹", async () => {
  listPending.mockImplementation(async () => [{ ...request, expiresAt: Date.now() - 1 }]);
  await render();
  expect(document.body.querySelector(".modal-card")).toBeNull();
});
