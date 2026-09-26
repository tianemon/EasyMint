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
const projectWindows = new Map<string, number>();

export function bindPiExtensionWindow(projectPath: string, senderId: number): void {
  if (projectPath && Number.isInteger(senderId)) projectWindows.set(path.resolve(resolveHome(projectPath)), senderId);
}

function targetWindow(projectPath?: string): BrowserWindow | undefined {
  if (!BrowserWindow || typeof BrowserWindow.getFocusedWindow !== "function") return undefined;
  if (projectPath) {
    const senderId = projectWindows.get(path.resolve(resolveHome(projectPath)));
    return senderId === undefined ? undefined : BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && win.webContents.id === senderId);
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
