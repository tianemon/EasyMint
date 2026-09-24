import fs from "fs";
import { app, BrowserWindow, shell, ipcMain, Menu, nativeTheme, dialog } from "electron";
import path from "path";
import { loadUserEnv } from "./utils/user-path";
import { installSystemProxyFetch, redactProxyUrl } from "./services/system-proxy";
import { getResourcesDir, emHome } from "./utils/paths";
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
const EM_HOME = emHome();
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
} catch (e) { console.warn("[pi] SDK package.json 定制跳过（保持当前配置/只读环境）:", (e as Error).message); }

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
import { getNativeConfig } from "./services/native-config";
import { armSessionDirReady, primeSessionManagerClass } from "./services/pi-session-dir";
import { migrateLegacySessionDirs } from "./services/session-dir-migration";

import { cleanupOrphanCaches, cleanupTempCaches } from "./services/session-cache";
import { watchProjectWindow } from "./services/window-manager";
import { SessionCoordinator } from "./services/session-coordinator";
import { RemoteCommandRouter } from "./services/remote-command-router";
import { RemoteTerminalService } from "./services/remote-terminal-service";
import { appEventBus } from "./services/app-event-bus";
import { applyDockIcon } from "./utils/dock-icon";
import { shutdownWindowsExecutionWorkers } from "./services/sandbox/windows-execution-manager";
import { releaseSandbox } from "./services/sandbox/manager";
import { backgroundShellRegistry } from "./services/background-shell/registry";
import { closeAllMcpClients } from "./services/permission/mcp-adapter";
import { snapshotProcessPids, stopAllProcesses } from "./services/process-service";
import { signalTrackedChildren, snapshotTrackedChildren } from "./services/process-registry";

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
  remoteTerminalService: RemoteTerminalService;
} | null = null;

/**
 * 渲染进程健康诊断：渲染进程非正常退出后，窗口会变成「帧已销毁、窗口对象还在」的僵尸状态，
 * 之后每次广播都会抛「Render frame was disposed before WebFrameMain could be accessed」。
 * 只看那串刷屏判断不出真正原因（崩溃？被系统杀死？页面重载？）——这里把原因打出来。
 * 不自动恢复：崩溃应当被看见，自动重载会把它藏起来（且会与持续崩溃形成重启循环）。
 */
