import { app, BrowserWindow, net } from "electron";
import { autoUpdater } from "electron-updater";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * 自动更新 — 检测（electron-updater）+ 下载（Electron net）+ 安装（shell 脚本）
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
  errorMessage?: string;
  errorPhase?: "check" | "download";
}

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 10 * 1000;
const RELEASE_DOWNLOAD = "https://github.com/tianemon/EasyMint/releases/download";

let downloadedVersion: string | null = null;
let dmgPath: string | null = null;

function broadcast(payload: UpdateStatusPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("app:update-status", payload);
  }
}

/** 用 Electron net 下载 dmg（走系统代理），边下边报进度 */
function downloadDmg(url: string, dest: string, version: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let totalSize = 0;
    let received = 0;
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      try { file.close(); } catch { /* */ }
      try { fs.unlinkSync(dest); } catch { /* */ }
    };

    const request = net.request({ url, method: "GET", redirect: "follow" });

    request.on("response", (res) => {
      if (res.statusCode !== 200) {
        cleanup();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      // 头信息可能是小写或首字母大写，取第一个有效值
      const clArr = res.headers["content-length"] ?? res.headers["Content-Length"];
      totalSize = parseInt(clArr?.[0] || "0", 10);

      res.on("data", (chunk: Buffer) => {
        received += chunk.length;
        file.write(chunk);
        if (totalSize > 0) {
          const pct = Math.min(100, Math.round((received / totalSize) * 100));
          broadcast({ status: "downloading", version, percent: pct });
        }
      });

      res.on("end", () => { file.end(); });

      res.on("error", (e) => { cleanup(); reject(e); });

      file.on("finish", () => resolve());
      file.on("error", (e) => { cleanup(); reject(e); });
    });

    request.on("error", (e) => { cleanup(); reject(e); });
    request.end();
  });
}

function setupListeners(): void {
  autoUpdater.on("checking-for-update", () => {
    broadcast({ status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    const version = info.version ?? null;
    broadcast({ status: "available", version: version ?? undefined });

    const dmgFile = info.files.find((f) => f.url.endsWith(".dmg"));
    if (!dmgFile) {
      broadcast({ status: "error", errorMessage: "Release 中找不到 dmg 文件", errorPhase: "download" });
      return;
    }

    const url = `${RELEASE_DOWNLOAD}/v${version}/${dmgFile.url}`;
    const dest = path.join(os.tmpdir(), `easymint-${version}.dmg`);

    downloadDmg(url, dest, version!)
      .then(() => {
        dmgPath = dest;
        downloadedVersion = version;
        broadcast({ status: "downloaded", version: version ?? undefined });
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
    broadcast({ status: "error", errorMessage: message, errorPhase: "check" });
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

/** 退出，shell 脚本替换 app 后重启 */
export function installUpdate(): void {
  if (!downloadedVersion || !dmgPath || !fs.existsSync(dmgPath)) return;

  const appPath = path.dirname(path.dirname(path.dirname(app.getPath("exe"))));
  const script = [
    "#!/bin/bash",
    "sleep 2",
    `hdiutil attach "${dmgPath}" -nobrowse -mountpoint /tmp/em-update -quiet`,
    `ditto /tmp/em-update/EasyMint.app "${appPath}"`,
    "hdiutil detach /tmp/em-update -quiet",
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

  const targets = [
    path.join(os.homedir(), "Library", "Caches", "com.easymint.app.ShipIt"),
    "/tmp/em-update",  // 脚本残留的挂载点
  ];

  // 扫描临时目录里下载的 dmg
  try {
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (f.startsWith("easymint-") && (f.endsWith(".dmg") || f.endsWith(".sh"))) {
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
