import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import fs from "fs";
import path from "path";
import os from "os";
import https from "https";

/**
 * 自动更新服务 — 对接 GitHub Releases
 *
 * 检测由 electron-updater 负责（拉 latest-mac.yml 对比版本）。
 * 下载和安装走自定义逻辑：直接下载 dmg → shell 脚本替换 app。
 * 不通过 ShipIt，无需 Apple 开发者签名，绕过 ad-hoc 签名校验。
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
  errorMessage?: string;
  errorPhase?: "check" | "download";
}

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 10 * 1000;
const GITHUB_RELEASES = "https://github.com/tianemon/EasyMint/releases/download";

let currentVersion: string | null = null;
let downloadedVersion: string | null = null;
let reachedDownload = false;
let dmgPath: string | null = null;  // 已下载的 dmg 路径

function broadcast(payload: UpdateStatusPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("app:update-status", payload);
  }
}

/** 用 Node.js https 下载 dmg，边下边报进度 */
function downloadDmg(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let totalSize = 0;
    let downloaded = 0;

    const doRequest = (requestUrl: string) => {
      https.get(requestUrl, { headers: { "User-Agent": "EasyMint-Updater" } }, (res) => {
        // Follow redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          doRequest(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        totalSize = parseInt(res.headers["content-length"] || "0", 10);
        res.pipe(file);

        res.on("data", (chunk: Buffer) => {
          downloaded += chunk.length;
          if (totalSize > 0) {
            broadcast({
              status: "downloading",
              version: currentVersion ?? undefined,
              percent: Math.round((downloaded / totalSize) * 100),
            });
          }
        });

        file.on("finish", () => {
          file.close();
          resolve();
        });

        file.on("error", reject);
        res.on("error", reject);
      });
    };

    doRequest(url);
  });
}

function setupListeners(): void {
  autoUpdater.on("checking-for-update", () => {
    reachedDownload = false;
    broadcast({ status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    currentVersion = info.version ?? null;
    broadcast({ status: "available", version: currentVersion ?? undefined });

    // 从 files 列表里找到 dmg（electron-updater 默认选 zip，我们手动要 dmg）
    const dmgFile = info.files.find((f) => f.url.endsWith(".dmg"));
    if (!dmgFile) {
      broadcast({ status: "error", errorMessage: "Release 中找不到 dmg 文件", errorPhase: "download" });
      return;
    }

    const url = `${GITHUB_RELEASES}/v${currentVersion}/${dmgFile.url}`;
    const dest = path.join(os.tmpdir(), `easymint-${currentVersion}.dmg`);
    reachedDownload = false;

    downloadDmg(url, dest)
      .then(() => {
        dmgPath = dest;
        downloadedVersion = currentVersion;
        broadcast({ status: "downloaded", version: downloadedVersion ?? undefined });
      })
      .catch((e) => {
        broadcast({
          status: "error",
          errorMessage: e instanceof Error ? e.message : String(e),
          errorPhase: "download",
        });
      });
  });

  autoUpdater.on("update-not-available", () => {
    broadcast({ status: "no-update" });
  });

  autoUpdater.on("error", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    broadcast({ status: "error", errorMessage: message, errorPhase: reachedDownload ? "download" : "check" });
  });

  // 关掉 ShipIt，完全自己装
  autoUpdater.autoDownload = false;
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

/** 退出并用 shell 脚本替换 app 后重启（绕过 ShipIt / 签名校验） */
export function installUpdate(): void {
  if (!downloadedVersion || !dmgPath || !fs.existsSync(dmgPath)) return;

  const appPath = path.dirname(path.dirname(path.dirname(app.getPath("exe"))));
  const script = [
    `#!/bin/bash`,
    `sleep 2`,
    `hdiutil attach "${dmgPath}" -nobrowse -mountpoint /tmp/em-update -quiet`,
    `ditto /tmp/em-update/EasyMint.app "${appPath}"`,
    `hdiutil detach /tmp/em-update -quiet`,
    `rm -f "${dmgPath}"`,
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

  // ShipIt 残留（旧版忽略）+ 下载的 dmg 临时文件
  const shipItDir = path.join(os.homedir(), "Library", "Caches", "com.easymint.app.ShipIt");
  const tempDmgs = path.join(os.tmpdir());
  const entriesToClean = [shipItDir];

  // 清理下载的临时 dmg
  try {
    const files = fs.readdirSync(tempDmgs);
    for (const f of files) {
      if (f.startsWith("easymint-") && f.endsWith(".dmg")) {
        entriesToClean.push(path.join(tempDmgs, f));
      }
    }
  } catch { /* ignore */ }

  for (const entry of entriesToClean) {
    try {
      if (fs.existsSync(entry)) {
        fs.rmSync(entry, { recursive: true, force: true });
        cleaned.push(entry);
      }
    } catch (e) {
      errors.push(`${entry}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { cleaned, errors };
}
