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
  /** 右侧内容区置空(侧边栏切到「文件」页签,等用户点文件):不改 activeTabId,切回「会话」原样恢复 */
  contentBlanked: boolean;
  /** 置空期间挂起的激活 tab id——切回「会话」时恢复它 */
  suspendedActiveTabId: string | null;
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
  /** 置空/恢复右侧内容区(侧边栏「文件」↔「会话」页签切换) */
  setContentBlanked: (blanked: boolean) => void;
  /** 内容区当前是否真的留白:置空态下点开文件即退出等待态(挂起点保留,切回「会话」仍能恢复) */
  isContentBlank: () => boolean;
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
      contentBlanked: false,
      suspendedActiveTabId: null,

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
        // 打开 file tab 会让标签栏首次显形,首页空会话 tab 是占位而非真实 tab,
        // 留在数组里会跟着一起露出来 —— 与 openSession 一样先清掉
        if (tab.type === "file") get().closeEmptyTab();
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
          // 主动打开会话 = 结束置空等待态,挂起点一并作废(不然后续置空会恢复到这里之前的状态)
          set({ activeTabId: existing.id, contentBlanked: false, suspendedActiveTabId: null });
          return;
        }
        get().openTab({ id: "", type: "chat", title: title || "对话", sessionId });
      },

      setContentBlanked: (blanked) => {
        const { contentBlanked, activeTabId, suspendedActiveTabId } = get();
        if (blanked) {
          // 重复切到「文件」不覆盖挂起点,否则切回时会恢复到中途点开的文件 tab
          if (contentBlanked) return;
          set({ contentBlanked: true, suspendedActiveTabId: activeTabId });
          return;
        }
        if (!contentBlanked) return;
        // 挂起的 tab 还在 → 原样恢复;已被关掉 → 退到任一 chat tab(切回「会话」应看到聊天视图)
        const suspended = suspendedActiveTabId && get().tabs.some((t) => t.id === suspendedActiveTabId)
          ? suspendedActiveTabId
          : null;
        const restored = suspended ?? get().tabs.find((t) => t.type === "chat")?.id ?? null;
        if (restored) {
          set({ activeTabId: restored, contentBlanked: false, suspendedActiveTabId: null });
          return;
        }
        // 一个 chat tab 都没有 → 补建首页空会话(与打开 EM 初始态一致),复用 openTab 避免重复补建逻辑
        get().openTab({ id: "", type: "chat", title: "新会话" });
        set({ contentBlanked: false, suspendedActiveTabId: null });
      },

      isContentBlank: () => {
        const { contentBlanked, activeTabId, tabs } = get();
        if (!contentBlanked) return false;
        // 置空期间点开的文件照常显示(contentBlanked 不清除,切回「会话」才恢复挂起点)
        return tabs.find((t) => t.id === activeTabId)?.type !== "file";
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
