// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_ENVIRONMENT_STATE, type EnvItem, type EnvReport, type EnvironmentState } from "@shared/environment";
import { EnvPanel } from "./EnvPanel";
import { requiredEnvironmentProblems } from "./useEnvironment";
import { uiI18n } from "../../lib/i18n";

vi.mock("../../stores/settings-store", () => ({ useSettingsStore: (selector: (state: unknown) => unknown) => selector({ sandboxDisabled: true, setSandboxDisabled: vi.fn() }) }));
vi.mock("../ui/ConfirmDialog", () => ({ confirmDialog: vi.fn() }));

let container: HTMLDivElement;
let root: Root;
let snapshot: EnvironmentState;
let listener: ((value: EnvironmentState) => void) | undefined;
const probe = vi.fn<() => Promise<EnvironmentState>>();
const install = vi.fn<(ids: string[]) => Promise<EnvironmentState>>();
const cancel = vi.fn(async () => {});

function update(patch: Partial<EnvironmentState>): EnvironmentState {
  snapshot = { ...snapshot, ...patch, revision: snapshot.revision + 1 };
  listener?.(snapshot);
  return snapshot;
}

function windows(status: EnvItem["status"]): EnvReport {
  return {
    items: [
      { id: "windowsRuntime", label: "Portable Git", required: true, status, repairNeeded: status === "unknown",
        fix: status === "ok" ? {} : { auto: { strategy: "windowsRuntime" } } },
      { id: "winSandbox", label: "System protection", required: false, status: "missing", fix: { auto: { strategy: "winInstall" } } },
    ],
    distro: { id: "windows", autoInstallable: false },
    probedAt: 1,
  };
}

function row(id: string): HTMLLIElement {
  const item = container.querySelector<HTMLLIElement>(`[data-environment-id="${id}"]`);
  expect(item).toBeTruthy();
  return item!;
}

