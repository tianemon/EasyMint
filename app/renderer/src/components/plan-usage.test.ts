// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlanUsageButton } from "./PlanUsageButton";
import { useSettingsStore } from "../stores/settings-store";
import type { ApiProvidersData } from "@shared/platform-presets";

let container: HTMLDivElement;
let root: Root;
const codexQuota = vi.fn();
const providers: ApiProvidersData = { current: "codex", configs: {
  codex: { id: "codex", name: "Codex", presetId: "openai-codex", authType: "oauth", apiKey: "", model: "gpt", models: ["gpt"], createdAt: 0 },
  api: { id: "api", name: "API", presetId: "openai", apiKey: "", model: "gpt", models: ["gpt"], createdAt: 0 },
} };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.assign(window, { electronAPI: { provider: { codexQuota } } });
  codexQuota.mockReset();
  useSettingsStore.setState({ apiProviders: providers });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("loads subscription windows from its own entry without a session and dismisses on provider switch", async () => {
  codexQuota.mockResolvedValue({ ok: true, quota: { primary: { usedPercent: 25, windowSeconds: 18000, reached: false }, secondary: { usedPercent: 60, windowSeconds: 604800, reached: false }, credits: { available: 0, items: [] }, fetchedAt: 0 } });
  await act(async () => root.render(createElement(PlanUsageButton)));
  expect(codexQuota).not.toHaveBeenCalled();
  await act(async () => container.querySelector("button")!.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("25%");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("60%");
  expect(codexQuota).toHaveBeenCalledTimes(1);
  await act(async () => useSettingsStore.setState({ apiProviders: { ...providers, current: "api" } }));
  expect(container.textContent).toBe("");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => useSettingsStore.setState({ apiProviders: providers }));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("shows a loading state, then allows retry after an unavailable quota response", async () => {
  let resolveQuota!: (value: unknown) => void;
  codexQuota.mockImplementationOnce(() => new Promise(resolve => { resolveQuota = resolve; }));
  await act(async () => root.render(createElement(PlanUsageButton)));
  await act(async () => container.querySelector("button")!.click());
  expect(document.querySelector('[role="status"]')?.textContent).toMatch(/正在获取|Loading/);
  await act(async () => resolveQuota({ ok: false, reason: "network" }));
  const retry = document.querySelector<HTMLButtonElement>('[role="status"] button');
  expect(retry).not.toBeNull();
  codexQuota.mockResolvedValueOnce({ ok: true, quota: { credits: { available: 0, items: [] }, fetchedAt: 0 } });
  await act(async () => retry!.click());
  expect(codexQuota).toHaveBeenLastCalledWith(true);
  expect(document.querySelector('[role="status"]')).toBeNull();
});
