/**
 * system-protection manager — 基于 srt（@anthropic-ai/sandbox-runtime）的底层系统保护。
 *
 * - 懒加载：首次需要时 initialize（起代理 + 平台探测）；失败记不可用原因，
 *   权限层对「判不了」命令按 fail-closed 退回拒绝（沙盒不可用不静默放行）。
 * - 规则单一来源：两模式均由 access-policy 编译，每次执行传入工作区与模式。
 * - srt 是 ESM-only 包，Electron 主进程 CJS 用动态 import 加载（对齐 pi-sdk wrapper 模式）。
 */

import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { buildExecutionPolicy, type PermissionMode } from "../permission/access-policy";
import { createExecutionContext, type ExecutionContext } from "../permission/execution-context";
import { wrapWithWindowsWorker } from "./windows-execution-manager";
import { srtWinPath, srtWinSpawn } from "./srt-win";
import { isSandboxExcludedCommand } from "./compat-policy";

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

/** Linux 沙盒缺失的系统依赖（bwrap/socat/rg 缺任一，srt 都无法初始化） */
export function missingLinuxSandboxDeps(): string[] {
  if (process.platform !== "linux") return [];
  return LINUX_SANDBOX_DEPS.filter((bin) => {
    try {
      return spawnSync("which", [bin], { stdio: "ignore" }).status !== 0;
    } catch {
      return true;
    }
  });
}

/**
 * 「是否关闭了沙盒运行」的读取器——由主进程启动时接线（读设置文件）。
 * 用注入的读取函数而不是缓存字段，避免设置改了、缓存没同步这类不一致。
 */
let _sandboxDisabledProvider: () => boolean = () => false;

export function setSandboxDisabledProvider(fn: () => boolean): void {
  _sandboxDisabledProvider = fn;
}

/**
 * Linux 兜底通道：系统依赖装不上时允许关掉沙盒运行。
 * 用户政策：**优先引导安装依赖**，实在装不了才走这里（见设置页「环境检测」）。
 * 仅 Linux 生效——macOS 用系统 Seatbelt（无外部依赖），Windows 走 srt-sandbox 账户（另有一次性安装）。
 * 关闭后仅保留结构化工具的路径检查与已知系统命令预检；任意 shell/解释器 I/O 不再有强制边界。
 */
export function isSandboxBypassed(): boolean {
  return process.platform === "linux" && _sandboxDisabledProvider();
}

/**
 * 该模式是否套 OS 沙盒（2026-09-17 三档定案：**只读 / 标准 / 完全访问**）。
 *
 * - `readonly` 只读模式：**主强制不是沙盒，而是"整个执行面被移除"**——判定层拒绝一切
 *   执行/写入/联网工具（见 agent-permission-service 的 readonlyDenyReason），所以没有进程可沙盒。
 *   这里仍返回 true 作**纵深防御**：万一将来有工具从拒绝表漏过，它照样在盒子里跑。
 * - `standard` 标准模式（默认）：**套沙盒**（甲方案，2026-09-17 用户拍板）。
 *   它**不是单独成立的**：必须配 ① 兼容性豁免清单（PTY 等，compat-policy）、② 精确豁免
 *   （浏览器/容器这类自建沙盒的命令）、③ 网络白名单。三者缺一，这一档就会退回历史上那个
 *   "什么都做不了"的形态——那正是用户最初的痛点。
 * - `full` 完全访问：永不套沙盒（不需要内核边界，见本文件底部历史背景）。
 *
 * 需要"不套沙盒"时只有两条路径：**完全访问**（用户显式选择），或 Linux 的「关闭沙盒运行」
 * 设置项（系统依赖装不上时的降级，见 isSandboxBypassed）。早期那个 `EASYMINT_SANDBOX_ENABLED`
 * 应急开关已随本次定案废弃——它的语义（"把标准档切进沙盒"）现在就是默认行为。
 */
export function isSandboxEnabledForMode(mode: PermissionMode = "standard"): boolean {
  if (mode === "full") return false;
  return true;
}

