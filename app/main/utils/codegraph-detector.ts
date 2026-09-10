import { spawnSync } from "child_process";
import fs from "fs";

export interface DetectResult {
  found: boolean;
  version?: string;
  /** found=false 时的两态：not-found 真的没装 / probe-error 装了但启不来——界面文案与引导不同 */
  reason?: "not-found" | "probe-error";
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

/** 单个候选探测结果：ok=false 只表示「这个候选没拿到版本号」，
 *  至于是「没装」还是「装了但启不来」由调用方按候选类型判定 */
type ProbeOutcome = { ok: true; version: string } | { ok: false };

/** 读版本号。Windows 下 codegraph 的入口只可能是 .cmd（npm 全局 shim，或 PowerShell 安装包的
 *  bin\codegraph.cmd），而 Node 自 2024-04（CVE-2024-27980）起对「无 shell 直启 .cmd」直接报
 *  EINVAL——直启会让「已安装」被判成未安装（v0.6.6 起的 Windows 误报根因）。
 *  改走 cmd.exe /c，命令行整串包引号交给 /c（同 Node exec：/s 剥最外层引号，内层引号保住含空格的
 *  路径），并置 windowsVerbatimArguments 避免 Node 二次加引号；不用 shell:true 是因为传 args 会
 *  触发 DEP0190 弃用警告。stdio:pipe 保留静默——未安装时 cmd 的 GBK 提示只进管道，不刷控制台。 */
function probe(p: string): ProbeOutcome {
  try {
    const r = process.platform === "win32"
      ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${p}" --version"`], {
          ...SPAWN_OPTS,
          windowsVerbatimArguments: true,
        })
      : spawnSync(p, ["--version"], SPAWN_OPTS);
    if (r.status === 0 && r.stdout) return { ok: true, version: r.stdout.trim() };
    // 失败留痕：静默会把「装了但启不来」和「没装」压成同一个结论——
    // 那正是这个误报潜伏 v0.6.6→v0.23.1 的原因
    const errCode = (r.error as NodeJS.ErrnoException | undefined)?.code;
    console.warn(`[codegraph-detector] 探测失败 path=${p} reason=${errCode ?? `exit ${r.status}`}`);
    return { ok: false };
  } catch (e) {
    // spawnSync 自身抛错（极少数：参数/资源异常）——归入「检测失败」并留痕，不留空 catch
    console.warn(`[codegraph-detector] spawn 异常 path=${p}`, e);
    return { ok: false };
  }
}

export function detectCodegraph(): DetectResult {
  // 绝对路径候选真实存在却拿不到版本号 = 装了但启不来（界面给「检测失败 + 重试」，不误报未安装）
  let installedButFailed = false;
  for (const p of CG_PATHS) {
    // 绝对路径候选必须真实存在才尝试；裸命令名交给 PATH 解析（装没装由执行结果判定）
    const isAbsolute = p.includes("\\") || p.includes("/");
    if (isAbsolute && !fs.existsSync(p)) continue;
    const out = probe(p);
    if (out.ok) return { found: true, version: out.version };
    if (isAbsolute) installedButFailed = true;
  }
  return installedButFailed
    ? { found: false, reason: "probe-error" }
    : { found: false, reason: "not-found" };
}
