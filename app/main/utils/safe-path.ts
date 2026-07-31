/**
 * 路径安全工具
 *
 * 防止路径穿越攻击：确保用户提供的路径在允许范围内。
 */

import * as path from "node:path";
import { resolveHome } from "./paths";

function homeEasymint(): string {
  const os = require("node:os");
  return path.join(os.homedir(), ".easymint");
}

/**
 * 解析路径并检查是否在允许范围内
 *
 * @param userPath 用户提供的路径（可能含 ~、.. 等）
 * @param allowedBase 允许的基目录（如项目目录）
 * @returns 解析后的绝对路径
 * @throws 如果路径穿越到允许范围之外
 */
export function safeResolve(userPath: string, allowedBase: string): string {
  if (!userPath || typeof userPath !== "string") {
    throw new Error("无效的文件路径");
  }

  const expanded = resolveHome(userPath);
  const absolute = path.resolve(allowedBase, expanded);
  const normalized = path.normalize(absolute);

  // 获取真实路径（解析符号链接），如文件不存在则回退到规范化路径
  let realPath: string;
  try {
    const fs = require("node:fs");
    realPath = fs.realpathSync(normalized);
  } catch {
    realPath = normalized;
  }

  const allowedDirs = [
    path.resolve(allowedBase),
    homeEasymint(),
  ];

  const isAllowed = allowedDirs.some((dir) => {
    const rel = path.relative(dir, realPath);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  });

  if (!isAllowed) {
    throw new Error(`路径越界: ${userPath}`);
  }

  return normalized;
}

/**
 * 检查给定文件路径是否在项目目录内
 */
export function isPathWithin(userPath: string, baseDir: string): boolean {
  try {
    safeResolve(userPath, baseDir);
    return true;
  } catch {
    return false;
  }
}
