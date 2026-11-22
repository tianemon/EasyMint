// @vitest-environment happy-dom
vi.mock("../../../shared/windows-sandbox", () => ({ WINDOWS_SANDBOX_ENABLED: true }));
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSandboxDraftPrewarm } from "./use-sandbox-draft-prewarm";
import { useStatusStore } from "../stores/status-store";
vi.mock("../lib/i18n", () => ({ uiText: (key: string) => key }));

let root: Root, element: HTMLDivElement;
let prepare: ReturnType<typeof vi.fn>, cancel: ReturnType<typeof vi.fn>, settings: ReturnType<typeof vi.fn>;
let progress: ((data: { tabId: string; token: string; state: "stopping" }) => void) | undefined;
let refs: { sidRef: { current: string }; permissionModeRef: { current: "standard" }; pendingFirstTurnRef: { current: boolean }; sessionHydrationRef: { current: Promise<void> }; sandboxDraftTokenRef: { current: string | null } };
function View(props: { active?: boolean; mode?: "standard" | "full" }): null {
  useSandboxDraftPrewarm({ active: props.active ?? true, projectPath: "project", tabId: "tab", permissionMode: props.mode ?? "standard", ...refs });
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  prepare = vi.fn(); cancel = vi.fn().mockResolvedValue(undefined); settings = vi.fn().mockResolvedValue({ chatPermissionMode: "standard" });
  progress = undefined;
  (window as unknown as { electronAPI: unknown }).electronAPI = { platform: "win32", agent: { prepareSandboxDraft: prepare, cancelSandboxDraft: cancel, onSandboxDraftProgress: (listener: typeof progress) => { progress = listener; return () => { progress = undefined; }; } }, settings: { get: settings }, sessionCache: { read: vi.fn() } };
  refs = { sidRef: { current: "__new_test" }, permissionModeRef: { current: "standard" }, pendingFirstTurnRef: { current: false }, sessionHydrationRef: { current: Promise.resolve() }, sandboxDraftTokenRef: { current: null } };
  useStatusStore.getState().reset(); element = document.createElement("div"); document.body.append(element); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); useStatusStore.getState().reset(); vi.unstubAllGlobals(); });

it("does not prewarm if the saved default is full access", async () => {
  settings.mockResolvedValue({ chatPermissionMode: "full" });
  await act(async () => { root.render(createElement(View)); });
  expect(prepare).not.toHaveBeenCalled();
});

it("shows preparation while waiting and cancels its own draft on close", async () => {
  let finish!: (value: { state: "ready" }) => void;
  prepare.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { root.render(createElement(View)); });
  expect(prepare).toHaveBeenCalledOnce();
  expect(useStatusStore.getState().bySession.__new_test?.signals.some(signal => signal.text === "ui.ChatPanel.preparingSandbox")).toBe(true);
  const token = refs.sandboxDraftTokenRef.current; expect(token).toBeTruthy();
  await act(async () => { progress?.({ tabId: "tab", token: token!, state: "stopping" }); });
  expect(useStatusStore.getState().bySession.__new_test?.signals.some(signal => signal.text === "ui.ChatPanel.finishingSandbox")).toBe(true);
  await act(async () => { root.render(createElement(View, { active: false })); });
  expect(cancel).toHaveBeenCalledWith("tab", token);
  await act(async () => { finish({ state: "ready" }); });
  expect(useStatusStore.getState().bySession.__new_test?.signals ?? []).toEqual([]);
});

it("does not start a late draft after the first message has begun", async () => {
  let finish!: (value: { chatPermissionMode: string }) => void;
  settings.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { root.render(createElement(View)); });
  refs.pendingFirstTurnRef.current = true;
  await act(async () => { finish({ chatPermissionMode: "standard" }); });
  expect(prepare).not.toHaveBeenCalled();
});
it("cancels the matching draft when the mode changes to full", async () => {
  let finish!: (value: { state: "ready" }) => void;
  prepare.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { root.render(createElement(View)); });
  const token = refs.sandboxDraftTokenRef.current;
  await act(async () => { root.render(createElement(View, { mode: "full" })); });
  expect(cancel).toHaveBeenCalledWith("tab", token);
  await act(async () => { finish({ state: "ready" }); });
  expect(useStatusStore.getState().bySession.__new_test?.signals ?? []).toEqual([]);
});
