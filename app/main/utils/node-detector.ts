import { execSync } from "child_process";
import fs from "fs";

export interface DetectResult {
  found: boolean;
  version?: string;
}

const NODE_PATHS = process.platform === "win32"
  ? [
      "node",
      "C:\\Program Files\\nodejs\\node.exe",
      "C:\\Program Files (x86)\\nodejs\\node.exe",
      `${process.env.APPDATA}\\npm\\node.exe`,
    ]
  : [
      "node",
      "/usr/local/bin/node",
      "/opt/homebrew/bin/node",
      "/usr/bin/node",
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
