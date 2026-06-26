import { execSync } from "child_process";
import fs from "fs";

export interface DetectResult {
  found: boolean;
  version?: string;
}

const NPX_PATHS = process.platform === "win32"
  ? [
      "npx.cmd",
      "npx",
      `${process.env.ProgramFiles}\\nodejs\\npx.cmd`,
      `${process.env.APPDATA}\\npm\\npx.cmd`,
    ]
  : [
      "npx",
      "/usr/local/bin/npx",
      "/opt/homebrew/bin/npx",
      "/usr/bin/npx",
    ];

// npx 是 node 脚本（shebang #!/usr/bin/env node），执行时 env 需在 PATH 找到 node。
const EXTRA_PATH = process.platform === "win32"
  ? [`${process.env.ProgramFiles}\\nodejs`, `${process.env.APPDATA}\\npm`]
  : ["/opt/homebrew/bin", "/usr/local/bin"];
const SEP = process.platform === "win32" ? ";" : ":";
const ENV = { ...process.env, PATH: `${EXTRA_PATH.join(SEP)}${SEP}${process.env.PATH}` };

export function detectNpx(): DetectResult {
  for (const p of NPX_PATHS) {
    try {
      if (fs.existsSync(p) || p === "npx" || p === "npx.cmd") {
        const version = execSync(`"${p}" --version`, { encoding: "utf-8", timeout: 10000, env: ENV }).trim();
        return { found: true, version: `npm ${version}` };
      }
    } catch { /* try next */ }
  }
  return { found: false };
}
