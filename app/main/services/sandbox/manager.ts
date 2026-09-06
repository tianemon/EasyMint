/**
 * sandbox-manager — srt（@anthropic-ai/sandbox-runtime）单例封装。
 *
 * - 懒加载：首次需要时 initialize（起代理 + 平台探测）；失败记不可用原因，
 *   权限层对「判不了」命令按 fail-closed 退回拒绝（沙盒不可用不静默放行）。
 * - 规则单一来源：filesystem denyRead 从 EM 凭据/用户目录禁区常量生成（见 buildSandboxConfig）。
 * - srt 是 ESM-only 包，Electron 主进程 CJS 用动态 import 加载（对齐 pi-sdk wrapper 模式）。
 */

import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  SECRET_FORBIDDEN,
  USER_FORBIDDEN_WRITE,
} from "../permission/permission-rules";

/** Linux 沙盒系统依赖（EM 不代做系统安装——缺失时给安装指引，装好前自动降级） */
const LINUX_SANDBOX_DEPS = ["bwrap", "socat", "rg"] as const;

type SrtModule = typeof import("@anthropic-ai/sandbox-runtime");

let _srt: SrtModule | null = null;
let _state: "untouched" | "ok" | "failed" = "untouched";
let _failReason = "";

async function getSrt(): Promise<SrtModule> {
  if (!_srt) _srt = await import("@anthropic-ai/sandbox-runtime");
  return _srt;
}

export function isSandboxAvailable(): boolean {
  return _state === "ok";
}

export function sandboxUnavailableReason(): string {
  return _failReason;
}

/** 展开 ~ 前缀为绝对路径（srt 支持 ~，但展开后与 EM 常量语义一致、少一层解析） */
function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return path.join(homedir(), p.slice(2));
  return p;
}

/**
 * srt filesystem 规则（写 allow-only / 读 deny-then-allow）：
 * - denyRead：凭据目录 + 用户文档目录（防沙盒内命令读私密文件外传）；
 *   系统目录不禁读（沙盒内进程需读系统库/可执行文件才能运行）
 * - allowRead：deny 区域内重放行工作区（cwd 建在用户目录内时开发不受阻）
 * - allowWrite：仅工作区
 * 网络（实测修正 2026-09-06）：srt 的 allowedDomains 语义 = 域名限制档——mac/Windows 运行时模式
 *   下需宿主自带 HTTP/SOCKS 代理（Claude Code 集成层有，EM 无）才放行，配置即全 deny（出网也死）。
 *   用空对象 network:{} → 不触发限制档 → macOS seatbelt `allow network*` 出网放行；
 *   回环出站/bind 仍被隔离（allowLocalBinding=false 的 deny 规则独立生效，实测 curl/node 连 127.0.0.1 均 deny）。
 *   Linux 有 srt 内置 bridge（initializeLinuxNetworkBridge）保留 allowedDomains 档；Windows 待实测。
 */
export function buildSandboxConfig(cwd: string): SandboxRuntimeConfig {
  const denyRead = [
    ...SECRET_FORBIDDEN,
    ...USER_FORBIDDEN_WRITE.filter((p) => !p.includes("%")), // Windows 占位符形态 macOS/Linux 无效
  ].map(expandHome);
  // denyRead 内重放行工作区（如项目建在 ~/Documents 下）
  const allowRead = [cwd];
  return {
    // darwin：allowedDomains 置 undefined 使 srt hasNetworkConfig=false（类型必填，运行时判 undefined）——见头注释
    network: (process.platform === "darwin"
      ? { allowedDomains: undefined, deniedDomains: [] }
      : { allowedDomains: ["*"], deniedDomains: [] }) as unknown as SandboxRuntimeConfig["network"],
    filesystem: {
      denyRead,
      allowRead,
      allowWrite: [cwd],
      denyWrite: [],
    },
  };
}

export interface SandboxInitResult {
  ok: boolean;
  reason?: string;
}

/**
 * 平台化失败原因（区分「缺什么、怎么补」——EM 不代做系统级安装，只给指引）。
 * - Linux：系统包 bwrap/socat/rg 缺失（deb 安装的 EM 由 apt 依赖自动装；AppImage 需手动）或 userns 内核限制
 * - Windows：srt-sandbox 账户/WFP 未安装（需一次性管理员安装，弹 UAC）
 * - macOS：原样返回（无系统依赖，问题属内部错误）
 */
