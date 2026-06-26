import { app, BrowserWindow, shell } from "electron";
import { autoUpdater } from "electron-updater";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * 自动更新服务 — 对接 GitHub Releases（仅检测，不自动下载安装）
 *
 * 检测到新版本后广播 downloaded 状态，前端显示红点 + 导航到 Release 页面。
 * 因 macOS 自动安装需要 Apple 开发者签名，当前仅做检测提醒。
 */

export type UpdateStatus =
  | "idle"
  | "checking"
  | "downloaded"
  | "no-update"
  | "error";

export interface UpdateStatusPayload {
  status: UpdateStatus;
  version?: string;
  errorMessage?: string;
  releasePage?: string;  // GitHub Release 页面 URL
}

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 10 * 1000;
const RELEASE_BASE = "https://github.com/tianemon/EasyMint/releases/tag";

let downloadedVersion: string | null = null;

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
    downloadedVersion = info.version ?? null;
    const releasePage = downloadedVersion ? `${RELEASE_BASE}/v${downloadedVersion}` : undefined;
    broadcast({ status: "downloaded", version: downloadedVersion ?? undefined, releasePage });
  });

  autoUpdater.on("update-not-available", () => {
    broadcast({ status: "no-update" });
  });

  autoUpdater.on("error", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    broadcast({ status: "error", errorMessage: message });
  });

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
}

export function startAutoUpdater(): void {
  if (app.isPackaged === false) return;

  setupListeners();

  const checkOnce = () => {
    if (downloadedVersion) return;
    autoUpdater.checkForUpdates().catch(() => {
      broadcast({ status: "error", errorMessage: "检测请求失败" });
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
    const releasePage = `${RELEASE_BASE}/v${downloadedVersion}`;
    broadcast({ status: "downloaded", version: downloadedVersion, releasePage });
    return;
  }
  autoUpdater.checkForUpdates().catch(() =>
    broadcast({ status: "error", errorMessage: "检测请求失败" })
  );
}

/** 打开 GitHub Release 页面（浏览器） */
export function openReleasePage(): void {
  if (downloadedVersion) {
    shell.openExternal(`${RELEASE_BASE}/v${downloadedVersion}`);
  }
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

  const shipItDir = path.join(os.homedir(), "Library", "Caches", "com.easymint.app.ShipIt");
  if (fs.existsSync(shipItDir)) {
    try {
      fs.rmSync(shipItDir, { recursive: true, force: true });
      cleaned.push(shipItDir);
    } catch (e) {
      errors.push(`${shipItDir}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { cleaned, errors };
}
