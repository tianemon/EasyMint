import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useChatStore } from "./chat-store";

export interface Tab {
  id: string;
  type: "file" | "chat";
  title: string;
  filePath?: string;
  sessionId?: string;
  isNewProject?: boolean;
  dirty?: boolean;
  isDesigner?: boolean;
}

interface TabState {
  tabs: Tab[];
  activeTabId: string | null;
  runningSessions: Set<string>;
  openTab: (tab: Tab) => void;
  closeTab: (id: string, suppressDefaultTab?: boolean) => void;
  setActiveTab: (id: string) => void;
  clearTabs: () => void;
  setDirty: (id: string, dirty: boolean) => void;
  updateTab: (id: string, patch: Partial<Omit<Tab, "id">>) => void;
  setSessionRunning: (sessionId: string, running: boolean) => void;
  /** 是否有真实 tab(chat 已有 sessionId 或 file)——TabBar 显隐与新建会话可用性统一判断 */
  hasRealTabs: () => boolean;
  /** 关闭空会话 tab(chat 无 sessionId);不存在则无操作——切到真实会话时统一清理 */
  closeEmptyTab: () => void;
  /** 打开会话:关闭空 tab → 已有则激活,否则新建 tab。会话列表与 TabBar 联动入口 */
  openSession: (sessionId: string, title?: string) => void;
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

      closeTab: (id, suppressDefaultTab = false) => {
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
          // 关闭所有 tab → 自动回到默认页面(补建空会话 tab,输入卡片居中);
          // suppressDefaultTab=true(如 closeEmptyTab 联动清理)时不补建
          if (nextTabs.length === 0 && !suppressDefaultTab) {
            const defaultTab: Tab = { id: genId(), type: "chat", title: "新会话" };
            return { tabs: [defaultTab], activeTabId: defaultTab.id };
          }
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

      hasRealTabs: () => get().tabs.some((t) => (t.type === "chat" && t.sessionId) || t.type === "file"),

      closeEmptyTab: () => {
        const empty = get().tabs.find((t) => t.type === "chat" && !t.sessionId);
        // suppressDefaultTab:联动清理(切真实会话)时关闭空 tab,不触发默认页补建
        if (empty) get().closeTab(empty.id, true);
      },

      openSession: (sessionId, title) => {
        get().closeEmptyTab();
        // 已有同 session 的 tab → 激活并同步标题(会话列表点击带真实标题,覆盖"对话"占位)
        const existing = get().tabs.find((t) => t.type === "chat" && t.sessionId === sessionId);
        if (existing) {
          if (title && existing.title !== title) get().updateTab(existing.id, { title });
          set({ activeTabId: existing.id });
          return;
        }
        get().openTab({ id: "", type: "chat", title: title || "对话", sessionId });
      },
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
      tabs: state.tabs.map((t) => ({ id: t.id, type: t.type, title: t.title, filePath: t.filePath, sessionId: t.sessionId, isDesigner: t.isDesigner })),
      activeTabId: state.activeTabId,
    });
  } catch { /* ignore */ }
});
