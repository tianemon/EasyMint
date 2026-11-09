// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileConnectionGuide, useMobileConnectionGuide, dismissMobileConnectionGuide } from "./MobileConnectionGuide";

const state = vi.hoisted(() => ({ modal: false }));
vi.mock("../ui/Modal", () => ({ hasOpenModal: () => state.modal }));
vi.mock("../../lib/i18n", () => ({ uiText: (key: string) => key, useUiLocale: () => "zh-CN" }));
function Harness({ blocked = false, onOpen }: { blocked?: boolean; onOpen: () => void }): JSX.Element | null {
  const guide = useMobileConnectionGuide(blocked);
  return guide.visible ? createElement(MobileConnectionGuide, { onClose: guide.dismiss, onOpen: () => { guide.dismiss(); onOpen(); } }) : null;
}
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>(); vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }); state.modal = false;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const render = async (blocked = false, onOpen = vi.fn()): Promise<void> => { await act(async () => root.render(createElement(Harness, { blocked, onOpen }))); };
const advance = async (ms: number): Promise<void> => { await act(async () => { vi.advanceTimersByTime(ms); }); };
it("dismisses persistently and does not reappear after remount", async () => {
  await render(); await advance(1800); expect(container.querySelector("section")).not.toBeNull();
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="common.close"]')!.click(); });
  expect(container.querySelector("section")).toBeNull(); expect(localStorage.getItem("easymint_mobile_connection_guide_v2")).toBe("dismissed");
  await act(async () => root.unmount()); root = createRoot(container); await render(); await advance(5000); expect(container.querySelector("section")).toBeNull();
});
it("opens the existing action and dismisses on use", async () => {
  const open = vi.fn(); await render(false, open); await advance(1800);
  await act(async () => { container.querySelector<HTMLButtonElement>(".mobile-connection-guide-open")!.click(); });
  expect(open).toHaveBeenCalledTimes(1); expect(container.querySelector("section")).toBeNull(); expect(localStorage.getItem("easymint_mobile_connection_guide_v2")).toBe("dismissed");
});
it("waits for an existing guide or modal instead of covering it", async () => {
  await render(true); await advance(5000); expect(container.querySelector("section")).toBeNull();
  state.modal = true; await render(false); await advance(1800); expect(container.querySelector("section")).toBeNull();
  state.modal = false; await advance(1000); expect(container.querySelector("section")).not.toBeNull();
});

it("opening the existing toolbox entry before the timer prevents the hint", async () => {
  await render(); await act(async () => { dismissMobileConnectionGuide(); }); await advance(5000);
  expect(container.querySelector("section")).toBeNull(); expect(localStorage.getItem("easymint_mobile_connection_guide_v2")).toBe("dismissed");
});

it("persists opening the guide even if renderer local storage is unavailable", async () => {
  let saved = false;
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("storage unavailable"); } });
  Object.defineProperty(window, "electronAPI", { configurable: true, value: { settings: {
    get: vi.fn(async () => ({ mobileConnectionGuideDismissed: saved })),
    set: vi.fn(async (key: string, value: boolean) => { if (key === "mobileConnectionGuideDismissed") saved = value; }),
  } } });
  await render(); await advance(1800);
  await act(async () => { container.querySelector<HTMLButtonElement>(".mobile-connection-guide-open")!.click(); });
  expect(saved).toBe(true);
  await act(async () => root.unmount()); root = createRoot(container); await render(); await advance(5000);
  expect(container.querySelector("section")).toBeNull(); Reflect.deleteProperty(window, "electronAPI");
});

it("a late settings read cannot undo an earlier dismissal", async () => {
  let finish!: (value: { mobileConnectionGuideDismissed: boolean }) => void;
  Object.defineProperty(window, "electronAPI", { configurable: true, value: { settings: {
    get: () => new Promise(resolve => { finish = resolve; }), set: vi.fn(async () => {}),
  } } });
  await render(); await act(async () => { dismissMobileConnectionGuide(); });
  await act(async () => { finish({ mobileConnectionGuideDismissed: false }); await Promise.resolve(); });
  await advance(5000); expect(container.querySelector("section")).toBeNull(); Reflect.deleteProperty(window, "electronAPI");
});
