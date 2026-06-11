import { create } from "zustand";
import { useChatStore } from "./chat-store";

export interface Tab {
  id: string;
  type: "file" | "chat";
  title: string;
  filePath?: string;
  sessionId?: string;
  isNewProject?: boolean;
  dirty?: boolean;
}

interface TabState {
  tabs: Tab[];
  activeTabId: string | null;
  runningSessions: Set<string>;
  openTab: (tab: Tab) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  clearTabs: () => void;
  setDirty: (id: string, dirty: boolean) => void;
  updateTab: (id: string, patch: Partial<Omit<Tab, "id">>) => void;
  setSessionRunning: (sessionId: string, running: boolean) => void;
}

let nextTabIdx = 0;

function genId(): string {
  nextTabIdx += 1;
  return `tab-${Date.now()}-${nextTabIdx}`;
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  runningSessions: new Set<string>(),

  openTab: (tab) => {
    const { tabs } = get();
    const existing = tabs.find(
      (t) =>
        (tab.type === "file" && t.type === "file" && t.filePath === tab.filePath) ||
        // Only dedup by sessionId if it's a real SDK session (not undefined=new)
        (tab.type === "chat" && t.type === "chat" && tab.sessionId && t.sessionId === tab.sessionId)
    );
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const newTab: Tab = { ...tab, id: tab.id || genId() };
    set((s) => ({ tabs: [...s.tabs, newTab], activeTabId: newTab.id }));
  },

  closeTab: (id) => {
    // Evict chat messages from memory when tab is closed
    const tab = get().tabs.find((t) => t.id === id);
    if (tab?.sessionId) {
      useChatStore.getState().evictSession(tab.sessionId);
    }
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

  setDirty: (id, dirty) => set((s) => ({
    tabs: s.tabs.map((t) => (t.id === id ? { ...t, dirty } : t)),
  })),

  updateTab: (id, patch) => set((s) => ({
    tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  })),

  setSessionRunning: (sessionId, running) => set((s) => {
    const next = new Set(s.runningSessions);
    if (running) next.add(sessionId);
    else next.delete(sessionId);
    return { runningSessions: next };
  }),
}));
