import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
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

function broadcast(payload: UpdateStatusPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("app:update-status", payload);
  }
}

function setupListeners(): void {
  autoUpdater.on("checking-for-update", () => {
    broadcast({ status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    detectedVersion = info.version ?? null;
    const totalSize = info.files[0]?.size;
    broadcast({ status: "available", version: detectedVersion ?? undefined, totalSize });
    // autoDownload: true，electron-updater 自动开始下载
  });

  autoUpdater.on("download-progress", (progress) => {
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
    broadcast({ status: "downloaded", version: downloadedVersion ?? undefined });
  });

  autoUpdater.on("update-not-available", () => {
    broadcast({ status: "no-update" });
  });

  autoUpdater.on("error", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    broadcast({ status: "error", errorMessage: message, errorPhase: "check" });
  });

  // electron-updater 负责下载（进度准），我们只接管安装
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
}

export function startAutoUpdater(): void {
  if (app.isPackaged === false) return;
  setupListeners();

  const checkOnce = () => {
    if (downloadedVersion) return;
    autoUpdater.checkForUpdates().catch(() => {
      broadcast({ status: "error", errorMessage: "检测请求失败", errorPhase: "check" });
    });
  };

  setInterval(checkOnce, CHECK_INTERVAL_MS);
  setTimeout(checkOnce, INITIAL_DELAY_MS);
}

export function checkForUpdatesManually(): void {
  if (app.isPackaged === false) {
    broadcast({ status: "no-update" });
    return;
  }
  if (downloadedVersion) {
    broadcast({ status: "downloaded", version: downloadedVersion });
    return;
  }
  autoUpdater.checkForUpdates().catch(() =>
    broadcast({ status: "error", errorMessage: "检测请求失败", errorPhase: "check" })
  );
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
  const script = [
    "#!/bin/bash",
    "sleep 2",
    `rm -rf "${tmpExtract}"`,
    `ditto -xk "${downloadedFile}" "${tmpExtract}"`,
    `ditto "${tmpExtract}/EasyMint.app" "${appPath}"`,
    `rm -rf "${tmpExtract}" "${downloadedFile}"`,
    `open "${appPath}"`,
  ].join("\n");

  const scriptPath = path.join(os.tmpdir(), "easymint-update.sh");
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });

  const { spawn } = require("child_process");
  spawn("bash", [scriptPath], { detached: true, stdio: "ignore" }).unref();

  app.quit();
}

export function hasDownloadedUpdate(): boolean {
  return downloadedVersion !== null;
}

export function getDownloadedVersion(): string | null {
  return downloadedVersion;
}

export function clearUpdateCache(): { cleaned: string[]; errors: string[] } {
  const cleaned: string[] = [];
  const errors: string[] = [];

  const targets: string[] = [];
  if (process.platform === "darwin") {
    targets.push(path.join(os.homedir(), "Library", "Caches", "com.easymint.app.ShipIt"));
  }
  targets.push(path.join(os.tmpdir(), "em-update-extract"));

  // 扫描临时目录里脚本残留
  try {
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (f.startsWith("easymint-") && f.endsWith(".sh")) {
        targets.push(path.join(os.tmpdir(), f));
      }
    }
  } catch { /* ignore */ }

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

  return { cleaned, errors };
}

/** 扫描更新缓存大小（字节），不清理。小于 1MB 视为无缓存（元数据残留不算） */
export function getUpdateCacheSize(): number {
  let total = 0;

  const dirs = [path.join(os.tmpdir(), "em-update-extract")];
  if (process.platform === "darwin") {
    dirs.push(path.join(os.homedir(), "Library", "Caches", "com.easymint.app.ShipIt"));
  }

  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        if (f.isFile()) {
          try { total += fs.statSync(path.join(dir, f.name)).size; } catch { /* skip */ }
        }
      }
    } catch { /* ignore */ }
  }

  // 统计临时目录里 .sh 脚本残留
  try {
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (f.startsWith("easymint-") && f.endsWith(".sh")) {
        try { total += fs.statSync(path.join(os.tmpdir(), f)).size; } catch { /* skip */ }
      }
    }
  } catch { /* ignore */ }

  // 小于 1MB 视为无缓存（electron-updater 元数据残留）
  return total >= 1024 * 1024 ? total : 0;
}

/** 打开更新缓存目录（Finder），目录不存在则回退到临时目录 */
export function openUpdateCacheDir(): void {
  const shipItDir = path.join(os.homedir(), "Library", "Caches", "com.easymint.app.ShipIt");
  const dir = process.platform === "darwin" && fs.existsSync(shipItDir)
    ? shipItDir
    : os.tmpdir();
  const { shell } = require("electron");
  shell.openPath(dir);
}
