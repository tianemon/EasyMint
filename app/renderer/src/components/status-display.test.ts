import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusBar } from "./StatusBar";
import { useStatusStore } from "../stores/status-store";
import { useTabStore } from "../stores/tab-store";
import { useAskStore } from "../stores/ask-store";
import { uiText } from "../lib/i18n";
import { useSettingsStore } from "../stores/settings-store";

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
vi.mock("../stores/settings-store", async importOriginal => {
  const actual = await importOriginal<typeof import("../stores/settings-store")>();
  return { useSettingsStore: Object.assign((select: (state: ReturnType<typeof actual.useSettingsStore.getState>) => unknown) => select(actual.useSettingsStore.getState()), actual.useSettingsStore) };
});
const initialSettings = useSettingsStore.getState();

afterEach(() => {
  useStatusStore.getState().reset();
  useTabStore.getState().setSessionRunning("session", false);
  useAskStore.setState({ asks: {} });
  useSettingsStore.setState(initialSettings);
});
const render = () => renderToStaticMarkup(createElement(StatusBar, { sessionId: "session" }));

describe("observable run status", () => {
  it.each(["solid", "shimmer"] as const)("keeps terminal text and glyph in the selected %s colors", style => {
    useSettingsStore.setState({ statusTextStyle: style, statusColorLight: "#c05020", statusTextGroupsLight: [{id:"selected",name:"Selected",colors:["#8540c0","#3050b0"]}], activeStatusGroupLight:"selected" });
    for (const label of [uiText("pi.completed"), uiText("pi.cancelled")]) {
      useStatusStore.getState().pushSignal("session", "outcome", label, 4000);
      const html=render();
      expect(html).toContain(label);
      expect(html.match(new RegExp(`color:${style === "solid" ? "#c05020" : "#8540c0"}`,"g"))).toHaveLength(2);
      expect(html).not.toContain("status-glyph-shimmer");
    }
  });
  it("keeps a startup failure visible after the run is idle", () => {
    useStatusStore.getState().pushSignal("session", "error", "authentication failed", 8000);
    expect(render()).toContain("authentication failed");
  });
  it("keeps cancellation feedback while allowing the completed status to end with the execution", () => {
    useStatusStore.getState().pushSignal("session", "outcome", uiText("pi.completed"), 4000);
    expect(renderToStaticMarkup(createElement(StatusBar, { sessionId: "session", showCompletedOutcome: false }))).toBe("");
    useStatusStore.getState().pushSignal("session", "outcome", uiText("pi.cancelled"), 4000);
    expect(renderToStaticMarkup(createElement(StatusBar, { sessionId: "session", showCompletedOutcome: false }))).toContain(uiText("pi.cancelled"));
  });
  it("keeps the live status separate from the execution timer", () => {
    useTabStore.getState().setSessionRunning("session", true);
    const html = renderToStaticMarkup(createElement(StatusBar, { sessionId: "session", expanded: false, onToggle: () => {} }));
    expect(html).toBe("");
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
  it("follows updated parallel tools and keeps full command arguments across argument-less updates", () => {
    const status = useStatusStore.getState();
    useTabStore.getState().setSessionRunning("session", true);
    status.pushSignal("session", "tool:a", "read", undefined, {name:"read",args:{path:"/project/ChatBlocks.tsx"}});
    status.pushSignal("session", "tool:b", "search", undefined, {name:"grep",args:{pattern:"target",path:"src"}});
    expect(render()).toContain("target");
    status.pushSignal("session", "tool:a", "read updated", undefined, {name:"read"});
    expect(render()).toContain("正在读取 ChatBlocks.tsx");
    expect(render()).toContain("正在读取 /project/ChatBlocks.tsx");
    status.popSignal("session", "tool:a");
    expect(render()).toContain("target");
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
