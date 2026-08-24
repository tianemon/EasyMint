/**
 * main 进程共享工具
 */
import os from "node:os";
import path from "node:path";
import { app } from "electron";

/** 解析 ~ 开头的路径为绝对路径，非 ~ 原样返回 */
export function resolveHome(dir: string): string {
  if (!dir.startsWith("~")) return dir;
  return path.join(os.homedir(), dir.slice(1));
}

/** 资源目录:dev = 项目根 resources/;打包 = process.resourcesPath(extraResources 输出,asar 外)。
    打包后 __dirname 在 asar 内,../ 到不了 asar 外——必须走 process.resourcesPath */
export function getResourcesDir(): string {
  return app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, "..", "..", "..", "resources");
}

// ── 常量 ──────────────────────────────────────────────

/** 图片扩展名 → MIME 类型 */
export const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};
