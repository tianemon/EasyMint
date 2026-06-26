import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";

/**
 * 自动更新服务 — 对接 GitHub Releases
 *
 * 生命周期：
 *  - 启动后等待 10s 做首次检测，之后每 4 小时检测一次
 *  - 检测到新版本自动后台下载（增量）
 *  - 下载完成广播 downloaded 状态，前端在设置按钮显示红点
 *  - 用户点击「重启更新」调用 quitAndInstall()
 *
 * 所有状态变更通过 `app:update-status` 广播给渲染进程。
 */

export type UpdateStatus =
  | "idle"          // 初始/空闲
  | "checking"      // 正在检查
  | "available"     // 发现新版本，下载中
  | "downloading"   // 下载中（带 percent）
  | "downloaded"    // 下载完成，等待安装
  | "no-update"     // 当前已是最新
  | "error";        // 检测/下载失败（静默）

export interface UpdateStatusPayload {
  status: UpdateStatus;
  version?: string;   // 新版本号（available/downloaded 时有值）
  percent?: number;   // 下载进度 0-100
}

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 小时
const INITIAL_DELAY_MS = 10 * 1000;            // 启动后 10s 首检

let currentVersion: string | null = null;       // 缓存已发现的新版本号
let downloadedVersion: string | null = null;    // 已下载完成的版本号

function broadcast(payload: UpdateStatusPayload): void {
  // 广播给所有窗口（多窗口场景，每个窗口都需要刷新红点/状态）
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("app:update-status", payload);
  }
}

function setupListeners(): void {
  autoUpdater.on("checking-for-update", () => {
    broadcast({ status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    currentVersion = info.version ?? null;
    broadcast({ status: "available", version: currentVersion ?? undefined });
  });

  autoUpdater.on("update-not-available", () => {
    broadcast({ status: "no-update" });
  });

  autoUpdater.on("download-progress", (progress) => {
    broadcast({
      status: "downloading",
      version: currentVersion ?? undefined,
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    downloadedVersion = info.version ?? currentVersion ?? null;
    broadcast({ status: "downloaded", version: downloadedVersion ?? undefined });
  });

  autoUpdater.on("error", () => {
    // 静默：更新不是关键路径，不打扰用户
    broadcast({ status: "error" });
  });

  // 已下载的更新关闭即安装
  autoUpdater.autoInstallOnAppQuit = true;
}

/** 启动自动检测定时器 */
export function startAutoUpdater(): void {
  if (app.isPackaged === false) return; // 开发模式不启用

  setupListeners();

  const checkOnce = () => {
    // 已下载完成的更新不再重复检测，避免 no-update 误清前端红点
    if (downloadedVersion) return;
    autoUpdater.checkForUpdates().catch(() => {
      broadcast({ status: "error" });
    });
  };

  setInterval(checkOnce, CHECK_INTERVAL_MS);
  // 首次延迟检测，避免与启动初始化抢资源
  setTimeout(checkOnce, INITIAL_DELAY_MS);
}

/** 手动触发检测（前端刷新按钮） */
export function checkForUpdatesManually(): void {
  if (app.isPackaged === false) {
    broadcast({ status: "no-update" });
    return;
  }
  // 已有下载完成的更新，直接广播 downloaded 状态，不重复检测
  if (downloadedVersion) {
    broadcast({ status: "downloaded", version: downloadedVersion });
    return;
  }
  autoUpdater.checkForUpdates().catch(() => broadcast({ status: "error" }));
}

/** 退出并安装已下载的更新 */
export function installUpdate(): void {
  if (downloadedVersion) {
    autoUpdater.quitAndInstall(false, true);
  }
}

/** 当前是否有已下载完成的更新 */
export function hasDownloadedUpdate(): boolean {
  return downloadedVersion !== null;
}

/** 已下载的版本号 */
export function getDownloadedVersion(): string | null {
  return downloadedVersion;
}

/** 预留：更新完整性校验（后续版本接入） */
export function _verifyUpdateChecksum(_path: string): boolean {
  return false;
}
