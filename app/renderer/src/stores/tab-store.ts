import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useChatStore } from "./chat-store";

export interface Tab {
  id: string;
  type: "file" | "chat" | "group";
  title: string;
  filePath?: string;
  sessionId?: string;
  /** 群聊会话 ID(需求 4:type === "group" 时有效) */
  groupId?: string;
  isNewProject?: boolean;
  dirty?: boolean;
  isDesigner?: boolean;
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

// 新窗口标记检测（同步执行，React 渲染前即可用）
function isFreshWindow(): boolean {
  if (typeof window === "undefined") return false;
  const hashQuery = window.location.hash.split("?")[1] || "";
  return new URLSearchParams(hashQuery).get("fresh") === "1";
}

export const useTabStore = create<TabState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,
      runningSessions: new Set<string>(),

      openTab: (tab) => {
        const { tabs } = get();
        const existing = tabs.find(
          (t) =>
            (tab.type === "file" && t.type === "file" && t.filePath === tab.filePath) ||
            // 群聊按 groupId 去重(需求 4)
            (tab.type === "group" && t.type === "group" && tab.groupId && t.groupId === tab.groupId) ||
            // Only dedup by sessionId if it's a real SDK session (not undefined=new)
            (tab.type === "chat" && t.type === "chat" && tab.sessionId && t.sessionId === tab.sessionId)
        );
        // 重新打开会话 → 取消关闭 tab 时的延迟回收(会话继续用内存态)
        if (tab.type === "chat" && tab.sessionId) {
          window.electronAPI?.agent?.cancelReclaim?.(tab.sessionId).catch(() => {});
        }
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
          // 关闭 tab → 主进程回收:空闲即 kill / 运行中延迟(委派/shell/回合结束后 kill,5 分钟超时兜底)
          if (tab.type === "chat") {
            window.electronAPI?.agent?.reclaimChat?.(tab.sessionId).catch(() => {});
          }
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
    }),
    {
      name: "easymint-tabs",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ tabs: state.tabs, activeTabId: state.activeTabId }),
      // 新窗口不恢复 localStorage 中的旧标签页（防止跨窗口泄漏）
      skipHydration: isFreshWindow(),
    }
  )
);

// 同步到主进程备份（macOS 合盖 GPU 恢复时可靠恢复）
let synced = false;
useTabStore.subscribe((state) => {
  // 首次渲染空状态不同步（会覆盖主进程的旧备份），等 App 恢复或用户开 tab 后同步
  if (!synced && state.tabs.length === 0) return;
  synced = true;
  try {
    window.electronAPI?.tab?.save?.({
      tabs: state.tabs.map((t) => ({ id: t.id, type: t.type, title: t.title, filePath: t.filePath, sessionId: t.sessionId, groupId: t.groupId, isDesigner: t.isDesigner })),
      activeTabId: state.activeTabId,
    });
  } catch { /* ignore */ }
});
