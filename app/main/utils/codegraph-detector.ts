import { execSync } from "child_process";
import fs from "fs";

export interface DetectResult {
  found: boolean;
  version?: string;
}

const CG_PATHS = process.platform === "win32"
  ? [
      "codegraph.cmd",
      "codegraph",
      `${process.env.APPDATA}\\npm\\codegraph.cmd`,
    ]
  : [
      "codegraph",
      "/usr/local/bin/codegraph",
      "/opt/homebrew/bin/codegraph",
    ];

// codegraph 是 node 脚本，执行时 env 需在 PATH 找到 node（同 npx）。
const EXTRA_PATH = process.platform === "win32"
  ? [`${process.env.ProgramFiles}\\nodejs`, `${process.env.APPDATA}\\npm`]
  : ["/opt/homebrew/bin", "/usr/local/bin"];
const SEP = process.platform === "win32" ? ";" : ":";
const ENV = { ...process.env, PATH: `${EXTRA_PATH.join(SEP)}${SEP}${process.env.PATH}` };

export function detectCodegraph(): DetectResult {
  for (const p of CG_PATHS) {
    try {
      if (fs.existsSync(p) || p === "codegraph" || p === "codegraph.cmd") {
        const version = execSync(`"${p}" --version`, { encoding: "utf-8", timeout: 5000, env: ENV }).trim();
        return { found: true, version };
      }
    } catch { /* try next */ }
  }
  return { found: false };
}