function button(name: string, within: ParentNode = container): HTMLButtonElement {
  const matched = [...within.querySelectorAll("button")].find(item => item.textContent === name);
  expect(matched).toBeTruthy();
  return matched!;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await uiI18n.changeLanguage("zh-CN");
  snapshot = DEFAULT_ENVIRONMENT_STATE;
  listener = undefined;
  probe.mockReset().mockImplementation(async () => snapshot);
  install.mockReset().mockImplementation(async () => snapshot);
  cancel.mockClear();
  Object.assign(window, { electronAPI: {
    platform: "win32",
    git: { detect: vi.fn(async () => ({ found: true, version: "fixture" })) },
    nodeRuntime: { detect: async () => ({ found: true, version: "22.14.0" }) },
    codegraph: { detect: async () => ({ found: false, reason: "not-found" }) },
    env: {
      probe, retest: probe, install, cancel,
      onChanged: (cb: (value: EnvironmentState) => void) => { listener = cb; return () => { listener = undefined; }; },
    },
  } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("shows a single Windows runtime row and keeps optional protection behind explicit authorization", async () => {
  update({ report: windows("unknown") });
  await act(async () => root.render(createElement(EnvPanel)));
  expect(row("windowsRuntime").textContent).toContain("需修复");
  expect(container.querySelector('[data-environment-id="git"]')).toBeNull();
  expect(window.electronAPI.git.detect).not.toHaveBeenCalled();
  expect(container.querySelector("svg")).toBeNull();
  expect(install).not.toHaveBeenCalled();
  await act(async () => button("安装", row("winSandbox")).click());
  expect(install).not.toHaveBeenCalled();
  await act(async () => button("取消", row("winSandbox")).click());
  expect(install).not.toHaveBeenCalled();
  await act(async () => button("安装", row("winSandbox")).click());
  await act(async () => button("继续", row("winSandbox")).click());
  expect(install).toHaveBeenCalledExactlyOnceWith(["winSandbox"]);
});

it("keeps runtime progress, cancellation and actionable failure inside its component row", async () => {
  update({ report: windows("unknown") });
  install.mockImplementation(async ids => update({ operation: { ids, phase: "installing", cancellable: true, cancelling: false } }));
  await act(async () => root.render(createElement(EnvPanel, { focusId: "windowsRuntime" })));
  expect(document.activeElement).toBe(row("windowsRuntime"));
  await act(async () => button("修复", row("windowsRuntime")).click());
  expect(row("windowsRuntime").textContent).toContain("正在修复");
  expect(row("windowsRuntime").querySelector('[role="progressbar"]')).toBeTruthy();
  expect(row("winSandbox").querySelector('[role="progressbar"]')).toBeNull();
  expect(button("重新检测").disabled).toBe(true);
  await act(async () => button("取消", row("windowsRuntime")).click());
  expect(cancel).toHaveBeenCalledOnce();
  await act(async () => update({ operation: null, failures: [
    { ids: ["windowsRuntime"], reason: "archive damaged" },
    { ids: ["winSandbox"], reason: "authorization cancelled" },
  ] }));
  expect(row("windowsRuntime").textContent).toContain("archive damaged");
  expect(row("winSandbox").textContent).not.toContain("archive damaged");
  expect(row("winSandbox").textContent).toContain("authorization cancelled");
  expect(row("windowsRuntime").textContent).not.toContain("authorization cancelled");
  expect(button("重试", row("windowsRuntime"))).toBeTruthy();
});

it("first run shows auto preparation in its row, then hands off once following verification", async () => {
  vi.useFakeTimers();
  update({ report: windows("missing") });
  install.mockImplementation(async ids => update({ operation: { ids, phase: "preparing", cancellable: true, cancelling: false } }));
  const onReady = vi.fn();
  await act(async () => root.render(createElement(EnvPanel, { variant: "onboarding", autoFix: true, waitForUser: true, onReady })));
  expect(install).toHaveBeenCalledExactlyOnceWith(["windowsRuntime"]);
  expect(row("windowsRuntime").querySelector('[role="progressbar"]')).toBeTruthy();
  expect(container.querySelector('[data-environment-id="winSandbox"]')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(onReady).not.toHaveBeenCalled();
  await act(async () => update({ report: windows("ok"), operation: null }));
  expect(onReady).toHaveBeenCalledOnce();
  expect(row("windowsRuntime").textContent).toContain("已就绪");
});

it("does not prompt for optional tools when macOS needs nothing to run", async () => {
  update({ report: { ...windows("ok"), items: [], distro: { id: "macos", autoInstallable: false } } });
  Object.assign(window.electronAPI, { platform: "darwin" });
  await act(async () => root.render(createElement(EnvPanel)));
  expect(container.textContent).toContain("环境已就绪");
  expect(container.textContent).toContain("开发工具");
  expect(row("git")).toBeTruthy();
  expect(install).not.toHaveBeenCalled();
});

it("ignores an older initial response after the result arrives on the shared channel", async () => {
  let finish!: (value: EnvironmentState) => void;
  probe.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => root.render(createElement(EnvPanel)));
  await act(async () => update({ report: windows("ok") }));
  await act(async () => { finish({ ...DEFAULT_ENVIRONMENT_STATE, report: windows("missing") }); });
  expect(row("windowsRuntime").textContent).toContain("已就绪");
});

it("counts Linux sandbox prerequisites without double-counting a deferred userns check", () => {
  const report: EnvReport = {
    ...windows("ok"),
    items: [
      { id: "bwrap", label: "bubblewrap", required: true, status: "missing", fix: {} },
      { id: "userns", label: "user namespaces", required: true, status: "unknown", fix: {} },
    ],
  };
  expect(requiredEnvironmentProblems(report, false).map(item => item.id)).toEqual(["bwrap"]);
  expect(requiredEnvironmentProblems(report, true)).toEqual([]);
  expect(requiredEnvironmentProblems(windows("missing"), true).map(item => item.id)).toEqual(["windowsRuntime"]);
});
