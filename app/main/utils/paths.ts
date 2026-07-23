/**
 * main 进程共享工具
 */
import os from "node:os";
import path from "node:path";

/** 解析 ~ 开头的路径为绝对路径，非 ~ 原样返回 */
export function resolveHome(dir: string): string {
  if (!dir.startsWith("~")) return dir;
  return path.join(os.homedir(), dir.slice(1));
}

// ── 常量 ──────────────────────────────────────────────

/** 图片扩展名 → MIME 类型 */
export const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};
