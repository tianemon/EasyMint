import { create } from "zustand";

interface TerminalTab {
  id: string;
  title: string;
  cwd: string;
}

interface TerminalState {
  tabs: TerminalTab[];
  activeTabId: string | null;
  addTab: (tab: TerminalTab) => void;
  removeTab: (id: string) => void;
  setActive: (id: string) => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  tabs: [],
  activeTabId: null,
  addTab: (tab) => set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id })),
  removeTab: (id) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      return { tabs, activeTabId: s.activeTabId === id ? (tabs[0]?.id ?? null) : s.activeTabId };
    }),
  setActive: (id) => set({ activeTabId: id }),
}));
