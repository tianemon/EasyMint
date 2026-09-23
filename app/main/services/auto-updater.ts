import { app, BrowserWindow, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * 自动更新 — 检测+下载（electron-updater）+ 安装（shell 脚本）
 * 不走 ShipIt，无需 Apple 开发者签名。
 */

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "no-update"
  | "error";

export interface UpdateStatusPayload {
  status: UpdateStatus;
  version?: string;
  percent?: number;
  transferred?: number;  // 已下载字节
  totalSize?: number;    // 安装包总字节
  errorMessage?: string;
  errorPhase?: "check" | "download";
}

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 10 * 1000;

let detectedVersion: string | null = null;      // update-available 时记录的版本号
let downloadedVersion: string | null = null;   // 已下载完成的版本号
let downloadedFile: string | null = null;      // electron-updater 下载到本地的文件路径
let checking = false;                          // 防重入:检查请求进行中(自动/手动同时触发只发一次)
let downloading = false;                       // 防重入:发现更新后下载在途(available→downloaded,可能数分钟)
let manualCheckDone = false;                   // 用户手动点过「检查更新」→ 取消后续自动检查
let reachedDownload = false;                   // 是否已进入下载阶段(error 时据此区分「检测失败」/「下载失败」)

/** 下载状态持久化路径(userData,重启后红点/气泡仍在;安装后启动时自清) */
function persistPath(): string {
  return path.join(app.getPath("userData"), "update-downloaded.json");
}

function loadPersistedDownload(): { version: string; file: string | null } | null {
  try {
    if (!fs.existsSync(persistPath())) return null;
    const d = JSON.parse(fs.readFileSync(persistPath(), "utf-8")) as { version?: string; file?: string | null };
    return d?.version ? { version: d.version, file: d.file ?? null } : null;
  } catch { return null; }
}

function persistDownload(): void {
  try {
    fs.writeFileSync(persistPath(), JSON.stringify({ version: downloadedVersion, file: downloadedFile }));
  } catch { /* 持久化失败不影响本次会话 */ }
}

function clearPersistedDownload(): void {
  try { fs.rmSync(persistPath(), { force: true }); } catch { /* ignore */ }
}

// 模块加载时恢复持久化下载状态:当前运行版本 === 已下载版本 → 说明已装上新版,清除标记
const persisted = loadPersistedDownload();
if (persisted) {
  if (persisted.version === app.getVersion()) {
    clearPersistedDownload();
  } else {
    downloadedVersion = persisted.version;
    downloadedFile = persisted.file;
  }
}

function broadcast(payload: UpdateStatusPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("app:update-status", payload);
  }
}

