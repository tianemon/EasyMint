import { BrowserWindow } from "electron";

/** Track which BrowserWindow is showing which project */
const projectWindows = new Map<number, string>();

export function trackProjectWindow(win: BrowserWindow, projectId: string): void {
  projectWindows.set(win.id, projectId);
  win.on("closed", () => projectWindows.delete(win.id));
}

export function closeProjectWindows(projectId: string): void {
  for (const [winId, pid] of projectWindows) {
    if (pid === projectId) {
      const win = BrowserWindow.fromId(winId);
      if (win && !win.isDestroyed()) win.close();
    }
  }
}
