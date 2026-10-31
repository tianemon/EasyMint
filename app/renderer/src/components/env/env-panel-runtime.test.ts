// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EnvPanel, nextAutoAction } from "./EnvPanel";

vi.mock("../../stores/settings-store", () => ({ useSettingsStore: (selector: (state: unknown) => unknown) => selector({ sandboxDisabled: true, setSandboxDisabled: vi.fn() }) }));
vi.mock("../ui/ConfirmDialog", () => ({ confirmDialog: vi.fn() }));
let container: HTMLDivElement, root: Root;
const report = (status: EnvItemShape["status"]): EnvReportShape => ({
  items: [
    { id: "windowsRuntime", label: "Git + Bash fixture", required: true, status, fix: status === "ok" ? {} : { auto: { strategy: "windowsRuntime" } } },
    { id: "winSandbox", label: "Sandbox UAC fixture", required: false, status: "missing", fix: { auto: { strategy: "winInstall" } } },
  ], distro: { id: "windows", autoInstallable: false }, probedAt: 1,
});
const probe = vi.fn(), install = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  probe.mockReset(); install.mockReset();
  Object.assign(window, { electronAPI: { env: { probe, retest: probe, install, cancel: vi.fn() } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("onboarding prepares only portable runtime even with sandbox disabled, then continues without UAC", async () => {
  vi.useFakeTimers();
  probe.mockResolvedValue(report("missing")); install.mockResolvedValue({ ok: true, report: report("ok") });
  const onReady = vi.fn();
  await act(async () => root.render(createElement(EnvPanel, { variant: "onboarding", autoFix: true, onReady })));
  expect(install).toHaveBeenCalledExactlyOnceWith(["windowsRuntime"]);
  expect(container.textContent).not.toContain("Sandbox UAC fixture");
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(onReady).toHaveBeenCalledOnce();
  expect(install).toHaveBeenCalledTimes(1);
});

it("settings installs sandbox only after an explicit click and never mixes it with runtime repair", async () => {
  probe.mockResolvedValue(report("unknown")); install.mockResolvedValue({ ok: true, report: report("unknown") });
  await act(async () => root.render(createElement(EnvPanel, { variant: "settings" })));
  expect(install).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Sandbox UAC fixture");
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.includes("安装系统保护"));
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(install).toHaveBeenCalledExactlyOnceWith(["winSandbox"]);
});

it("settings can repair an installed but broken runtime, with errors kept inside the panel", async () => {
  probe.mockResolvedValue(report("unknown")); install.mockResolvedValue({ ok: false, reason: "archive damaged", report: report("unknown") });
  await act(async () => root.render(createElement(EnvPanel, { variant: "settings" })));
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(b => !b.textContent?.includes("系统保护") && /安装/.test(b.textContent ?? ""));
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(install).toHaveBeenCalledExactlyOnceWith(["windowsRuntime"]);
  expect(container.textContent).toContain("archive damaged");
});

it("automatically prepares the portable runtime once, independently of sandbox settings", () => {
  const state = { autoFix: true, hasReport: true, probeFailed: false, probing: false, installing: false, sandboxDisabled: true, installableCount: 0, fixableCount: 0, runtimeCount: 1 };
  expect(nextAutoAction({ ...state, done: new Set() })).toBe("windowsRuntime");
  expect(nextAutoAction({ ...state, done: new Set(["windowsRuntime"]) })).toBeNull();
});