function setupListeners(): void {
  autoUpdater.on("checking-for-update", () => {
    reachedDownload = false;   // 新一轮检测:下载阶段归零
    broadcast({ status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    detectedVersion = info.version ?? null;
    downloading = true; // 下载在途:后续检查请求直接忽略,避免重复触发导致界面状态闪烁
    // 此处只是「发现新版本」,下载尚未真正开始 —— 保持 false,失败仍归检测阶段
    reachedDownload = false;
    broadcast({ status: "available", version: detectedVersion ?? undefined });
    // autoDownload: true，electron-updater 自动开始下载
  });

  autoUpdater.on("download-progress", (progress) => {
    reachedDownload = true;   // 收到进度 ⇒ 下载已确实开始,此后的失败归下载阶段
    broadcast({
      status: "downloading",
      version: detectedVersion ?? undefined,
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      totalSize: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    downloadedVersion = info.version ?? null;
    downloadedFile = info.downloadedFile ?? null;
    downloading = false;
    persistDownload(); // 持久化:重启后红点/气泡仍在
    broadcast({ status: "downloaded", version: downloadedVersion ?? undefined });
  });

  autoUpdater.on("update-not-available", () => {
    downloading = false;
    broadcast({ status: "no-update" });
  });

  autoUpdater.on("error", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    downloading = false;
    // 已进过下载阶段 ⇒ 这次失败出在下载;否则归检测(含握手/元数据阶段)
    broadcast({ status: "error", errorMessage: message, errorPhase: reachedDownload ? "download" : "check" });
  });

  // electron-updater 负责下载（进度准），我们只接管安装
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
}

export function startAutoUpdater(): void {
  if (app.isPackaged === false) return;
  setupListeners();

  const checkOnce = () => {
    if (downloadedVersion) return;   // 已下载完成,不再检查
    if (manualCheckDone) return;     // 用户已手动点过「检查更新」→ 取消自动检查,不再打扰
    if (checking || downloading) return; // 检查请求在途 / 下载在途 → 忽略,防重复触发界面闪烁
    checking = true;
    autoUpdater.checkForUpdates().catch(() => {
      broadcast({ status: "error", errorMessage: "检测请求失败", errorPhase: "check" });
    }).finally(() => { checking = false; });
  };

  setInterval(checkOnce, CHECK_INTERVAL_MS);
  setTimeout(checkOnce, INITIAL_DELAY_MS);
}

export function checkForUpdatesManually(): void {
  // 用户主动检查过 → 取消后续自动检查（自动检查不再打扰）
  manualCheckDone = true;
  if (app.isPackaged === false) {
    broadcast({ status: "no-update" });
    return;
  }
  if (downloadedVersion) {
    broadcast({ status: "downloaded", version: downloadedVersion });
    return;
  }
  if (checking || downloading) return;  // 检查请求/下载在途,手动点击忽略(界面已有对应状态)
  checking = true;
  autoUpdater.checkForUpdates().catch(() =>
    broadcast({ status: "error", errorMessage: "检测请求失败", errorPhase: "check" })
  ).finally(() => { checking = false; });
}

/** shell 单引号转义：路径含空格或引号时仍作为一个参数传递。 */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** 安装更新（Windows 走原生 NSIS，macOS 走 shell 脚本替换） */
export function installUpdate(): void {
  if (!downloadedVersion) return;

  if (process.platform === "win32") {
    autoUpdater.quitAndInstall(false, true);
    return;
  }

  // macOS: shell 脚本解压 zip → 替换 app → 重启
  if (!downloadedFile || !fs.existsSync(downloadedFile)) return;

  const appPath = path.dirname(path.dirname(path.dirname(app.getPath("exe"))));
  const tmpExtract = "/tmp/em-update-extract";
  // ⚠️ 这个脚本是**刻意**留在退出后继续跑的（替换正在运行的 app，必须先退出），
  // 因此它**不登记**进 process-registry —— index.ts 的退出清场不会碰它。
  const script = [
    "#!/bin/bash",
    "set -u",
    'exec >>"/tmp/easymint-update.log" 2>&1',
    'echo "=== em update start: $(date) ==="',
    `APP=${shQuote(appPath)}`,
    `ZIP=${shQuote(downloadedFile)}`,
    `TMP=${shQuote(tmpExtract)}`,
    'NEW="$APP.new"',
    'BAK="$APP.bak"',
    "",
    "sleep 4",
    'rm -rf "$TMP" "$NEW" "$BAK"',
    'ditto -xk "$ZIP" "$TMP" || exit 1',
    'ditto "$TMP/EasyMint.app" "$NEW" || exit 1',
    'mv "$APP" "$BAK" || exit 1',
    'mv "$NEW" "$APP" || { mv "$BAK" "$APP"; open "$APP"; exit 1; }',
    'echo "=== em update swapped: $(date) ==="',
    'rm -rf "$BAK" "$TMP" "$ZIP"',
    'open "$APP"',
  ].join("\n");

  const scriptPath = path.join(os.tmpdir(), "easymint-update.sh");
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });

  spawn("bash", [scriptPath], { detached: true, stdio: "ignore" }).unref();

  app.quit();
}

export function hasDownloadedUpdate(): boolean {
  return downloadedVersion !== null;
}

export function getDownloadedVersion(): string | null {
  return downloadedVersion;
}

/** electron-updater 缓存目录，不同平台位置不同 */
function updaterCacheDir(): string {
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Caches", "easymint-updater");
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || os.tmpdir(), "easymint-updater");
  return path.join(os.homedir(), ".cache", "easymint-updater"); // linux
}

export function clearUpdateCache(): { cleaned: string[]; errors: string[] } {
  const cleaned: string[] = [];
  const errors: string[] = [];

  const targets = [updaterCacheDir()];

  for (const p of targets) {
    try {
      if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
        cleaned.push(p);
      }
    } catch (e) {
      errors.push(`${p}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 用户主动清缓存 = 放弃本次更新:重置下载状态(内存 + 持久化)
  downloadedVersion = null;
  downloadedFile = null;
  clearPersistedDownload();

  return { cleaned, errors };
}

/** 扫描更新缓存大小（字节），不清理。小于 1MB 视为无缓存（元数据残留不算） */
export function getUpdateCacheSize(): number {
  let total = 0;
  const dir = updaterCacheDir();

  try {
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        if (f.isFile()) {
          try { total += fs.statSync(path.join(dir, f.name)).size; } catch { /* skip */ }
        }
      }
    }
  } catch { /* ignore */ }

  // 小于 1MB 视为无缓存（元数据残留）
  return total >= 1024 * 1024 ? total : 0;
}

/** 打开更新缓存目录 */
export function openUpdateCacheDir(): void {
  const dir = fs.existsSync(updaterCacheDir()) ? updaterCacheDir() : os.tmpdir();
  // shell imported from top-level
  shell.openPath(dir);
}

/** 仅供测试：直接驱动事件监听，绕开 startAutoUpdater 的定时器 */
export const autoUpdaterInternals = { setupListeners };
