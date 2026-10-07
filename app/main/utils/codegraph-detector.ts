import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { codegraphCandidates, codegraphEnvironment, codegraphInvocation } from "./codegraph-command";

export interface DetectResult {
  found: boolean;
  version?: string;
  /** found=false 时的两态：not-found 真的没装 / probe-error 装了但启不来——界面文案与引导不同 */
  reason?: "not-found" | "probe-error";
}

const SPAWN_OPTS = {
  encoding: "utf-8" as const,
  timeout: 5000,
  stdio: "pipe" as const,
  windowsHide: true,
};

/** 单个候选探测结果：ok=false 只表示「这个候选没拿到版本号」，
 *  至于是「没装」还是「装了但启不来」由调用方按候选类型判定 */
type ProbeOutcome = { ok: true; version: string } | { ok: false };

/** Standalone bundles run through their vendored node.exe. Remaining batch shims must
 * go through cmd.exe; spawning .cmd directly fails with EINVAL on current Node versions.
 * /s strips the outer quotes, preserving the inner quotes around paths with spaces. */
function probe(p: string, env: NodeJS.ProcessEnv): ProbeOutcome {
  try {
    const invocation = codegraphInvocation(p, ["--version"], env);
    const opts = { ...SPAWN_OPTS, env };
    const r = process.platform === "win32" && /\.(cmd|bat)$/i.test(invocation.command)
      ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${invocation.command}" --version"`], {
          ...opts,
          windowsVerbatimArguments: true,
        })
      : spawnSync(invocation.command, invocation.args, opts);
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
  const env = codegraphEnvironment();
  for (const key of ["NODE_OPTIONS", "ELECTRON_RUN_AS_NODE", "NODE_ENV"]) delete env[key];
  // 绝对路径候选真实存在却拿不到版本号 = 装了但启不来（界面给「检测失败 + 重试」，不误报未安装）
  let installedButFailed = false;
  for (const p of codegraphCandidates(env)) {
    // 绝对路径候选必须真实存在才尝试；裸命令名交给 PATH 解析（装没装由执行结果判定）
    const isAbsolute = p.includes("\\") || p.includes("/");
    if (isAbsolute && !fs.existsSync(p)) continue;
    const out = probe(p, env);
    if (out.ok) return { found: true, version: out.version };
    if (isAbsolute) installedButFailed = true;
  }
  return installedButFailed
    ? { found: false, reason: "probe-error" }
    : { found: false, reason: "not-found" };
}
