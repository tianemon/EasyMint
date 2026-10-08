import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uiI18n } from "../lib/i18n";

const storage = new Map<string, string>();
const save = vi.fn();
vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
vi.stubGlobal("window", { location: { hash: "" }, electronAPI: { platform: "darwin", tab: { save }, agent: {} } });
vi.mock("./chat-store", () => ({ useChatStore: { getState: () => ({ evictSession: vi.fn() }) } }));
// SSR otherwise reads Zustand's initial snapshot; exercise the actual store state.
vi.mock("./tab-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tab-store")>();
  return { ...actual, useTabStore: Object.assign(
    (selector: (state: ReturnType<typeof actual.useTabStore.getState>) => unknown) => selector(actual.useTabStore.getState()),
    actual.useTabStore,
  ) };
});
const { useTabStore } = await import("./tab-store");
const { sessionListActions } = await import("./session-list-actions");
const { TabBar } = await import("../components/TabBar");

afterEach(async () => {
  useTabStore.setState({ tabs: [], activeTabId: null });
  storage.clear();
  save.mockClear();
  await uiI18n.changeLanguage("zh-CN");
});

describe("localized tab placeholders", () => {
  it("updates the real tab bar without translating identically named user sessions or files", async () => {
    useTabStore.getState().openTab({ id: "default", type: "chat", title: "新会话", titleKey: "ui.App.newSession", sessionId: "default-session" });
    useTabStore.getState().openSession("user-session", "新会话");
    useTabStore.getState().openTab({ id: "file", type: "file", title: "中文.ts", filePath: "/中文.ts" });
    for (const locale of ["en", "zh-CN", "en"]) {
      await uiI18n.changeLanguage(locale);
      const html = renderToStaticMarkup(createElement(TabBar));
      expect(html).toContain(locale === "en" ? ">New session</span>" : ">新会话</span>");
      expect(html).toContain(">新会话</span>");
      expect(html).toContain(">中文.ts</span>");
    }
  });

  it("clears placeholder ownership even when the real title equals the old display string", async () => {
    useTabStore.getState().openTab({ id: "tab", type: "chat", title: "新会话", titleKey: "ui.App.newSession", sessionId: "session" });
    sessionListActions.applyTitle("session", "新会话");
    expect(useTabStore.getState().tabs[0]?.titleKey).toBeUndefined();
    await uiI18n.changeLanguage("en");
    expect(renderToStaticMarkup(createElement(TabBar))).not.toContain(">New session</span>");
    useTabStore.getState().updateTab("tab", { titleKey: "ui.App.newSession" });
    useTabStore.getState().openSession("session", "新会话");
    expect(useTabStore.getState().tabs[0]?.titleKey).toBeUndefined();
  });

  it("persists and backs up placeholder identity, retaining it on non-title updates", () => {
    useTabStore.getState().openSession("session");
    const tab = useTabStore.getState().tabs[0]!;
    useTabStore.getState().updateTab(tab.id, { dirty: true });
    expect(useTabStore.getState().tabs[0]?.titleKey).toBe("ui.tab-store.conversation");
    const persisted = JSON.parse(storage.get("easymint-tabs")!);
    expect(persisted.state.tabs[0].titleKey).toBe("ui.tab-store.conversation");
    expect(save.mock.lastCall?.[0].tabs[0].titleKey).toBe("ui.tab-store.conversation");
    useTabStore.getState().closeTab(tab.id);
    expect(useTabStore.getState().tabs[0]?.titleKey).toBe("ui.App.newSession");
  });
});
