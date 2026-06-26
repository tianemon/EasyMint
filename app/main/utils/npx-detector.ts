import { execSync } from "child_process";
import fs from "fs";

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

export function detectNpx(): DetectResult {
  for (const p of NPX_PATHS) {
    try {
      if (fs.existsSync(p) || p === "npx") {
        const version = execSync(`"${p}" --version`, { encoding: "utf-8", timeout: 10000 }).trim();
        return { found: true, version: `npm ${version}` };
      }
    } catch { /* try next */ }
  }
  return { found: false };
}
