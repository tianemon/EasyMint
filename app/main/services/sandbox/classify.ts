/**
 * 沙盒域分类（判定器边界原则）——命令静态判定「判不了」的类型。
 *
 * 原则：能静态判定安全的走权限系统；
 * 判不了行为半径的（下载即执行/内联代码/变量展开路径）→ 沙盒运行时兜底。
 * 第一波只覆盖三类，其余维持现有判定（范围控制）。
 */

export type SandboxKind = "network" | "inline" | "unresolvable";

/** 出网命令前缀（curl/wget + PowerShell 的 iwr/Invoke-WebRequest 等——下载/API/探测） */
const NETWORK_RE = /(?:^|\s|\||;|&&)(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)(?:\s|$)/;

/** 内联代码执行（node -e / python -c / bash -c…——代码行为不可静态判全） */
const INLINE_RE = /\b(?:node|nodejs|python|python3|ruby|perl|php|bash|sh|zsh|dash|ksh)\s+-(?:e|c)\b/;

/** PowerShell 内联/间接执行（iex / Invoke-Expression——与 node -e 同类，代码行为不可静态判全） */
const PS_INLINE_RE = /\b(?:iex|invoke-expression)\b/;

/** 管道给解释器执行（curl … | bash——下载内容的行为不可静态判定） */
const PIPE_TO_INTERPRETER_RE = /\|\s*(?:bash|sh|zsh|dash|ksh|python3?|node|perl|ruby|php|iex|invoke-expression)\b/;

/**
 * 判定命令是否落入「判不了」沙盒域。null = 可判定域（走权限系统现有逻辑）。
 */
export function classifyForSandbox(cmd: string): SandboxKind | null {
  const trimmed = cmd.trim();
  if (!trimmed) return null;
  const c = trimmed.toLowerCase();

  // 1. 出网 curl/wget：单独执行放行（下载/调 API 是正常需求，2026-09-08 放宽命令名单）；
  //    仅「下载即执行」（curl … | bash）保留沙盒兜底——下载内容的行为半径不可静态判定
  if (NETWORK_RE.test(c)) {
    return PIPE_TO_INTERPRETER_RE.test(c) ? "network" : null;
  }
  // 2. 内联代码执行（含 PowerShell 的 iex / Invoke-Expression）
  if (INLINE_RE.test(c) || PS_INLINE_RE.test(c)) return "inline";
  // 3. 变量/命令替换——路径无法静态解析（extractPaths 返回 null）时行为半径不可知。
  //    由调用方在 extractPathsFromCommand 返回 null 时归入本域（需同时具备写/读不确定性，
  //    纯 `echo $HOME` 等不含路径语义的低危命令在调用方放行——见 permission 接线注释）
  return null;
}

/** 命令是否含变量/命令替换（extractPaths 不可解析的信号）——供调用方与 extractPaths 结果配合 */
export function hasUnresolvableExpansion(cmd: string): boolean {
  return /\$\(/.test(cmd) || /`/.test(cmd) || /\$\{?[A-Za-z_]/.test(cmd);
}
