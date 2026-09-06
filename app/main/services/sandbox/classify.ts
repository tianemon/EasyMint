/**
 * 沙盒域分类（判定器边界原则）——命令静态判定「判不了」的类型。
 *
 * 原则（docs/design/沙盒执行方案.md 二）：能静态判定安全的走权限系统；
 * 判不了行为半径的（下载内容/内联代码/变量展开路径）→ 沙盒运行时兜底。
 * 第一波只覆盖三类，其余维持现有判定（范围控制，第二波见设计文档五）。
 */

import { CURL_WRITE_PARAM_RE } from "../permission/permission-rules";

export type SandboxKind = "network" | "inline" | "unresolvable";

/** 出网命令前缀（curl/wget——下载/API/探测，内容与目标不可静态判定） */
const NETWORK_RE = /(?:^|\s|\||;|&&)(?:curl|wget)(?:\s|$)/;

/** 内联代码执行（node -e / python -c / bash -c…——代码行为不可静态判全） */
const INLINE_RE = /\b(?:node|nodejs|python|python3|ruby|perl|php|bash|sh|zsh|dash|ksh)\s+-(?:e|c)\b/;

/** 管道/命令链接（下载即执行链 curl|bash 等） */
const CHAIN_RE = /[|;&]/;

/**
 * 回环例外：curl 目标仅为本机回环（localhost/127.0.0.1）且无文件写参、无管道链接——
 * 静态可判为「访问本机自己起的服务」（本地 IPC 非网络外联），不进沙盒（设计文档 D2 修订）。
 */
function isLoopbackOnly(cmd: string): boolean {
  const c = cmd.trim().toLowerCase();
  if (!/\b(?:localhost|127\.0\.0\.1)\b/.test(c)) return false;
  if (CURL_WRITE_PARAM_RE.test(c)) return false;
  if (CHAIN_RE.test(c)) return false;
  // 目标 URL 只含回环主机（无第二个 URL/目标）——粗略判定：除回环外无 http(s):// 目标
  const urls = c.match(/https?:\/\/[^\s"']+/g) || [];
  return urls.every((u) => /\b(?:localhost|127\.0\.0\.1)\b/.test(u));
}

/**
 * 判定命令是否落入「判不了」沙盒域。null = 可判定域（走权限系统现有逻辑）。
 */
export function classifyForSandbox(cmd: string): SandboxKind | null {
  const trimmed = cmd.trim();
  if (!trimmed) return null;
  const c = trimmed.toLowerCase();

  // 1. 出网 curl/wget：回环纯读例外直跑；其余（下载到文件/管道执行/API）进沙盒
  if (NETWORK_RE.test(c)) {
    return isLoopbackOnly(trimmed) ? null : "network";
  }
  // 2. 内联代码执行
  if (INLINE_RE.test(c)) return "inline";
  // 3. 变量/命令替换——路径无法静态解析（extractPaths 返回 null）时行为半径不可知。
  //    由调用方在 extractPathsFromCommand 返回 null 时归入本域（需同时具备写/读不确定性，
  //    纯 `echo $HOME` 等不含路径语义的低危命令在调用方放行——见 permission 接线注释）
  return null;
}

/** 命令是否含变量/命令替换（extractPaths 不可解析的信号）——供调用方与 extractPaths 结果配合 */
export function hasUnresolvableExpansion(cmd: string): boolean {
  return /\$\(/.test(cmd) || /`/.test(cmd) || /\$\{?[A-Za-z_]/.test(cmd);
}
