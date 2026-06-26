import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

export interface DetectResult {
  found: boolean;
  version?: string;
}

const NPX_PATHS = [
  "npx",
  "/usr/local/bin/npx",
  "/opt/homebrew/bin/npx",
  "/usr/bin/npx",
];

// npx 是 node 脚本（shebang #!/usr/bin/env node），执行时 env 需在 PATH 找到 node。
// 打包 app 的 PATH 不含 /opt/homebrew/bin，需手动补上 node 所在目录。
const EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin"];
const ENV = { ...process.env, PATH: `${EXTRA_PATH.join(":")}:${process.env.PATH}` };

export function detectNpx(): DetectResult {
  for (const p of NPX_PATHS) {
    try {
      if (fs.existsSync(p) || p === "npx") {
        const version = execSync(`"${p}" --version`, { encoding: "utf-8", timeout: 10000, env: ENV }).trim();
        return { found: true, version: `npm ${version}` };
      }
    } catch { /* try next */ }
  }
  return { found: false };
}
