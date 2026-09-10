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
      // PowerShell 安装器(irm … | iex)装到 %LOCALAPPDATA%\codegraph\current\bin，
      // 绝对路径候选让「装完没重启 EM、进程 PATH 快照还是旧的」也能检测到
      `${process.env.LOCALAPPDATA}\\codegraph\\current\\bin\\codegraph.cmd`,
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

const SPAWN_OPTS = {
  encoding: "utf-8" as const,
  timeout: 5000,
  env: ENV,
  stdio: "pipe" as const,
  windowsHide: true,
};

/** 读版本号。Windows 下 codegraph 的入口只可能是 .cmd（npm 全局 shim，或 PowerShell 安装包的
 *  bin\codegraph.cmd），而 Node 自 2024-04（CVE-2024-27980）起对「无 shell 直启 .cmd」直接报
 *  EINVAL——直启会让「已安装」被判成未安装（v0.6.6 起的 Windows 误报根因）。
 *  改走 cmd.exe /c，命令行自己拼好并置 windowsVerbatimArguments（对齐 cross-spawn 的做法，
 *  避免 /s 吃掉路径引号）；不用 shell:true 是因为传 args 会触发 DEP0190 弃用警告。
 *  stdio:pipe 保留静默——未安装时 cmd 的 GBK 提示只进管道，不再刷控制台成乱码。 */
function readVersion(p: string): string | null {
  const r = process.platform === "win32"
    // 命令行整体再包一层引号（对齐 Node exec / cross-spawn）：/s 会剥掉最外层引号，
    // 内层引号保住含空格的路径（如自定义 CODEGRAPH_INSTALL_DIR 下的 codegraph.cmd）
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${p}" --version"`], {
        ...SPAWN_OPTS,
        windowsVerbatimArguments: true,
      })
    : spawnSync(p, ["--version"], SPAWN_OPTS);
  return r.status === 0 && r.stdout ? r.stdout.trim() : null;
}

export function detectCodegraph(): DetectResult {
  for (const p of CG_PATHS) {
    try {
      if (fs.existsSync(p) || p === "codegraph" || p === "codegraph.cmd") {
        const version = readVersion(p);
        if (version) return { found: true, version };
      }
    } catch { /* try next */ }
  }
  return { found: false };
}
