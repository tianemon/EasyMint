/**
 * IPC 广播 — 向所有窗口发送事件
 *
 * 消除 agent-service.ts 和 builtin-mcp.ts 中的重复定义。
 */

import { BrowserWindow } from "electron";

export function broadcast(channel: string, data: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send(channel, data);
  });
}
