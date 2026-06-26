import { execSync } from "child_process";
import fs from "fs";

export interface DetectResult {
  found: boolean;
  version?: string;
}

const CG_PATHS = [
  "codegraph",
  "/usr/local/bin/codegraph",
  "/opt/homebrew/bin/codegraph",
];

// codegraph 是 node 脚本，执行时 env 需在 PATH 找到 node（同 npx）。
const EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin"];
const ENV = { ...process.env, PATH: `${EXTRA_PATH.join(":")}:${process.env.PATH}` };

export function detectCodegraph(): DetectResult {
  for (const p of CG_PATHS) {
    try {
      if (fs.existsSync(p) || p === "codegraph") {
        const version = execSync(`"${p}" --version`, { encoding: "utf-8", timeout: 5000, env: ENV }).trim();
        return { found: true, version };
      }
    } catch { /* try next */ }
  }
  return { found: false };
}
