/**
 * IPC 广播 — 向所有窗口发送事件
 *
 * 消除 agent-service.ts 和 builtin-mcp.ts 中的重复定义。
 */

import { BrowserWindow } from "electron";
import { appEventBus, type AppEvent } from "./app-event-bus";

/** 已经报过「渲染帧不可用」的 webContents id，避免每个事件都刷一遍同样的日志 */
const reportedDeadFrames = new Set<number>();

export function broadcast(channel: string, data: unknown): void {
  broadcastEvent(channel, data);
}

/** 需要将广播事件序号写入快照缓冲的调用点使用此入口。 */
export function broadcastEvent(channel: string, data: unknown): AppEvent {
  // 主进程事件先进入统一总线。Electron 窗口和后续手机终端都消费同一份权威事件。
  const event = appEventBus.publish(channel, data);
  BrowserWindow.getAllWindows().forEach((win) => {
    // ⚠ isDestroyed() 只判断**窗口对象**，判断不了**渲染帧**：页面重载或渲染进程退出后，
    // 窗口对象还在、帧已经没了，此时 send 会抛
    // 「Render frame was disposed before WebFrameMain could be accessed」。
    // 这是广播语义（某个窗口收不到不影响其它窗口），所以跳过即可——但必须兜住：
    // 不兜的话异常会打断 forEach，排在后面的窗口也一起收不到事件。
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    try {
      win.webContents.send(channel, data);
    } catch (error) {
      reportDeadFrame(win.webContents.id, channel, error);
    }
  });
  return event;
}

/** 同一个窗口只报一次：帧一旦销毁就会持续失败，逐事件打印只会把控制台刷满（曾把 dev 日志刷了几万行） */
function reportDeadFrame(webContentsId: number, channel: string, error: unknown): void {
  if (reportedDeadFrames.has(webContentsId)) return;
  reportedDeadFrames.add(webContentsId);
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[broadcast] 该窗口的渲染帧已不可用，后续事件将跳过它（同类错误不再重复打印）: ${channel} — ${reason}`);
}
