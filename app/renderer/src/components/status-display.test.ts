import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusBar } from "./StatusBar";
import { useStatusStore } from "../stores/status-store";
import { useTabStore } from "../stores/tab-store";
import { useAskStore } from "../stores/ask-store";
import { uiText } from "../lib/i18n";

vi.hoisted(() => { vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} }); });
vi.mock("../stores/theme-store", () => ({ useThemeStore: (select: (state: { effective: string }) => unknown) => select({ effective: "light" }) }));
// SSR uses Zustand's initial snapshot; select the current isolated store for these renders.
vi.mock("../stores/status-store", async importOriginal => {
  const actual = await importOriginal<typeof import("../stores/status-store")>();
  return { useStatusStore: Object.assign((select: (state: ReturnType<typeof actual.useStatusStore.getState>) => unknown) => select(actual.useStatusStore.getState()), actual.useStatusStore) };
});
vi.mock("../stores/tab-store", async importOriginal => {
  const actual = await importOriginal<typeof import("../stores/tab-store")>();
  return { useTabStore: Object.assign((select: (state: ReturnType<typeof actual.useTabStore.getState>) => unknown) => select(actual.useTabStore.getState()), actual.useTabStore) };
});
vi.mock("../stores/ask-store", async importOriginal => {
  const actual = await importOriginal<typeof import("../stores/ask-store")>();
  return { useAskStore: Object.assign((select: (state: ReturnType<typeof actual.useAskStore.getState>) => unknown) => select(actual.useAskStore.getState()), actual.useAskStore) };
});

afterEach(() => {
  useStatusStore.getState().reset();
  useTabStore.getState().setSessionRunning("session", false);
  useAskStore.setState({ asks: {} });
});
const render = () => renderToStaticMarkup(createElement(StatusBar, { sessionId: "session" }));

describe("observable run status", () => {
  it("keeps a startup failure visible after the run is idle", () => {
    useStatusStore.getState().pushSignal("session", "error", "authentication failed", 8000);
    expect(render()).toContain("authentication failed");
  });
  it("shows the remaining parallel tool after another tool finishes", () => {
    const status = useStatusStore.getState();
    useTabStore.getState().setSessionRunning("session", true);
    status.pushSignal("session", "tool:first", "first tool");
    status.pushSignal("session", "tool:second", "second tool");
    status.popSignal("session", "tool:second");
    status.pushSignal("session", "request", "processing");
    expect(render()).toContain("first tool");
    expect(render()).not.toContain("processing");
  });
  it("does not replace a new run with an old failure", () => {
    const status = useStatusStore.getState();
    useTabStore.getState().setSessionRunning("session", true);
    status.pushSignal("session", "error", "old failure", 8000);
    status.pushSignal("session", "request", "waiting for model");
    expect(render()).toContain("waiting for model");
    expect(render()).not.toContain("old failure");
  });
  it("prioritizes the actual user question and stopping over noisy tool updates", () => {
    useTabStore.getState().setSessionRunning("session", true);
    useAskStore.getState().setAsk({ requestId: "ask", sessionId: "session", questions: [], allowCustom: true });
    useStatusStore.getState().pushSignal("session", "tool:a", "working tool");
    expect(render()).toContain(uiText("pi.waitingUser"));
    expect(render()).not.toContain("model-glyph-node-a");
    useStatusStore.getState().pushSignal("session", "stopping", "stopping now");
    expect(render()).toContain("stopping now");
    expect(render()).not.toContain(uiText("pi.waitingUser"));
  });
  it("keeps retry and compaction ahead of tool progress and hides idle tool residue", () => {
    const status = useStatusStore.getState();
    useTabStore.getState().setSessionRunning("session", true);
    status.pushSignal("session", "retry", "retrying now");
    status.pushSignal("session", "tool:a", "tool");
    expect(render()).toContain("retrying now");
    status.pushSignal("session", "compact", "compacting now");
    expect(render()).toContain("compacting now");
    useTabStore.getState().setSessionRunning("session", false);
    expect(render()).toBe("");
  });
});