async function platformFailureReason(e: Error): Promise<string | null> {
  if (process.platform === "linux") {
    const missing = LINUX_SANDBOX_DEPS.filter((bin) => {
      try {
        return spawnSync("which", [bin], { stdio: "ignore" }).status !== 0;
      } catch {
        return true;
      }
    });
    if (missing.length > 0) {
      return `沙盒依赖缺失：${missing.join("、")}。请安装后重试（Debian/Ubuntu: sudo apt install bubblewrap socat ripgrep；安装后重启 EasyMint；装好前网络类命令需切「完全访问」）`;
    }
    return `沙盒初始化失败（可能是内核 userns 限制，Ubuntu 24.04+ 需允许 unprivileged userns）：${e.message}`;
  }
  if (process.platform === "win32") {
    try {
      const srt = await getSrt();
      const st = await srt.checkWindowsSandboxStatusAsync();
      const userOk = String(st?.user ?? "").includes("installed");
      if (!userOk) {
        return `Windows 沙盒组件未安装（需一次性管理员安装，将弹出 UAC 授权）——安装指引见文档；装好前网络类命令需切「完全访问」`;
      }
    } catch { /* 状态探测失败按通用错误处理 */ }
    return `Windows 沙盒初始化失败（可能是 WFP 过滤未生效）：${e.message}`;
  }
  return null; // macOS 无系统依赖，原样报错
}

/**
 * Windows 专属配置注入：srt 要求显式指定 srt-win.exe 路径（vendor 随包分发，
 * asarUnpack 后路径仍有效）。VENDORED_SRT_WIN_EXE 是 srt 导出的包内常量。
 */
async function applyWindowsConfig(cfg: SandboxRuntimeConfig): Promise<SandboxRuntimeConfig> {
  if (process.platform !== "win32") return cfg;
  try {
    const srt = await getSrt();
    return { ...cfg, windows: { srtWin: { path: srt.VENDORED_SRT_WIN_EXE } } };
  } catch (e) {
    console.warn("[sandbox] srt-win 路径注入失败:", (e as Error).message);
    return cfg;
  }
}

/** 懒加载初始化（幂等）。失败原因保留供权限层 fail-closed 拒绝时展示。 */
export async function ensureSandbox(cwd: string): Promise<SandboxInitResult> {
  if (_state === "ok") return { ok: true };
  if (_state === "failed") return { ok: false, reason: _failReason };
  try {
    const srt = await getSrt();
    await srt.SandboxManager.initialize(await applyWindowsConfig(buildSandboxConfig(cwd)));
    _state = "ok";
    return { ok: true };
  } catch (e) {
    _state = "failed";
    const platformHint = await platformFailureReason(e as Error);
    _failReason = platformHint ?? (e as Error).message;
    // 初始化失败诊断（Electron 环境与终端 node 差异定位用——stack + 环境探针）
    const cfg = buildSandboxConfig(cwd);
    console.error("[sandbox] initialize 失败:", {
      message: (e as Error).message,
      stack: (e as Error).stack,
      cwd,
      tmpdirEnv: process.env.TMPDIR ?? "(未设置)",
      homeEnv: process.env.HOME ?? "(未设置)",
      osTmpdir: require("node:os").tmpdir(),
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron ?? "(非 electron)",
      allowWrite: cfg.filesystem?.allowWrite,
      denyReadSample: (cfg.filesystem?.denyRead ?? []).slice(0, 3),
    });
    return { ok: false, reason: _failReason };
  }
}

/** 沙盒执行规格——执行层按 kind 选择 spawn 方式 */
export type SandboxSpawnSpec =
  /** darwin/linux：wrapWithSandbox 返回 shell 字符串，走 resolveSpawn 原路径（shell:true / Git Bash -c） */
  | { kind: "shell"; command: string }
  /** win32：srt 不支持 shell 字符串包装（srt-win 两跳），必须 argv + shell:false + 注入 env */
  | { kind: "argv"; argv: string[]; env: NodeJS.ProcessEnv };

/**
 * 包装命令为沙盒执行规格（调用前须 ensureSandbox ok；失败抛错由调用方转报错文本）。
 * Windows 分支：wrapWithSandboxArgv + Git Bash 绝对路径（EM Windows bash 统一走 Git Bash，
 * 与 resolveSpawn 的 findBashOnWindows 一致——gitBashPath 由调用方传入避免重复探测）。
 */
export async function wrapForSandbox(command: string, opts?: { gitBashPath?: string }): Promise<SandboxSpawnSpec> {
  const srt = await getSrt();
  if (process.platform === "win32") {
    const exe = opts?.gitBashPath;
    if (!exe) throw new Error("Windows 沙盒需要 Git Bash 绝对路径（gitBashPath）");
    const wrapped = await srt.SandboxManager.wrapWithSandboxArgv(command, { exe, args: ["-c"] });
    return { kind: "argv", argv: wrapped.argv, env: wrapped.env };
  }
  return { kind: "shell", command: await srt.SandboxManager.wrapWithSandbox(command) };
}

/** 违规归因：把沙盒拦截事件注解进 stderr（Operation not permitted → 大白话违规说明） */
export function annotateSandboxFailures(wrappedCommand: string, stderr: string): string {
  try {
    const srt = _srt ?? null;
    if (!srt) return stderr;
    return srt.SandboxManager.annotateStderrWithSandboxFailures(wrappedCommand, stderr);
  } catch {
    return stderr; // 注解失败不吞原 stderr
  }
}

/** 仅供测试/重置（会话切换 cwd 变化时沙盒规则理论上应重建——srt 单进程单配置，cwd 用首个工作区） */
export function resetSandboxForTest(): void {
  _state = "untouched";
  _failReason = "";
}
