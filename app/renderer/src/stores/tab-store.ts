import { create } from "zustand";

export interface Tab {
  id: string;
  type: "file" | "chat";
  title: string;
  filePath?: string;
  sessionId?: string;
}

interface TabState {
  tabs: Tab[];
  activeTabId: string | null;
  openTab: (tab: Tab) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  clearTabs: () => void;
}

let nextTabIdx = 0;

function genId(): string {
  nextTabIdx += 1;
  return `tab-${Date.now()}-${nextTabIdx}`;
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  openTab: (tab) => {
    const { tabs } = get();
    const existing = tabs.find(
      (t) =>
        (tab.type === "file" && t.type === "file" && t.filePath === tab.filePath) ||
        (tab.type === "chat" && t.type === "chat" && t.sessionId === tab.sessionId)
    );
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const newTab: Tab = { ...tab, id: tab.id || genId() };
    set((s) => ({ tabs: [...s.tabs, newTab], activeTabId: newTab.id }));
  },

  closeTab: (id) => {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      const nextTabs = s.tabs.filter((t) => t.id !== id);
      let nextActiveId = s.activeTabId;
      if (s.activeTabId === id) {
        if (nextTabs.length === 0) {
          nextActiveId = null;
        } else {
          const nextIdx = Math.min(idx, nextTabs.length - 1);
          nextActiveId = nextTabs[nextIdx]?.id ?? null;
        }
      }
      return { tabs: nextTabs, activeTabId: nextActiveId };
    });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  clearTabs: () => set({ tabs: [], activeTabId: null }),
}));
