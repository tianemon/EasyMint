// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// 二维码渲染与业务无关，这里只验证「开关 ↔ 页签」的联动，图直接给个占位
vi.mock("qrcode", () => ({ default: { toDataURL: async () => "data:image/png;base64,AAAA" } }));

import { MobileTerminalSection } from "./MobileTerminalSection";

/**
 * 开关与二维码页签的联动（用户报过的问题）。
 *
 * 曾经两个开关各写一套判定：开 App 会切到 App 码，开浏览器却不切。
 * 这条用例直接点真实的开关按钮，断言两种动作产生同一种结果。
 */

let container: HTMLDivElement;
let root: Root;
let webEnabled: boolean;
let appEnabled: boolean;

function webStatus() {
  return {
    enabled: webEnabled,
    port: 47_779,
    running: webEnabled,
    lanAddresses: ["192.168.1.8"],
    onlineWebDevices: 0,
    bridgeReady: true,
  };
}

function appStatus() {
  return { enabled: appEnabled, running: appEnabled, port: 47_778, paired: 0, online: 0 };
}

function unsubscribe(): void {}

function stubElectron(): void {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    mobileWeb: {
      getStatus: async () => webStatus(),
      setEnabled: async (next: boolean) => { webEnabled = next; return webStatus(); },
      setPort: async () => webStatus(),
      createPairLink: async () => ({ code: "ABCDEFGHIJ", expiresAt: Date.now() + 60_000 }),
      onStatusChanged: () => unsubscribe,
    },
    mobileTerminal: {
      getStatus: async () => appStatus(),
      setEnabled: async (next: boolean) => { appEnabled = next; return appStatus(); },
      setPort: async () => appStatus(),
      createOffer: async () => ({ uri: "easymint://pair?h=192.168.1.8&p=47778&c=ABCDEF", expiresAt: Date.now() + 90_000 }),
      listDevices: async () => [],
      revoke: async () => true,
      onChanged: () => unsubscribe,
      onPairRequest: () => unsubscribe,
      onError: () => unsubscribe,
    },
  };
}

function toggleFor(label: string): HTMLButtonElement {
  // 通道行里：名称 → 端口输入 → 开关，所以从名称所在行向上找 role=switch
  const row = [...document.querySelectorAll("div")].find((node) => node.textContent?.trim() === label);
  const scope = row?.parentElement?.parentElement ?? document.body;
  const button = scope.querySelector<HTMLButtonElement>('button[role="switch"]');
  if (!button) throw new Error(`找不到 ${label} 的开关`);
  return button;
}

function activeTab(): string {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
  const active = buttons.filter((node) => node.className.includes("bg-accent text-text-inverse"));
  return active.map((node) => node.textContent ?? "").join("|");
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  webEnabled = false;
  appEnabled = true;
  stubElectron();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(MobileTerminalSection)));
  await flush();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("浏览器通道关着时默认展示 App 码", () => {
  expect(activeTab()).toContain("App");
});

it("打开浏览器开关会切到浏览器二维码（与开 App 开关的行为一致）", async () => {
  const button = toggleFor("手机浏览器");
  expect(button.getAttribute("aria-checked")).toBe("false");
  await act(async () => button.click());
  await flush();
  expect(webEnabled).toBe(true);
  expect(activeTab()).toContain("浏览器");
});

it("关掉正在看的浏览器通道会退回 App 码，关掉 App 通道则退回浏览器码", async () => {
  // 打开浏览器通道 → 页签在浏览器
  await act(async () => toggleFor("手机浏览器").click());
  await flush();
  expect(activeTab()).toContain("浏览器");

  // 关掉浏览器通道 → 退回 App（App 还开着）
  await act(async () => toggleFor("手机浏览器").click());
  await flush();
  expect(activeTab()).toContain("App");

  // 打开浏览器、切到它，再关掉 App → 页签留在浏览器
  await act(async () => toggleFor("手机浏览器").click());
  await flush();
  await act(async () => toggleFor("手机 App").click());
  await flush();
  expect(appEnabled).toBe(false);
  expect(activeTab()).toContain("浏览器");
});
