import { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveHome } from "../utils/paths";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

export interface ExtensionPromptRequest {
  id: string;
  kind: "select" | "confirm" | "input";
  title: string;
  message?: string;
  options?: string[];
}

const pending = new Map<string, { senderId: number; done: (value: string | boolean | undefined) => void; timer: ReturnType<typeof setTimeout> }>();

interface WindowBinding {
  senderId: number;
  /** 绑定时窗口所在的项目路由 id（window-manager 的同口径 hash 路由解析）；null = 绑定时不在项目页 */
  routeId: string | null;
  detach: () => void;
}
const projectWindows = new Map<string, WindowBinding>();

/** 与 window-manager.projectIdFromUrl 同口径：从 SPA hash 路由提取项目 id。 */
function projectRouteIdFromUrl(url: string): string | null {
  const match = url.match(/#\/project\/([^/?#]+)/);
  if (!match?.[1]) return null;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

/** 窗口不再属于原项目（导航离开或已关闭）时，结算它身上所有未答的扩展请求。 */
function settleWindowPrompts(senderId: number, win?: BrowserWindow): void {
  for (const [id, item] of [...pending]) {
    if (item.senderId !== senderId) continue;
    pending.delete(id);
    clearTimeout(item.timer);
    item.done(undefined);
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send("pi-extension:prompt-expired", { id });
    }
  }
}

function unbindWindow(projectKey: string, binding: WindowBinding, win?: BrowserWindow): void {
  if (projectWindows.get(projectKey) !== binding) return;
  projectWindows.delete(projectKey);
  try { binding.detach(); } catch { /* 窗口销毁后移除监听可能抛错，忽略 */ }
  settleWindowPrompts(binding.senderId, win);
}

export function bindPiExtensionWindow(projectPath: string, senderId: number): void {
  if (!projectPath || !Number.isInteger(senderId) || !BrowserWindow) return;
  const key = path.resolve(resolveHome(projectPath));
  const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed() && candidate.webContents.id === senderId);
  const previous = projectWindows.get(key);
  if (previous) {
    // 改绑（如项目从 W1 移到 W2）：先结算 W1 上未答的扩展请求并撤掉弹窗，再移除其导航监听——
    // 否则旧弹窗留在 W1，随后的导航事件已无人监听，它还能被回答（2026-09-26 复查 #3）
    const previousWin = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed() && candidate.webContents.id === previous.senderId);
    unbindWindow(key, previous, previousWin);
  }
  if (!win) {
    projectWindows.set(key, { senderId, routeId: null, detach: () => {} });
    return;
  }
  // 复用项目路由跟踪口径：绑定后窗口导航离开原项目（SPA hash 或整页跳转）即撤销绑定，
  // 并结算该窗口未答的扩展弹窗——A 项目的提示不再出现在已切到 B 项目的窗口里。
  const binding: WindowBinding = {
    senderId,
    routeId: projectRouteIdFromUrl(win.webContents.getURL()),
    detach: () => {
      win.webContents.removeListener("did-navigate", onNavigate);
      win.webContents.removeListener("did-navigate-in-page", onNavigate);
      win.removeListener("closed", onClosed);
    },
  };
  const onNavigate = (): void => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    if (projectRouteIdFromUrl(win.webContents.getURL()) !== binding.routeId) unbindWindow(key, binding, win);
  };
  const onClosed = (): void => unbindWindow(key, binding);
  win.webContents.on("did-navigate", onNavigate);
  win.webContents.on("did-navigate-in-page", onNavigate);
  win.on("closed", onClosed);
  projectWindows.set(key, binding);
}

function targetWindow(projectPath?: string): BrowserWindow | undefined {
  if (!BrowserWindow || typeof BrowserWindow.getFocusedWindow !== "function") return undefined;
  if (projectPath) {
    const key = path.resolve(resolveHome(projectPath));
    const binding = projectWindows.get(key);
    if (!binding) return undefined;
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed() && candidate.webContents.id === binding.senderId);
    if (!win) return undefined;
    // 发请求前再次核对窗口当前项目：导航事件可能晚于请求到达，绝不退回焦点窗口
    if (projectRouteIdFromUrl(win.webContents.getURL()) !== binding.routeId) {
      unbindWindow(key, binding, win);
      return undefined;
    }
    return win;
  }
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
}

function ask(request: Omit<ExtensionPromptRequest, "id">, projectPath?: string): Promise<string | boolean | undefined> {
  const win = targetWindow(projectPath);
  if (!win || win.webContents.isDestroyed()) return Promise.resolve(undefined);
  const id = randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(undefined);
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send("pi-extension:prompt-expired", { id });
    }, 5 * 60_000);
    pending.set(id, { senderId: win.webContents.id, done: resolve, timer });
    win.webContents.send("pi-extension:prompt", { ...request, id });
  });
}

export function answerPiExtensionPrompt(senderId: number, id: string, value: string | boolean | undefined): void {
  const item = pending.get(id);
  if (!item || item.senderId !== senderId) return;
  pending.delete(id);
  clearTimeout(item.timer);
  item.done(value);
}

export function createPiExtensionUi(projectPath?: string): ExtensionUIContext {
  const ui = {
    select: async (title: string, options: string[]) => {
      const value = await ask({ kind: "select", title, options }, projectPath);
      return typeof value === "string" && options.includes(value) ? value : undefined;
    },
    confirm: async (title: string, message: string) => (await ask({ kind: "confirm", title, message }, projectPath)) === true,
    input: async (title: string, placeholder?: string) => {
      const value = await ask({ kind: "input", title, message: placeholder }, projectPath);
      return typeof value === "string" ? value : undefined;
    },
    notify: (message: string, type: "info" | "warning" | "error" = "info") => {
      const win = targetWindow(projectPath);
      if (win && !win.webContents.isDestroyed()) win.webContents.send("pi-extension:notice", { message, type });
    },
    onTerminalInput: () => () => {},
    setStatus: () => {},
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    custom: async () => undefined,
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => "",
    editor: async () => undefined,
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    get theme() { return undefined; },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "EasyMint 不支持 Pi 终端主题" }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  };
  return ui as unknown as ExtensionUIContext;
}
