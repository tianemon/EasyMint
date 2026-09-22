/**
 * 轻量事件桥：让任意组件（如 NewProjectDialog 的 askWorkspace 后台删会话）
 * 能通知 SessionHistory 刷新会话列表，避免删除后列表残留。
 *
 * SessionHistory 挂载时 register 自己的 load，卸载时 unregister。
 * 其他组件调 refresh() 触发刷新。
 *
 * 另外承载**会话改名的统一落点**（applyTitle）：列表项 + 已打开的 tab 标题在这里一起更新，
 * 改名入口不再各自手写同步（主进程广播见 session-service.renameSession）。
 */

import { useTabStore } from "./tab-store";

type RefreshFn = () => void;
/** 就地改某个会话的标题（SessionHistory 注册；不重读磁盘，不动排序） */
type TitleFn = (sessionId: string, title: string) => void;

let _refresh: RefreshFn | null = null;
let _setTitle: TitleFn | null = null;

export const sessionListActions = {
  /** SessionHistory 注册自己的刷新函数 */
  register(fn: RefreshFn): void {
    _refresh = fn;
  },
  unregister(): void {
    _refresh = null;
  },
  /** 触发当前挂载的 SessionHistory 刷新 */
  refresh(): void {
    if (_refresh) _refresh();
  },
  /** SessionHistory 注册标题改写函数 */
  registerTitle(fn: TitleFn): void {
    _setTitle = fn;
  },
  unregisterTitle(): void {
    _setTitle = null;
  },
  /**
   * 会话改名事件 → 列表项 + 已打开 tab 标题。
   *
   * 两个来源共用这里（都是主进程广播）：`agent:session-renamed`（改名广播，有/无活实例都发）
   * 与 `agent:stream` 的 `session_info_changed`（SDK setSessionName 在回合内 emit 的回执）。
   * 重复到达无害——写的是同一个标题。
   */
  applyTitle(sessionId: string, title: string): void {
    if (!sessionId || !title) return;
    _setTitle?.(sessionId, title);
    const ts = useTabStore.getState();
    const tab = ts.tabs.find((t) => t.sessionId === sessionId);
    if (tab && tab.title !== title) ts.updateTab(tab.id, { title });
  },
};