/**
 * 该权限模式下是否跳过 OS 沙盒。
 *
 * **完全访问永远跳过**；`readonly` **不受 Linux 全局开关影响**——那个开关的语义是
 * "沙盒运行不可用时的降级通道"（bwrap/userns 装不上），而只读档的主承诺是"不执行任何命令"
 * （由判定层保证），沙盒只是纵深。让一个环境降级开关去覆盖另一档的产品承诺，属于名实不符。
 */
export function isSandboxBypassedForMode(mode?: PermissionMode): boolean {
  const effective: PermissionMode = mode ?? "standard";
  if (effective === "readonly") return !isSandboxEnabledForMode("readonly");
  return isSandboxBypassed() || !isSandboxEnabledForMode(effective);
}

/**
 * srt filesystem 规则（写 allow-only / 读 deny-then-allow）：
 * - 两模式都禁止直接读取高度敏感凭据、禁止修改系统核心与安全控制面；
 * - 标准模式可写工作区与正式开发资源，完全访问可写其余普通位置；
 * - 工作区不能覆盖核心 deny。
 * 网络：srt 在宿主进程内启动 HTTP/SOCKS mux 代理，沙盒只允许连接该回环端口，代理再按
 * allowedDomains 判定目标。代理依赖宿主 Node 事件循环持续运行，因此真实集成测试必须异步 spawn；
 * 用 spawnSync 会阻塞代理并制造“白名单域也超时”的假故障。
 */
export function buildSandboxConfig(cwd: string, mode: PermissionMode = "standard"): SandboxRuntimeConfig {
  return buildExecutionPolicy(createExecutionContext(cwd, mode));
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
    const missing = missingLinuxSandboxDeps();
    if (missing.length > 0) {
      // 三发行版命令 + 指向设置页「重新检测」（不必重启）与兜底开关
      return `系统保护组件缺失：${missing.join("、")}。装好后到「设置 → 环境检测」点「重新检测」即可生效——`
        + `Debian/Ubuntu: sudo apt install bubblewrap socat ripgrep；`
        + `Fedora/RHEL: sudo dnf install bubblewrap socat ripgrep；`
        + `Arch: sudo pacman -S bubblewrap socat ripgrep。`
        + `实在装不了可在同一处关闭沙盒运行（不推荐）`;
    }
    // 官方做法是给 bwrap 加载 AppArmor profile，而不是全局关掉 userns 限制
    //（deb 安装时由 build/linux-after-install.sh 自动落；其余安装形态到「设置 → 环境检测」看指引）
    return `沙盒初始化失败（Ubuntu 24.04 起默认禁止 bwrap 创建普通用户命名空间，需加载 AppArmor profile；`
      + `用 deb 安装时已自动处理，仍失败请到「设置 → 环境检测」按指引执行一次）：${e.message}`;
  }
  if (process.platform === "win32") {
    try {
      const srt = await getSrt();
      const st = await srt.checkWindowsSandboxStatusAsync({ srtWin: srtWinSpawn(srt) });
      const userOk = Boolean(st?.user?.provisioned && st.user.credPresent);
      if (!userOk) {
        return `Windows 系统保护组件未安装（需一次性管理员安装，将弹出 UAC 授权）——安装指引见文档`;
      }
    } catch (e) { /* 状态探测失败按通用错误处理——但要留痕，静默过一次（spawn_failed 被吞） */
      console.warn("[sandbox] Windows 状态探测失败:", (e as Error).message);
    }
    return `Windows 沙盒初始化失败（可能是 WFP 过滤未生效）：${e.message}`;
  }
  return null; // macOS 无系统依赖，原样报错
}

/**
 * Windows 专属配置注入：srt 要求显式指定 srt-win.exe 路径（vendor 随包分发，
 * asarUnpack 后文件在 asar 外）。VENDORED_SRT_WIN_EXE 是 srt 导出的包内常量，
 * 但打包后它指向 `app.asar` 内——config 里这一串最终也是交给 spawn 的，
 * 必须过 `srtWinPath()` 改写到 `.asar.unpacked`（原因见 srt-win.ts 文件头）。
 */
