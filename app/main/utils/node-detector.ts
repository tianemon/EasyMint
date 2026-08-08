import { spawnSync } from "child_process";
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
        // spawnSync 不走 cmd shell——win 上找不到命令时 cmd 输出 GBK 报错会透传控制台成乱码
        const r = spawnSync(p, ["--version"], { encoding: "utf-8", timeout: 5000, stdio: "pipe", windowsHide: true });
        if (r.status === 0 && r.stdout) {
          return { found: true, version: r.stdout.trim() };
        }
      }
    } catch { /* try next */ }
  }
  return { found: false };
}