function watchRendererGone(window: BrowserWindow): void {
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[renderer] 渲染进程退出: reason=${details.reason} exitCode=${details.exitCode}`);
  });
}

export async function createWindow(hash?: string, _isMain = false): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    titleBarStyle: "hiddenInset",
    // Windows：隐藏系统标题栏（保留窗口框架/Snap/缩放），窗口按钮由 renderer 自绘（WindowControls）
    ...(process.platform === "win32" ? { titleBarStyle: "hidden" as const } : {}),
    // 窗口图标：Windows / Linux 用（macOS 忽略此选项、图标由 bundle 决定，故 mac 不传）。
    // 按平台选格式（win 认 ico、linux 认 png）—— 曾统一传 icon.icns 且 dev 不传：前者在非 mac
    // 不受支持（形同无效），后者让 dev 下窗口/任务栏顶着 Electron 默认图标。
    ...(process.platform === "darwin" ? {} : {
      icon: path.join(__dirname, "..", "..", "..", "assets",
        process.platform === "win32" ? "icon.ico" : "icon.png"),
    }),
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "dist", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  watchProjectWindow(window);

  // macOS：启动即铺满可用屏幕（非全屏，保留菜单栏/Dock）——避免固定 1400×900 在小屏上呈「满高不满宽」
  if (process.platform === "darwin") {
    window.maximize();
  }

  // Windows 自绘按钮需要最大化状态：主进程监听并广播
  if (process.platform === "win32") {
    window.on("maximize", () => window.webContents.send("win:maximized-changed", true));
    window.on("unmaximize", () => window.webContents.send("win:maximized-changed", false));
  }

  // Initialize shared services once. IPC handlers are registered only for the main window;
  // additional windows reuse the same services via the preload bridge.
  if (!sharedServices) {
    const store = new Store();
    const projectService = new ProjectService(store);
    const fileService = new FileService();
    const agentService = new AgentService(store);
    const coordinator = new SessionCoordinator(projectService, agentService);
    const commandRouter = new RemoteCommandRouter(coordinator, agentService, store, window);
    const remoteTerminalService = new RemoteTerminalService((deviceId, command) =>
      commandRouter.handle(deviceId, command));
    appEventBus.subscribe((event) => remoteTerminalService.forwardAppEvent(event));
    sharedServices = {
      store,
      projectService,
      fileService,
      agentService,
      remoteTerminalService,
    };
    // 已配对手机应能在应用重启后直接重连；首次使用前不监听额外端口。
    if (remoteTerminalService.listDevices().length > 0) {
      void remoteTerminalService.ensureStarted().catch((error: unknown) => {
        console.error("[mobile-terminal] 启动失败:", error instanceof Error ? error.message : String(error));
      });
    }
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
    const cleanFile = path.join(emHome(), ".cleanup-pending.json");
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

  watchRendererGone(window);

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

app.whenReady().then(async () => {
  // 先按系统外观应用一次 Dock 图标（仅 macOS；其它平台在 applyDockIcon 内直接返回）。
  // 已知限制：应用有窗口之前调用不会立刻改变可见图标（启动阶段那张 tile 是 macOS 用 bundle 图标画的，
  // 要等窗口出现才重绘）——这步只让那次重绘就用上我们的图标与最接近的主题。
  applyDockIcon(nativeTheme.shouldUseDarkColors ? "dark" : "light");
  // GUI 环境引导:提取用户完整环境(zsh -lic env,含 PATH/JAVA_HOME 等),
  // 供 bash/init.sh/运行面板/环境检查继承
  loadUserEnv();
  // 让主进程的 HTTP 跟随系统代理：Node 原生 fetch 不读系统代理、也不读 HTTPS_PROXY（运行期设也无效），
  // 于是会出现"浏览器授权页成功、程序内换 token 被地区拦截"的错位——详见 services/system-proxy.ts。
  // 必须早于任何网络请求；检测不到代理时什么都不做。
  {
    const r = installSystemProxyFetch();
    // 地址要脱敏：代理 URL 允许带 user:pass（企业代理常见），原样打印等于把凭据写进日志/截图
    console.log(`[main] 系统代理: ${r.reason}${r.proxy ? `（${redactProxyUrl(r.proxy)}）` : ""}`);
  }
  // 恢复上次打开的项目（仅在 setup 完成后）
  let startHash: string | undefined;
  const tempStore = new Store();
  // 配置迁移在后台进行，不阻塞窗口出现：所有读配置的入口（settings:get / settings:set /
  // agent:*）都经 getNativeConfig 自然等它就绪，「迁移早于任何配置读写」仍然成立。
  // 在此 await 会把窗口出现推迟首次 SDK 冷导入的时长（实测约 9 秒）——与本文件下方
  // 「会话目录对齐 Pi」注释记载的规则（不能在 createWindow 之前 await SDK 导入）同源。
  const configReady = getNativeConfig(tempStore);
  configReady.catch((error) => {
    // 这里会让 EM **完全打不开**，所以错误框必须可操作：只报「配置加载失败」+ 原文的话，
    // 用户既不知道坏的是哪个文件、也不知道备份在哪、下一步做什么——只能重装或来报 bug。
    const dataDir = tempStore.getDataDir();
    const backups = path.join(dataDir, "config-backups");
    const lines = [(error as Error).message, "", `配置目录：${dataDir}`];
    if (fs.existsSync(backups)) lines.push(`改动前的备份：${backups}（可从最近一份里取回被改坏的文件）`);
    lines.push(
      "",
      "排查建议：",
      "① 按上面的信息定位到那个文件，确认它是合法 JSON；",
      `② 若无法定位，把整个「${dataDir}」目录改名（如加 -bak 后缀）后重新启动——EM 会以全新配置开始，原数据仍留在改名后的目录里。`,
    );
    dialog.showErrorBox("配置加载失败", lines.join("\n"));
    app.quit();
  });
  // 兜底清理历史遗留的临时会话缓存(__new_ 前缀,真实会话创建后不再被读取)——防磁盘堆积
  try { cleanupTempCaches(); } catch { /* 清理失败不影响启动 */ }
  // 清理孤儿会话缓存(会话已删除/项目已移除的残留 key)——防磁盘堆积
  try { cleanupOrphanCaches(); } catch { /* 清理失败不影响启动 */ }
  // 会话目录对齐 Pi：① 预热 SessionManager 类（getPiSessionDir 经它向 SDK 取默认路径）
  // ② 把 EM 旧编码目录迁到 Pi 默认编码——必须早于任何会话读写，否则历史会话落在旧目录、
  //    在新编码路径下不可见，故启动时改名并合并。
  // **不能在 createWindow 之前 await**：首次 dynamic import SDK 冷启实测 7~10 秒（包体大，几乎全是文件 IO），会把窗口
  // 出现推迟同样久。改为后台任务 + 注册「会话目录就绪门」：pi-session-dir 的异步会话入口
  // （create/resume/list）会先 await 这道门，保证读写发生在迁移之后，窗口则照旧立即出现。
  // 注意：NEW_SESSIONS_DIR 必须与顶部 PI_CODING_AGENT_DIR 推导出的 agentDir/sessions 一致，
  // 否则迁移扫的目录 ≠ 会话实际落盘目录（迁了个寂寞）；改任一处都要同时改另一处。
  // ⚠️ 一次性迁移（待移除）：清理清单见 session-dir-migration.ts 顶部
  armSessionDirReady(
    (async () => {
      try {
        await primeSessionManagerClass();
        const r = migrateLegacySessionDirs(NEW_SESSIONS_DIR);
        if (r.renamed > 0 || r.merged > 0 || r.failed > 0) {
          console.log(
            `[migrate] 会话目录对齐 Pi：改名 ${r.renamed}、并入 ${r.merged}、跳过 ${r.skipped}、失败 ${r.failed}`,
          );
        }
      } catch (e) {
        // 迁移或预热失败不阻断启动：数据保持原样，下次启动重试（迁移幂等）
        console.error("[migrate] 会话目录对齐 Pi 未完成（下次启动重试）:", (e as Error).message);
      }
    })(),
  );
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

// ── 退出清场 ──
// Electron 主进程退出**不会**带走自己 spawn 的子进程。EM 的常驻子进程有五类：
// ① 后台 shell 注册表（Mint 的 background:true）② 运行面板进程组（run.json 里的 dev server）
// ③ 前台命令通道（bash / install_dependency / shell:exec）④ stdio MCP server（codegraph 等）
// ⑤ **沙盒的 macOS 日志监控**——srt 内部 spawn 的常驻 log stream。前四类由本函数直接杀；
//    第五类只能经 srt 的 reset 释放（见 sandbox/manager 的 releaseSandbox）。漏掉它时主进程照样
//    干净退出，但监控进程会变孤儿（PPID=1）→ LaunchServices 把 EasyMint 记为
//    exited-with-subordinates，macOS 26+ 据此在 Dock 上持续提示「仍在后台运行」（2026-09-24 实测）。
// 不收尾的后果：进程成孤儿——占着端口/内存而 EM 再也管不到（下次启动面板显示「未运行」、
// 端口却仍被占），macOS 26+ 还会把「App 退出后仍活跃的后台任务」显性提示给用户。
//
// **唯一例外**：macOS 更新替换脚本是**刻意**留在退出后跑完的（见 auto-updater.installUpdate），
// 它不在任何登记表里，清场不会碰它——所以这套收尾不会打断更新。
//
// 时序：before-quit 先 preventDefault 拦住退出 → 异步清场 → 置位后再 app.quit() 放行。
/** 清场总预算：收尾而已，绝不能让用户卡在「点了退出却迟迟不退」 */
const QUIT_CLEANUP_TIMEOUT_MS = 3000;
/** SIGTERM 与 SIGKILL 之间的宽限期：给进程自己清理的机会 */
const QUIT_KILL_GRACE_MS = 300;

let quitCleanupState: "idle" | "running" | "done" = "idle";
/** 退出请求计数：用户再次要求退出（连点退出 / Ctrl+C 第二次）→ 不再等清场 */
let quitRequests = 0;

async function runQuitCleanup(): Promise<void> {
  // 每一步独立失败：某条通道出问题不能拖累其余清理（清场必须走完）
  const step = async (label: string, fn: () => void | Promise<void>): Promise<void> => {
    try { await fn(); } catch (e) { console.warn(`[quit] ${label} 清理失败（忽略）:`, (e as Error).message); }
  };
  // 第一轮信号后父进程可能先退出、登记表随之删项；先冻结进程组，第二轮仍能杀存活的子进程。
  const shellPids = backgroundShellRegistry.list().map((shell) => shell.child.pid).filter((pid): pid is number => !!pid);
  const processPids = snapshotProcessPids();
  const trackedChildren = snapshotTrackedChildren();

  // MCP 关闭可能等待远端超时；先启动它，但不能让它挡住本地进程的 TERM/KILL 两阶段清理。
  const mcpCleanup = step("MCP 客户端", () => closeAllMcpClients());
  const windowsCleanup = step("Windows 沙盒 worker", () => shutdownWindowsExecutionWorkers());
  await step("会话与后台命令", () => {
    if (!sharedServices) return;
    sharedServices.agentService.shutdown();   // 内部含 backgroundShellRegistry.stopAll()
    sharedServices.remoteTerminalService.close();
  });
  await step("运行面板进程", () => { stopAllProcesses("SIGTERM", processPids); });
  await step("命令通道进程", () => { signalTrackedChildren("SIGTERM", trackedChildren); });

  // 宽限后仍活着的补 SIGKILL：后台 shell 的「5s 未退出就强杀」兜底此刻不会执行
  // （主进程马上退出，那个定时器永不触发），所以由清场直接补刀。
  await new Promise((resolve) => setTimeout(resolve, QUIT_KILL_GRACE_MS));
  await step("后台命令强制收尾", () => backgroundShellRegistry.forceKillAll(shellPids));
  await step("运行面板进程强制收尾", () => { stopAllProcesses("SIGKILL", processPids); });
  await step("命令通道进程强制收尾", () => { signalTrackedChildren("SIGKILL", trackedChildren); });
  // 沙盒的常驻监控：位置有两处讲究——必须在进程收尾之后（Linux 侧 reset 会强清 bwrap 挂载点，
  // 子进程还活着时清不安全），又必须排在 MCP 关闭之前（MCP 关闭可能等远端超时，排它后面会被
  // 3s 的清场总预算截断，那就等于没修）。
  await step("沙盒监控", () => releaseSandbox());
  await Promise.all([mcpCleanup, windowsCleanup]);
}

app.on("before-quit", (event) => {
  if (quitCleanupState === "done") return;      // 清场已完成 → 放行，真正退出
  quitRequests++;
  if (quitRequests > 1) {
    // 再次收到退出请求：清场是「尽量收干净」，不能变成「退不掉」的理由——直接放行
    quitCleanupState = "done";
    return;
  }
  event.preventDefault();                        // 先拦住，等清场做完再退
  quitCleanupState = "running";
  void (async () => {
    try {
      await Promise.race([
        runQuitCleanup(),
        new Promise((resolve) => setTimeout(resolve, QUIT_CLEANUP_TIMEOUT_MS)),  // 超时兜底：绝不阻塞退出
      ]);
    } finally {
      quitCleanupState = "done";
      app.quit();
    }
  })();
});

// 异常退出兜底:dev 模式 Ctrl+C(SIGINT)/进程被 SIGTERM 时不触发 before-quit,
// 后台 shell 会变孤儿进程——显式挂信号监听后退出。
// 注意:注册监听会替换 Node 默认行为,必须显式 app.quit()(清场幂等,重复执行无害)
// 具体的收尾动作已统一收在 before-quit 的清场里,这里只负责把退出请求转进去。
process.on("SIGINT", () => { app.quit(); });
process.on("SIGTERM", () => { app.quit(); });

// ── 全局异常兜底 ──
// Electron 主进程无兜底时:未捕获异常/异步拒绝会弹「Uncaught Exception」崩溃框并终止进程
// (窗口全关、未保存状态丢失)。agent 回合类错误已由 agent-service 广播层降级(用户可见),
// 能漏到这里的多是外围一次性异步任务的偶发故障——记日志 + 落盘后保持运行,明确不弹框、不退出。
const GLOBAL_ERR_LOG = path.join(EM_HOME, "logs", "error.log");
function logGlobalError(kind: "uncaughtException" | "unhandledRejection", detail: unknown): void {
  const stack = detail instanceof Error ? `${detail.name}: ${detail.message}\n${detail.stack ?? ""}` : String(detail);
  console.error(`[process] ${kind}:\n${stack}`);
  // 落盘 ~/.easymint/logs/error.log 供事后诊断;超 5MB 滚动为 .old(保留最近一份),防无限增长
  try {
    fs.mkdirSync(path.dirname(GLOBAL_ERR_LOG), { recursive: true });
    if (fs.existsSync(GLOBAL_ERR_LOG) && fs.statSync(GLOBAL_ERR_LOG).size > 5 * 1024 * 1024) {
      fs.rmSync(`${GLOBAL_ERR_LOG}.old`, { force: true });
      fs.renameSync(GLOBAL_ERR_LOG, `${GLOBAL_ERR_LOG}.old`);
    }
    fs.appendFileSync(GLOBAL_ERR_LOG, `[${new Date().toISOString()}] ${kind}\n${stack}\n\n`, "utf-8");
  } catch { /* 日志目录只读/磁盘满时放弃落盘,不影响主流程 */ }
}
// 同一次故障偶发同时触发两类事件(Exception 先、其异步副作用 Rejection 紧随)——
// 对同一错误 1s 内去重,避免双份日志刷屏
let lastGlobalErr = { at: 0, key: "" };
const reportGlobalErr = (kind: "uncaughtException" | "unhandledRejection", detail: unknown): void => {
  const key = detail instanceof Error ? detail.message : String(detail);
  const now = Date.now();
  if (now - lastGlobalErr.at < 1000 && key === lastGlobalErr.key) return;
  lastGlobalErr = { at: now, key };
  logGlobalError(kind, detail);
};
process.on("uncaughtException", (err) => reportGlobalErr("uncaughtException", err));
process.on("unhandledRejection", (reason) => reportGlobalErr("unhandledRejection", reason));

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
  await createWindow(hash);
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
  watchRendererGone(editorWin);
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
