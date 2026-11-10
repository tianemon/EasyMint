import { BrowserWindow } from "electron";
import { appEventBus } from "./app-event-bus";

/** Track which BrowserWindow is showing which project */
const projectWindows = new Map<number, string>();

function publishIfChanged(before: string[]): void {
  const after = listOpenProjectIds();
  if (before.length === after.length && before.every((id, i) => id === after[i])) return;
  appEventBus.publish("project:open-windows-changed", { projectIds: after });
}

function projectIdFromUrl(url: string): string | null {
  const match = url.match(/#\/project\/([^/?#]+)/);
  if (!match?.[1]) return null;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

/** 跟随 SPA hash 路由，维护真正处于打开状态的项目集合。 */
export function watchProjectWindow(win: BrowserWindow): void {
  const sync = (url: string): void => {
    const before = listOpenProjectIds();
    const projectId = projectIdFromUrl(url);
    if (projectId) projectWindows.set(win.id, projectId);
    else projectWindows.delete(win.id);
    publishIfChanged(before);
  };
  win.webContents.on("did-navigate", (_event, url) => sync(url));
  win.webContents.on("did-navigate-in-page", (_event, url) => sync(url));
  win.on("closed", () => {
    const before = listOpenProjectIds();
    projectWindows.delete(win.id);
    publishIfChanged(before);
  });
  sync(win.webContents.getURL());
}

export function listOpenProjectIds(): string[] {
  return [...new Set(projectWindows.values())].sort();
}

export function closeProjectWindows(projectId: string): void {
  for (const [winId, pid] of projectWindows) {
    if (pid === projectId) {
      const win = BrowserWindow.fromId(winId);
      if (win && !win.isDestroyed()) win.close();
    }
  }
}

/** 等窗口把 projectId 登记进 projectWindows（loadURL 是异步的，靠 did-navigate 触发 sync）。
 *  isOpen / 超时 / 轮询间隔可注入，便于单测覆盖超时与延迟登记，不依赖真实 Electron 窗口。 */
export async function waitForProjectWindow(
  projectId: string,
  opts: { isOpen?: (id: string) => boolean; timeoutMs?: number; pollMs?: number } = {},
): Promise<void> {
  const isOpen = opts.isOpen ?? ((id: string) => listOpenProjectIds().includes(id));
  const deadline = Date.now() + (opts.timeoutMs ?? 5_000);
  while (!isOpen(projectId)) {
    if (Date.now() > deadline) {
      throw new Error("项目窗口已在桌面端打开，但尚未就绪，请返回项目列表重试");
    }
    await new Promise((resolve) => setTimeout(resolve, opts.pollMs ?? 50));
  }
}
