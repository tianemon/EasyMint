import os from "os";
import fs from "fs";
import { app, BrowserWindow, shell, ipcMain, Menu } from "electron";
import path from "path";
import { loadUserEnv } from "./utils/user-path";
import { getResourcesDir } from "./utils/paths";
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

// 统一配置目录：所有 Pi SDK 和 EM 数据都在 ~/.easymint/ 下
// agentDir 用 ~/.easymint/agent（严格对应 Pi 默认的 ~/.pi/agent 层级，不再有 pi/pi-agent 子目录）
const EM_HOME = path.join(os.homedir(), ".easymint");
process.env.PI_CODING_AGENT_DIR = path.join(EM_HOME, "agent");
// Pi SDK 品牌定制：项目级配置目录 .pi → .easymint（官方定制点 piConfig.configDir，幂等补写）。
// 定位本地实际安装的 SDK 包（开发=项目 node_modules；打包=.asar.unpacked，@earendil-works 在 asarUnpack 名单）。
// 写失败（如 mac 签名后权限）→ 降级保持 .pi 默认，功能不受影响。
try {
  let sdkPkgPath = path.join(app.getAppPath(), "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
  if (sdkPkgPath.includes(".asar")) sdkPkgPath = sdkPkgPath.replace(".asar", ".asar.unpacked");
  if (fs.existsSync(sdkPkgPath)) {
    const sdkPkg = JSON.parse(fs.readFileSync(sdkPkgPath, "utf-8")) as { piConfig?: { configDir?: string } };
    if (sdkPkg.piConfig?.configDir !== ".easymint") {
      sdkPkg.piConfig = { ...sdkPkg.piConfig, configDir: ".easymint" };
      fs.writeFileSync(sdkPkgPath, JSON.stringify(sdkPkg, null, 2));
      console.log("[pi] SDK 项目级配置目录已定制为 .easymint:", sdkPkgPath);
    }
  }
} catch (e) { console.warn("[pi] SDK package.json 定制失败（保持 .pi 默认）:", (e as Error).message); }

// 一次性迁移：旧布局 ~/.easymint/pi-agent/models-store.json → agent/（0.7.2 起 agentDir 统一）
const LEGACY_PI_AGENT_STORE = path.join(EM_HOME, "pi-agent", "models-store.json");
const NEW_AGENT_STORE = path.join(EM_HOME, "agent", "models-store.json");
if (!fs.existsSync(NEW_AGENT_STORE) && fs.existsSync(LEGACY_PI_AGENT_STORE)) {
  fs.mkdirSync(path.dirname(NEW_AGENT_STORE), { recursive: true });
  fs.copyFileSync(LEGACY_PI_AGENT_STORE, NEW_AGENT_STORE);
}
// 一次性迁移：会话目录 ~/.easymint/sessions/ → agent/sessions/（Pi 默认布局，v0.7.2 起归默认）
const OLD_SESSIONS_DIR = path.join(EM_HOME, "sessions");
const NEW_SESSIONS_DIR = path.join(EM_HOME, "agent", "sessions");
if (fs.existsSync(OLD_SESSIONS_DIR)) {
  const moveSessions = (): boolean => {
    fs.mkdirSync(path.dirname(NEW_SESSIONS_DIR), { recursive: true });
    try {
      fs.renameSync(OLD_SESSIONS_DIR, NEW_SESSIONS_DIR);
      return true;
    } catch { return false; }
  };
  if (!fs.existsSync(NEW_SESSIONS_DIR) || fs.readdirSync(NEW_SESSIONS_DIR).length === 0) {
    if (fs.existsSync(NEW_SESSIONS_DIR)) fs.rmdirSync(NEW_SESSIONS_DIR);
    if (!moveSessions()) {
      // 跨盘/占用降级：复制后删除
      try {
        fs.cpSync(OLD_SESSIONS_DIR, NEW_SESSIONS_DIR, { recursive: true });
        fs.rmSync(OLD_SESSIONS_DIR, { recursive: true, force: true });
      } catch (e) { console.warn("[migrate] 会话目录迁移失败:", (e as Error).message); }
    }
  } else {
    // 两侧都有内容（罕见）：逐个补齐缺失的项目会话目录
    for (const item of fs.readdirSync(OLD_SESSIONS_DIR)) {
      const src = path.join(OLD_SESSIONS_DIR, item);
      const dst = path.join(NEW_SESSIONS_DIR, item);
      if (!fs.existsSync(dst)) {
        try { fs.cpSync(src, dst, { recursive: true }); } catch { /* best effort */ }
      }
    }
  }
}
// Redirect Electron userData to our directory so all data lives in one place
app.setPath("userData", path.join(EM_HOME, "electron"));

// 禁用磁盘缓存:win 上 userData/GPUCache 目录常因残留/杀软占用创建失败
// ("Unable to move the cache: 拒绝访问 0x5")——失败自动降级内存缓存,功能无影响,但刷屏
// 报错。禁用后缓存走内存,消除日志噪音(需在 ready 前设置)
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache"); // GPU shader 缓存
app.commandLine.appendSwitch("disk-cache-size", "0"); // HTTP 磁盘缓存(net/disk_cache 报错源)

import { registerIpcHandlers } from "./ipc-handlers";
import { ProjectService } from "./services/project-service";
import { FileService } from "./services/file-service";
import { AgentService, setMainWindow } from "./services/agent-service";
import { Store } from "./services/store";
import { syncNativeModels } from "./services/pi-init";
import { cleanupTempCaches } from "./services/session-cache";
import { trackProjectWindow } from "./services/window-manager";

const isDev = !app.isPackaged;

function loadApp(window: BrowserWindow, hash = ""): void {
  const baseUrl = isDev
    ? "http://localhost:5173"
    : `file://${path.join(__dirname, "..", "..", "renderer", "dist", "index.html")}`;

  // 将 hash 直接拼入 URL，确保 React 初始化时就拿到完整路由
  const hashPart = hash ? `#${hash}` : "";
  window.loadURL(baseUrl + hashPart);
  if (isDev) window.webContents.openDevTools({ mode: "detach" });
}

// Tab 状态备份（macOS 合盖崩溃恢复），新建窗口时需清空防止跨窗口污染
let tabBackup: { tabs: Array<{ id: string; type: string; title: string; filePath?: string; sessionId?: string }>; activeTabId: string | null } | null = null;

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
    // Windows：隐藏系统标题栏（保留窗口框架/Snap/缩放），窗口按钮由 renderer 自绘（WindowControls）
    ...(process.platform === "win32" ? { titleBarStyle: "hidden" as const } : {}),
    ...(isDev ? {} : { icon: path.join(__dirname, "..", "..", "..", "assets", "icon.icns") }),
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "dist", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Windows 自绘按钮需要最大化状态：主进程监听并广播
  if (process.platform === "win32") {
    window.on("maximize", () => window.webContents.send("win:maximized-changed", true));
    window.on("unmaximize", () => window.webContents.send("win:maximized-changed", false));
  }

  // Initialize shared services once. IPC handlers are registered only for the main window;
  // additional windows reuse the same services via the preload bridge.
  if (!sharedServices) {
    const store = new Store();
    sharedServices = {
      store,
      projectService: new ProjectService(store),
      fileService: new FileService(),
      agentService: new AgentService(store),
    };
    setMainWindow(window);
    // Seed default Agent templates on first launch
    const { seedDefaults } = require("./services/agent-templates");
    seedDefaults();
    // Seed bundled skills (~/.easymint/skills/) — only if not already installed
    const { seedBundledSkills } = require("./services/skill-service");
    seedBundledSkills();
    // Seed default MCP configs (~/.easymint/mcp.json, EM 独立配置)
    const { seedDefaultMcp } = require("./services/mcp-service");
    seedDefaultMcp();
    // 冷启动预热(后台,不阻塞窗口):预加载 Pi SDK/model runtime/MCP 工具,
    // 让首条消息发送不现场初始化(仅首次进程执行一次)
    const { prewarm } = require("./services/prewarm");
    prewarm(store).catch(() => {});
    // NOTE: Orphan session cleanup — Pi SDK manages sessions via its own SessionManager
    // No automatic cleanup needed; old Claude SDK cache cleanup removed
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

    // tab 状态主进程备份（macOS 合盖 GPU 恢复时渲染进程 localStorage 不可靠）
    ipcMain.handle("tab:save", (_e, data) => { tabBackup = data; });
    ipcMain.handle("tab:restore", () => tabBackup);

    // NOTE: Orphan SDK session cleanup removed — will be replaced
    // with a proper session detection/management UI in a future update.

    // Process pending rename cleanup tasks (from project:rename-exec)
    const cleanFile = path.join(os.homedir(), ".easymint", ".cleanup-pending.json");
    if (fs.existsSync(cleanFile)) {
      try {
        const tasks = JSON.parse(fs.readFileSync(cleanFile, "utf-8")) as Array<{
          oldDir: string; oldSessionDir: string; oldPiSessionDir?: string; timestamp: number;
        }>;
        for (const task of tasks) {
          try {
            if (task.oldDir && fs.existsSync(task.oldDir)) {
              fs.rmSync(task.oldDir, { recursive: true, force: true });
            }
            if (task.oldSessionDir && fs.existsSync(task.oldSessionDir)) {
              fs.rmSync(task.oldSessionDir, { recursive: true, force: true });
            }
            if (task.oldPiSessionDir && fs.existsSync(task.oldPiSessionDir)) {
              fs.rmSync(task.oldPiSessionDir, { recursive: true, force: true });
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

  // 链接点击/导航拦截:站内(同 origin 或 file://)放行,外部 URL 用系统浏览器打开——
  // 否则 Mint 回复里的链接点击后窗口内跳走,EM 界面被替换无法返回(只能重启)
  window.webContents.on("will-navigate", (event, url) => {
    const current = window.webContents.getURL();
    const sameOrigin = (() => {
      try { return new URL(url).origin === new URL(current).origin; } catch { return false; }
    })();
    if (sameOrigin || url.startsWith("file://")) return; // 站内(hash 路由/同源)放行
    event.preventDefault();
    shell.openExternal(url);
  });

  return window;
}

app.whenReady().then(() => {
  // GUI 环境引导:提取用户完整环境(zsh -lic env,含 PATH/JAVA_HOME 等),
  // 供 bash/init.sh/运行面板/环境检查继承
  loadUserEnv();
  // 恢复上次打开的项目（仅在 setup 完成后）
  let startHash: string | undefined;
  const tempStore = new Store();
  // SDK 升级后新增的内置模型合进缓存模型列表(聊天页下拉/会话页模型选择的数据源),
  // 否则新模型必须"打开供应商配置页保存一次"才会出现
  try { syncNativeModels(tempStore); } catch { /* 同步失败不影响启动 */ }
  // 兜底清理历史遗留的临时会话缓存(__new_ 前缀,真实会话创建后不再被读取)——防磁盘堆积
  try { cleanupTempCaches(); } catch { /* 清理失败不影响启动 */ }
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
            click: () => createWindow("/?fresh=1"),
          },
          { type: "separator" as const },
          { role: "close" as const },
        ],
      },
      { label: "Edit", submenu: [{ role: "undo" as const }, { role: "redo" as const }, { type: "separator" as const }, { role: "cut" as const }, { role: "copy" as const }, { role: "paste" as const }, { role: "selectAll" as const }] },
      { label: "View", submenu: [{ role: "reload" as const }, { role: "toggleDevTools" as const }, { type: "separator" as const }, { role: "zoomIn" as const }, { role: "zoomOut" as const }, { role: "resetZoom" as const }] },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    // Windows/Linux：移除 Electron 默认菜单栏（File/Edit/View/Window/Help），与 macOS 观感一致
    Menu.setApplicationMenu(null);
  }
});

app.on("window-all-closed", () => { app.quit(); });

app.on("before-quit", () => {
  if (sharedServices) sharedServices.agentService.shutdown();
});

// 异常退出兜底:dev 模式 Ctrl+C(SIGINT)/进程被 SIGTERM 时不触发 before-quit,
// 后台 shell 会变孤儿进程——显式挂信号监听调 shutdown 后退出。
// 注意:注册监听会替换 Node 默认行为,必须显式 app.quit()(shutdown 幂等,重复执行无害)
process.on("SIGINT", () => {
  if (sharedServices) sharedServices.agentService.shutdown();
  app.quit();
});
process.on("SIGTERM", () => {
  if (sharedServices) sharedServices.agentService.shutdown();
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── Multi-window IPC ──

ipcMain.handle("window:open-project", async (_e, { projectId, sessionId, init }) => {
  const params = new URLSearchParams();
  if (sessionId) params.set("session", sessionId);
  if (init) params.set("init", "1");
  params.set("fresh", "1"); // 标记为新窗口，App.tsx 跳过 tab 恢复
  const qs = params.toString();
  const hash = qs ? `/project/${projectId}?${qs}` : `/project/${projectId}`;
  if (sharedServices) sharedServices.store.setLastProjectId(projectId);
  const win = await createWindow(hash);
  trackProjectWindow(win, projectId);
});

ipcMain.handle("window:new", () => {
  createWindow("/?fresh=1");
});

ipcMain.handle("editor:open", (_e, filePath?: string) => {
  const editorPath = path.join(getResourcesDir(), "em-html-editor", "index.html");
  const editorWin = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    title: "EM HTML Editor",
    webPreferences: {
      sandbox: false,
      preload: path.join(__dirname, "..", "..", "preload", "dist", "preload.cjs"),
    },
  });
  if (filePath && fs.existsSync(filePath)) {
    editorWin.loadFile(editorPath);
    editorWin.webContents.on("did-finish-load", () => {
      let content = fs.readFileSync(filePath, "utf-8");
      const name = path.basename(filePath);
      // 编辑器用 blob: URL 加载原型（无目录概念），相对资源路径解析失败——
      // 注入前改写为基于原型目录的绝对路径，图片/样式才能在预览中显示
      const baseDir = path.dirname(filePath);
      content = absolutizePrototypePaths(content, baseDir);
      editorWin.webContents.executeJavaScript(
        `(function(){var c=${JSON.stringify(content)};var n=${JSON.stringify(name)};var p=${JSON.stringify(filePath)};if(typeof autoLoad==="function")autoLoad(c,n,p);})()`
      ).catch(() => {});
    });
  } else {
    editorWin.loadFile(editorPath);
  }
  editorWin.setMenuBarVisibility(false);
});

ipcMain.handle("editor:open-in-browser", (_e, filePath?: string) => {
  if (filePath && fs.existsSync(filePath)) shell.openPath(filePath);
});

/** 原型 HTML 相对资源路径 → 基于原型目录的绝对 file:// 路径（blob 预览无目录概念，不改写则图片/样式 404）。
 *  改写 src/href/url() 中不以协议、/、# 开头的相对路径；跳过 data: 内联与占位符。 */
function absolutizePrototypePaths(html: string, baseDir: string): string {
  const toFileUrl = (p: string) => "file://" + path.resolve(baseDir, p);
  return html
    .replace(/(src|href)=(["'])(?!([a-z]+:|data:|#|\/))([^"']*?)\2/g, (m, attr, q, _proto, p) =>
      `${attr}=${q}${toFileUrl(p)}${q}`)
    .replace(/url\((["']?)(?!([a-z]+:|data:|#|\/))([^"')]+?)\1\)/g, (_m, q, _proto, p) =>
      `url(${q}${toFileUrl(p)}${q})`);
}

ipcMain.handle("settings:set-last-project", (_e, { projectId }) => {
  if (sharedServices) sharedServices.store.setLastProjectId(projectId);
});
