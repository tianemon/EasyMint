import os from "os";
import fs from "fs";
import { app, BrowserWindow, shell, ipcMain, Menu } from "electron";
import path from "path";
import {
  startAutoUpdater,
  checkForUpdatesManually,
  installUpdate,
  hasDownloadedUpdate,
  getDownloadedVersion,
  clearUpdateCache,
  getUpdateCacheSize,
  openUpdateCacheDir,
} from "./services/auto-updater";

process.env.CLAUDE_CONFIG_DIR = path.join(os.homedir(), ".easymint").replace(/\\/g, "/");
// Redirect Electron userData to our directory so all data lives in one place
app.setPath("userData", path.join(os.homedir(), ".easymint", "electron"));

import { registerIpcHandlers } from "./ipc-handlers";
import { ProjectService } from "./services/project-service";
import { FileService } from "./services/file-service";
import { AgentService, setMainWindow } from "./services/agent-service";
import { Store } from "./services/store";
import { detectClaude } from "./utils/claude-detector";
import { trackProjectWindow } from "./services/window-manager";

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
} | null = null;

export async function createWindow(hash?: string, _isMain = false): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    titleBarStyle: "hiddenInset",
    ...(isDev ? {} : { icon: path.join(__dirname, "..", "..", "..", "assets", "icon.icns") }),
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
    // 启动时同步当前供应商配置到 SDK settings.json
    store.saveSettings(store.getSettings());
    sharedServices = {
      store,
      projectService: new ProjectService(store),
      fileService: new FileService(),
      agentService: new AgentService(store),
    };
    setMainWindow(window);
    detectClaude();
    // Seed default Agent templates on first launch
    const { seedDefaults } = require("./services/agent-templates");
    seedDefaults();
    // Seed bundled skills (~/.claude/skills/) — only if not already installed
    const { seedBundledSkills } = require("./services/skill-service");
    seedBundledSkills();
    // Seed default MCP configs (~/.easymint/.claude.json)
    const { seedDefaultMcp } = require("./services/mcp-service");
    seedDefaultMcp();
    // Clean up orphaned session caches
    const { listSessions } = require("@anthropic-ai/claude-agent-sdk");
    const { purgeOrphanedCaches } = require("./services/session-cache");
    listSessions().then((all: Array<{ sessionId: string }>) => {
      purgeOrphanedCaches(new Set(all.map((s: { sessionId: string }) => s.sessionId)));
    }).catch(() => {});
    // Auto-cleanup old uploads (60 days / 10GB)
    const { autoClean } = require("./services/upload-cache");
    autoClean();
    registerIpcHandlers({ mainWindow: window, ...sharedServices });

    // 自动更新检测（4 小时一次）+ IPC
    startAutoUpdater();
    ipcMain.handle("app:get-version", () => app.getVersion());
    ipcMain.handle("app:check-update", () => {
      checkForUpdatesManually();
      return true;
    });
    ipcMain.handle("app:install-update", () => {
      installUpdate();
      return true;
    });
    ipcMain.handle("app:has-update", () => ({
      hasUpdate: hasDownloadedUpdate(),
      version: getDownloadedVersion(),
    }));
    ipcMain.handle("app:clear-update-cache", () => clearUpdateCache());
    ipcMain.handle("app:update-cache-size", () => getUpdateCacheSize());
    ipcMain.handle("app:open-update-cache", () => { openUpdateCacheDir(); });

    // NOTE: Orphan SDK session cleanup removed — will be replaced
    // with a proper session detection/management UI in a future update.

    // Process pending rename cleanup tasks (from project:rename-exec)
    const cleanFile = path.join(os.homedir(), ".easymint", ".cleanup-pending.json");
    if (fs.existsSync(cleanFile)) {
      try {
        const tasks = JSON.parse(fs.readFileSync(cleanFile, "utf-8")) as Array<{
          oldDir: string; oldSessionDir: string; timestamp: number;
        }>;
        for (const task of tasks) {
          try {
            if (task.oldDir && fs.existsSync(task.oldDir)) {
              fs.rmSync(task.oldDir, { recursive: true, force: true });
            }
            if (task.oldSessionDir && fs.existsSync(task.oldSessionDir)) {
              fs.rmSync(task.oldSessionDir, { recursive: true, force: true });
            }
          } catch { /* skip broken tasks */ }
        }
        fs.rmSync(cleanFile);
      } catch { /* corrupted file, delete it */ try { fs.rmSync(cleanFile); } catch { /* ignore */ } }
    }
  }

  loadApp(window, hash);

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  return window;
}

app.whenReady().then(() => {
  // 恢复上次打开的项目（仅在 setup 完成后）
  let startHash: string | undefined;
  const tempStore = new Store();
  const settings = tempStore.getSettings();
  if (settings.setupComplete) {
    const lastId = tempStore.getLastProjectId();
    if (lastId) startHash = `/project/${lastId}`;
  }
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
            click: () => createWindow("/"),
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
  createWindow("/");
});

ipcMain.handle("settings:set-last-project", (_e, { projectId }) => {
  if (sharedServices) sharedServices.store.setLastProjectId(projectId);
});
