/**
 * 轻量事件桥：让任意组件（如 NewProjectDialog 的 askWorkspace 后台删会话）
 * 能通知 SessionHistory 刷新会话列表，避免删除后列表残留。
 *
 * SessionHistory 挂载时 register 自己的 load，卸载时 unregister。
 * 其他组件调 refresh() 触发刷新。
 */

type RefreshFn = () => void;
let _refresh: RefreshFn | null = null;

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
};