async function applyWindowsConfig(cfg: SandboxRuntimeConfig): Promise<SandboxRuntimeConfig> {
  if (process.platform !== "win32") return cfg;
  try {
    const srt = await getSrt();
    return { ...cfg, windows: { srtWin: { path: srtWinPath(srt) } } };
  } catch (e) {
    console.warn("[sandbox] srt-win 路径注入失败:", (e as Error).message);
    return cfg;
  }
}

/** 懒加载初始化（幂等）。失败原因保留供权限层 fail-closed 拒绝时展示。
 *  该模式跳过沙盒时（完全访问 / Linux 全局降级）直接返回 ok——那条路径根本不进沙盒，
 *  见 isSandboxBypassedForMode。标准与只读档**默认就会走到真正的初始化**。 */
export async function ensureSandbox(cwd: string, mode?: PermissionMode): Promise<SandboxInitResult> {
  if (isSandboxBypassedForMode(mode)) return { ok: true };
  if (_state === "ok") return { ok: true };
  if (_state === "failed") return { ok: false, reason: _failReason };
  try {
    const srt = await getSrt();
    // srt-win 的文件允许项在 initialize 时写入 ACL。初始化必须在按会话隔离的
    // worker 内完成，主进程这里只检查系统组件，绝不能初始化共享实例。
    if (process.platform === "win32") {
      const status = await srt.checkWindowsSandboxStatusAsync({ srtWin: srtWinSpawn(srt) });
      if (!status.user.provisioned || !status.user.credPresent) {
        throw new Error("Windows 系统保护组件未安装");
      }
      _state = "ok";
      return { ok: true };
    }
    // 第三个参数 enableLogMonitor **必须为 true**：macOS 的违规事件靠常驻 `log stream`
    // 收集（见 macos-sandbox-utils 的 startMacOSSandboxLogMonitor）。不开的话
    // sandboxViolationStore 永远为空 → annotateStderrWithSandboxFailures 拿到空数组直接返回
    // 原文 → **沙盒拦截对用户与模型完全静默**（历史现象："命令莫名失败、不知道为什么"）。
    // 它同时也是兼容性清单的腐化探测器：没有它，清单失效只能表现为莫名其妙的失败。
    await srt.SandboxManager.initialize(await applyWindowsConfig(buildSandboxConfig(cwd)), undefined, true);
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
  | { kind: "shell"; command: string; env: NodeJS.ProcessEnv; release?: () => Promise<void>; violationKey?: string; exemptReason?: string }
  /** win32：srt 不支持 shell 字符串包装（srt-win 两跳），必须 argv + shell:false + 注入 env */
  | { kind: "argv"; argv: string[]; env: NodeJS.ProcessEnv; release?: () => Promise<void>; violationKey?: string; exemptReason?: string };

/**
 * 沙盒命令的收尾租约：**每条沙盒命令结束后必须恰好调一次**（执行层在 exit/error 处调 spec.release()）。
 *
 * 为什么需要：Linux 上 bwrap 为「不存在的受保护路径」做 --ro-bind 时，会在宿主创建空文件当挂载点
 * （srt 源码注释原话："bwrap creates empty files on the host filesystem as mount points. These
 * persist after bwrap exits"）。不清理的话，工作区会凭空出现 0 字节的 .mcp.json，home 里也可能出现
 * 空 .bashrc/.gitconfig（srt 称之为 ghost dotfiles）——用户会看到莫名其妙的新文件，空的 .mcp.json
 * 还可能让下次读取直接解析失败。
 *
 * srt 为此提供了 SandboxManager.cleanupAfterCommand()（其文档写明 "Lightweight cleanup to call after
 * each sandboxed command completes"）。EM 的四条执行路径（前台 bash / 后台 shell / shell:exec /
 * install_dependency）本来就都在命令结束时调 spec.release()，但此前没人在 wrapForSandbox 里给它赋值
 * → 整条清理链路空转（Linux 上会持续留占位文件，只有进程退出时 srt 的兜底才清一次）。
 *
 * **为什么必须幂等**：srt 用 activeSandboxCount 计数决定「是否推迟删除」（还有沙盒在跑就不删）。
 * 同一租约被调两次会把别的沙盒的计数减掉，可能导致正在运行的沙盒的挂载点被提前删除——那条命令的
 * deny 规则随之失效（受保护路径在它里面变成可写）。这是安全问题，不只是清理问题。
 * 删除本身是保守的：srt 只删「仍是 0 字节的文件」与「空目录」，有真实内容的一律保留。
 */
function createOnceLease(run: () => void): () => Promise<void> {
  let released = false;
  return () => {
    if (!released) {
      released = true;
      try {
        run();
      } catch {
        // 清理失败不影响命令结果：占位文件残留只是脏，不该让命令报错
      }
    }
    return Promise.resolve();
  };
}

function createSandboxLease(): () => Promise<void> {
  return createOnceLease(() => { _srt?.SandboxManager.cleanupAfterCommand(); });
}

export const sandboxLeaseInternals = { createOnceLease };

/**
 * 包装命令为沙盒执行规格（调用前须 ensureSandbox ok；失败抛错由调用方转报错文本）。
 * Windows 分支：wrapWithSandboxArgv + Git Bash 绝对路径（EM Windows bash 统一走 Git Bash，
 * 与 resolveSpawn 的 findBashOnWindows 一致——gitBashPath 由调用方传入避免重复探测）。
 *
 * 两条**不进沙盒**的分支，语义不同、不要合并：
 * - 模式本就跳过（完全访问 / Linux 全局降级）→ `nativeSpawnSpec`
 * - **精确豁免**（浏览器 / 容器这类必须自建沙盒的命令，见 compat-policy）→ 同样原生执行，
 *   但把 `exemptReason` 带出去让调用方呈现为"例外"而不是静默放行——**清单腐化的反义词就是例外可见**
 */
export async function wrapForSandbox(
  command: string,
  opts: { context: ExecutionContext; gitBashPath?: string; windowsShell?: "bash" | "powershell" },
): Promise<SandboxSpawnSpec> {
  if (isSandboxBypassedForMode(opts.context.mode)) return nativeSpawnSpec(command, opts);
  if (isSandboxExcludedCommand(command)) {
    return {
      ...nativeSpawnSpec(command, opts),
      exemptReason: "该命令需要自建沙盒（浏览器 / 容器），无法在系统沙盒内运行，已在沙盒外执行",
    };
  }
  const srt = await getSrt();
  const context = opts.context;
  if (process.platform === "win32") {
    const wrapped = await wrapWithWindowsWorker(command, context, opts.gitBashPath, opts.windowsShell);
    // Windows 的 commandId 由 worker 侧的 leaseId 决定，必须用它（不能用本地另生成的 key，
    // 否则违规注解匹配不上——见 annotateSandboxFailures）。
    return { kind: "argv", ...wrapped, violationKey: wrapped.commandId, release: createSandboxLease() };
  }
  const policy = buildExecutionPolicy(context);
  // srt 会在外层把 TMPDIR 设为自己的 scratch 目录。非完全访问档在最内层恢复运行区变量，
  // 让遵循 HOME/TMP/XDG 约定的开发工具稳定写入项目运行区；真正边界仍由 policy 强制。
  const effectiveCommand = context.mode !== "full"
    ? `${runtimeEnvironmentPrefix(context.environment)} ${command}`
    : command;
  // ⚠️ 违规归因 key **必须与 wrap 时一致**，否则 annotateStderrWithSandboxFailures 永远匹配不到
  // （srt 的 store 用 base64(commandId) 做键）。此前 EM 是"wrap 不传 id + annotate 传包装后的
  // 命令字符串"，两处都对不上 ⇒ **sandbox 拦截对用户完全静默**。用一次性随机 id 而不是命令文本：
  // 命令文本做键会让上一条命令的滞后事件被算到下一条同名命令头上（错误归因）。
  const violationKey = newViolationKey();
  // 先 await 完包装再建租约：wrapWithSandbox 抛错时不会留下「没人调用」的计数，
  // 否则 srt 的 activeSandboxCount 会只增不减，后面所有清理都被推迟（占位文件永不清）
  // srt 的签名是 (command, binShell?, customConfig?, abortSignal?, options?)——options 在**第 5 位**，
  // commandId 必须在这里给出，annotate 时才匹配得上（见上）。
  const wrappedCommand = await srt.SandboxManager.wrapWithSandbox(
    effectiveCommand,
    undefined,
    policy,
    undefined,
    { commandId: violationKey, commandText: command },
  );
  return {
    kind: "shell",
    command: wrappedCommand,
    env: context.environment,
    violationKey,
    release: createSandboxLease(),
  };
}

/** 违规归因 key：一次执行一个，绝不复用（见 wrapForSandbox 的说明）。 */
function newViolationKey(): string {
  return `em-${randomUUID()}`;
}

/**
 * 完全访问的原生执行规格：不套任何 OS 沙盒，直接在宿主环境执行。
 * 形态与沙盒分支保持一致，调用方无需分支：
 * - 非 Windows：shell 字符串 → 原样交给 resolveSpawn（shell:true + detached 进程组，便于整组 kill）
 * - Windows：argv 形态（bash = Git Bash -c／powershell = powershell -Command），
 *   比 srt-win 那条两跳路径少一次 worker 转交
 * 不返回 release：没有 srt 租约，也就没有 bwrap/seatbelt 留下的 ghost 占位文件要清
 * （调用方一律用 `release?.()`，缺省即跳过）。
 */
function nativeSpawnSpec(
  command: string,
  opts: { context: ExecutionContext; gitBashPath?: string; windowsShell?: "bash" | "powershell" },
): SandboxSpawnSpec {
  const env = opts.context.environment;
  if (process.platform === "win32") {
    const powershell = opts.windowsShell === "powershell";
    const exe = powershell ? "powershell.exe" : (opts.gitBashPath ?? "bash.exe");
    const args = powershell ? ["-NoProfile", "-NonInteractive", "-Command", command] : ["-c", command];
    return { kind: "argv", argv: [exe, ...args], env };
  }
  return { kind: "shell", command, env };
}

function runtimeEnvironmentPrefix(environment: NodeJS.ProcessEnv): string {
  const names = [
    "HOME", "USERPROFILE", "TMPDIR", "TMP", "TEMP",
    "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME",
    "NPM_CONFIG_PREFIX", "NPM_CONFIG_CACHE", "npm_config_cache", "COREPACK_HOME",
    "npm_config_prefix", "npm_config_global_prefix", "NPM_CONFIG_USERCONFIG", "npm_config_userconfig",
    "npm_config_globalconfig", "PNPM_HOME", "YARN_CACHE_FOLDER", "BUN_INSTALL", "BUN_INSTALL_CACHE_DIR",
    "PIP_CACHE_DIR", "UV_CACHE_DIR", "PYTHONUSERBASE", "GRADLE_USER_HOME", "MAVEN_OPTS",
    "CARGO_HOME", "GOPATH", "GOMODCACHE", "GOBIN", "PUB_CACHE", "DENO_DIR", "DOTNET_CLI_HOME",
    "NUGET_PACKAGES", "COMPOSER_HOME", "COMPOSER_CACHE_DIR", "CCACHE_DIR",
    "PWD", "INIT_CWD", "EASYMINT_WORKSPACE", "EASYMINT_RUNTIME",
  ];
  const assignments = names.flatMap((name) => {
    const value = environment[name];
    return value === undefined ? [] : [`${name}=${shellLiteral(value)}`];
  });
  return assignments.length > 0 ? `export ${assignments.join(" ")};` : "";
}

function shellLiteral(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * 违规归因：把沙盒拦截事件注解进 stderr（"Operation not permitted" → 大白话违规说明）。
 *
 * `violationKey` 必须是 **wrapForSandbox 产出的那一个**——srt 的违规存储以
 * `base64(commandId)` 为键，键不一致就恒返回原文（这正是"拦截静默"的第二半原因；
 * 第一半是 logMonitor 没开，见 ensureSandbox）。
 */
export function annotateSandboxFailures(violationKey: string, stderr: string): string {
  try {
    const srt = _srt ?? null;
    if (!srt) return stderr;
    return filterBenignViolations(srt.SandboxManager.annotateStderrWithSandboxFailures(violationKey, stderr));
  } catch {
    return stderr; // 注解失败不吞原 stderr
  }
}

/** srt 的违规块（macOS 由常驻 `log stream` 收集，见 ensureSandbox）。 */
const VIOLATION_BLOCK = /<sandbox_violations>\r?\n([\s\S]*?)<\/sandbox_violations>/;

/**
 * 标准模式下会被连带记录的三类**系统探测**拒绝：进程启动时的常规查询
 * （sysctl 版本号、磁盘空间/网卡信息、mach 服务查询）。它们不构成“命令被拦”——命令往往完全成功。
 *
 * 不过滤的后果：**成功结果里也挂着 violations/deny 字样**，人和模型都会误读成被拦
 * （2026-09-17 权限自测 B2/B5/B14/B15 四题均出现，得额外核对才敢判“通过”）。
 *
 * 只去这三类；语义明确的拦截（网络出口、文件读写目标）**一律保留**——
 * 成功命令里出现它们反而是有用信号（脚本吞掉了子步骤的失败）。
 * 兼容性清单腐化暴露的也是后者，所以过滤不影响它作为探测器的价值。
 */
const BENIGN_VIOLATION = /\b(?:sysctl-read|system-info|mach-lookup)\b/;

export function filterBenignViolations(stderr: string): string {
  const match = stderr.match(VIOLATION_BLOCK);
  if (!match || match.index === undefined) return stderr;
  const kept = (match[1] ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !BENIGN_VIOLATION.test(line));
  const before = stderr.slice(0, match.index);
  const after = stderr.slice(match.index + match[0].length);
  if (kept.length === 0) return before + after.replace(/^\n+/, "");
  return `${before}<sandbox_violations>\n${kept.join("\n")}\n</sandbox_violations>${after}`;
}

/**
 * 释放沙盒的全局状态与常驻资源：srt 的 macOS 日志监控、Windows ACL、bwrap 挂载点等。
 *
 * **三条路径共用这一个原语**：测试清理、依赖变化后重建、**应用退出收尾**。
 * 退出那一路是必需的——srt 在 macOS 上 initialize 时会 spawn 一个常驻 `log stream` 收集
 * 违规事件（见 ensureSandbox 的 enableLogMonitor），而**它的停止闭包只在
 * SandboxManager.reset() 里被调用**（srt 内部变量 logMonitorShutdown，见
 * node_modules/@anthropic-ai/sandbox-runtime/dist/sandbox/sandbox-manager.js）。退出清场若不调它，
 * 监控进程会失去父进程（PPID=1）常驻：LaunchServices 据此把 EasyMint 记为
 * exited-with-subordinates，macOS 26+ 会在 Dock 上持续提示「仍在后台运行」（2026-09-24 实测）。
 *
 * 顺带把 _state 重置为 untouched：调用方要么正在退出，要么打算重新初始化。
 */
export async function releaseSandbox(): Promise<void> {
  // _srt 在 getSrt() 之后即非 null（哪怕 initialize 失败），此时仍要 reset——
  // 半初始化的会话同样可能已经把监控进程起起来了。
  if (_srt) await _srt.SandboxManager.reset();
  _state = "untouched";
  _failReason = "";
}

/**
 * 重置缓存状态（供生产使用）：依赖刚装好或用户点了「重新检测」时调用，
 * 让「装完即生效」不必重启 EasyMint——否则失败状态会一直被缓存住继续 fail-closed。
 */
export async function resetSandboxState(): Promise<void> {
  await releaseSandbox();
}
