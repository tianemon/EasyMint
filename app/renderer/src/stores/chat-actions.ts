/**
 * 轻量事件桥：让 TaskPanel 等组件可以发送消息到 ChatPanel，
 * 走 ChatPanel 自己的 sendText 流程（session、权限、显示全部统一）。
 */

type Listener = (text: string) => void;
let _listener: Listener | null = null;

export const chatActions = {
  /** ChatPanel 注册自己的 sendText */
  register(handler: Listener): void {
    _listener = handler;
  },
  unregister(): void {
    _listener = null;
  },
  /** 任意组件调用，发消息到当前聊天会话 */
  send(text: string): void {
    if (_listener) _listener(text);
  },
};
