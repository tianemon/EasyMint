import { execSync } from "child_process";
import fs from "fs";

export interface DetectResult {
  found: boolean;
  version?: string;
}

const NODE_PATHS = [
  "node",                                     // 系统 PATH
  "/usr/local/bin/node",                      // Homebrew / 官方安装器
  "/opt/homebrew/bin/node",                   // Apple Silicon Homebrew
  "/usr/bin/node",                            // 系统自带
];

export function detectNode(): DetectResult {
  for (const p of NODE_PATHS) {
    try {
      if (fs.existsSync(p) || p === "node") {
        const version = execSync(`"${p}" --version`, { encoding: "utf-8", timeout: 5000 }).trim();
        return { found: true, version };
      }
    } catch { /* try next */ }
  }
  return { found: false };
}
