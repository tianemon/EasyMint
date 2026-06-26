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

export function detectCodegraph(): DetectResult {
  for (const p of CG_PATHS) {
    try {
      if (fs.existsSync(p) || p === "codegraph") {
        const version = execSync(`"${p}" --version`, { encoding: "utf-8", timeout: 5000 }).trim();
        return { found: true, version };
      }
    } catch { /* try next */ }
  }
  return { found: false };
}
