import { spawnSync } from "child_process";
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
        // 用 spawnSync 直接执行(不走 cmd shell)——execSync 在 win 上找不到命令时
        // cmd.exe 输出 GBK 报错("不是内部或外部命令")透传到控制台成乱码
        const r = spawnSync(p, ["--version"], {
          encoding: "utf-8", timeout: 5000, env: ENV,
          stdio: "pipe", windowsHide: true,
        });
        if (r.status === 0 && r.stdout) {
          return { found: true, version: r.stdout.trim() };
        }
      }
    } catch { /* try next */ }
  }
  return { found: false };
}
