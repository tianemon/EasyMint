import os from "os";
import { app, BrowserWindow, shell, ipcMain, Menu } from "electron";
import path from "path";

process.env.CLAUDE_CONFIG_DIR = path.join(os.homedir(), ".easymint");

import { registerIpcHandlers } from "./ipc-handlers";
import { ProjectService } from "./services/project-service";
import { FileService } from "./services/file-service";
import { AgentService, setMainWindow } from "./services/agent-service";
import { EvaluatorService } from "./services/evaluator-service";
import { Store } from "./services/store";
import { detectClaude } from "./utils/claude-detector";
import { trackProjectWindow, closeProjectWindows } from "./services/window-manager";

const isDev = !app.isPackaged;

function loadApp(window: BrowserWindow, hash = ""): void {
  const baseUrl = isDev
    ? "http://localhost:5173"
    : `file://${path.join(__dirname, "..", "..", "renderer", "dist", "index.html")}`;

  window.loadURL(baseUrl);
  if (isDev) window.webContents.openDevTools({ mode: "detach" });

  // Navigate to hash route after page loads (more reliable than passing hash to loadURL)
  if (hash) {
    window.webContents.once("did-finish-load", () => {
      window.webContents.executeJavaScript(`window.location.hash = "#${hash}"`).catch(() => {});
    });
  }
}

let sharedServices: {
  store: Store;
  projectService: ProjectService;
  fileService: FileService;
  agentService: AgentService;
  evaluatorService: EvaluatorService;
} | null = null;

export async function createWindow(hash?: string, isMain = false): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "dist", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Initialize shared services once. IPC handlers are registered only for the main window;
  // additional windows reuse the same services via the preload bridge.
  if (!sharedServices) {
    const store = new Store();
    sharedServices = {
      store,
      projectService: new ProjectService(store),
      fileService: new FileService(),
      agentService: new AgentService(store),
      evaluatorService: new EvaluatorService(),
    };
    setMainWindow(window);
    detectClaude();
    registerIpcHandlers({ mainWindow: window, ...sharedServices });

    // Clean up orphaned SDK session directories for deleted projects
    try {
      const fs = require("fs");
      const sdkDir = path.join(os.homedir(), ".easymint", "projects");
      if (fs.existsSync(sdkDir)) {
        const projects = store.getProjects().map((p: { path: string }) => p.path.replace(/\//g, "-"));
        // Keep the fallback workspace (no-project sessions use this dir)
        const workspaceKey = path.join(os.homedir(), "EasyMintProject", "workspace").replace(/\//g, "-");
        projects.push(workspaceKey);
        for (const entry of fs.readdirSync(sdkDir)) {
          if (!projects.includes(entry)) {
            const full = path.join(sdkDir, entry);
            if (fs.statSync(full).isDirectory()) {
              fs.rmSync(full, { recursive: true, force: true });
              console.log("[init] cleaned orphaned SDK sessions:", entry);
            }
          }
        }
      }
    } catch { /* best effort */ }
    isMain = true;
  }

  loadApp(window, hash);

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  return window;
}

app.whenReady().then(() => {
  // 恢复上次打开的项目
  let startHash: string | undefined;
  try {
    const tempStore = new Store();
    const lastId = tempStore.getLastProjectId();
    if (lastId) startHash = `/project/${lastId}`;
  } catch { /* ignore */ }
  createWindow(startHash, true);

  if (process.platform === "darwin") {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: "EasyMint",
        submenu: [
          { role: "about" as const },
          { type: "separator" as const },
          { role: "quit" as const },
        ],
      },
      {
        label: "File",
        submenu: [
          {
            label: "New Window",
            accelerator: "Cmd+N",
            click: () => createWindow("/projects"),
          },
          { type: "separator" as const },
          { role: "close" as const },
        ],
      },
      { label: "Edit", submenu: [{ role: "undo" as const }, { role: "redo" as const }, { type: "separator" as const }, { role: "cut" as const }, { role: "copy" as const }, { role: "paste" as const }, { role: "selectAll" as const }] },
      { label: "View", submenu: [{ role: "reload" as const }, { role: "toggleDevTools" as const }, { type: "separator" as const }, { role: "zoomIn" as const }, { role: "zoomOut" as const }, { role: "resetZoom" as const }] },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }
});

app.on("window-all-closed", () => { app.quit(); });

app.on("before-quit", () => {
  if (sharedServices) sharedServices.agentService.shutdown();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── Multi-window IPC ──

ipcMain.handle("window:open-project", async (_e, { projectId, sessionId, init }) => {
  const params = new URLSearchParams();
  if (sessionId) params.set("session", sessionId);
  if (init) params.set("init", "1");
  const qs = params.toString();
  const hash = qs ? `/project/${projectId}?${qs}` : `/project/${projectId}`;
  if (sharedServices) sharedServices.store.setLastProjectId(projectId);
  const win = await createWindow(hash);
  trackProjectWindow(win, projectId);
});

ipcMain.handle("window:new", () => {
  createWindow("/projects");
});

ipcMain.handle("settings:set-last-project", (_e, { projectId }) => {
  if (sharedServices) sharedServices.store.setLastProjectId(projectId);
});
