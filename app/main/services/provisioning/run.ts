/**
 * 执行层：把「计划」跑起来，按**阶段**回报进度，装完复核。
 *
 * 三条执行策略：
 * - `pkg`（Linux）：包管理器 + pkexec 单命令（系统弹授权框）
 * - `usernsProfile`（Linux）：加载 AppArmor profile 给 bwrap 放行 userns（pkexec；见 fixUserns）
 * - `winInstall`（Windows）：srt 自带的一次性装配（隔离账户 + WFP 网络过滤，自提权 → 一次 UAC）
 *
 * 为什么用阶段而非解析包管理器输出：apt/dnf/pacman/zypper 的输出格式、进度条、语言各不相同，
 * 解析必然脆弱且随时被上游改坏；阶段化在两家策略上都成立，进度条用"不确定态"更诚实。
 *
 * 安全（方案 §8）：命令只来自 plan 的白名单产物——本文件**不拼任何命令**（连 shell 都不起，
 * 一律 argv 直接 spawn）；提权交给系统弹窗（pkexec / UAC），EM 不代持凭据。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  APPARMOR_PROFILES_PACKAGE, buildInstallArgv, distroManualInstallCommand, manualInstallCommand,
  readDistro, resolveInstaller, resolvePkexec, resolveUsernsProfileSource, usernsCopyArgv,
  usernsInstallSourceArgv, usernsLoadArgv, usernsManualCommand, usernsProfileInstalled,
  windowsInstallCommand, type Installer,
} from "./plan";
import { cleanEnv, prependPathDirs, probeEnvironment, probePathDirs } from "./probe";
import { packagedSrtVersion, srtWinSpawn } from "../sandbox/srt-win";
import type { EnvReport } from "./types";
import { emHome } from "../../utils/paths";

export type InstallPhase = "preparing" | "installing" | "verifying" | "done" | "failed";

export interface InstallEvent {
  phase: InstallPhase;
  /** 进度（1-based；preparing 为 0） */
  index: number;
  total: number;
  message?: string;
}

export interface InstallResult {
  ok: boolean;
  /** 失败时的自助指引（可复制到终端）；undefined = 连指引都拿不到 */
  manualCommand?: string;
  /** 面向用户的原因 */
  reason?: string;
  report?: EnvReport;
  exitCode?: number | null;
}

type Plan =
  | { strategy: "pkg"; argv: string[] | null; manualCommand?: string }
  | { strategy: "winInstall"; manualCommand?: string };

/** Windows 一次性装配的结果：`cancelled` = 用户在 UAC 窗口点了取消（srt 的 exit 10） */
export interface WinInstallOutcome {
  cancelled: boolean;
}

export interface RunDeps {
  spawn: typeof spawn;
  /** Windows 一次性装配（srt 自提权）；单测注入用 */
  installWin: () => Promise<WinInstallOutcome>;
  probe: () => Promise<EnvReport>;
  logger: (line: string) => void;
  /** 覆盖计划层（单测注入用；生产不传） */
  plan: Plan;
}

const LOG_DIR = path.join(emHome(), "logs");
const LOG_PATH = path.join(LOG_DIR, "provisioning.log");

/** 审计日志：命令、退出码、输出尾部（方案 §8.4）。日志本身失败不能影响安装 */
function defaultLog(line: string): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`);
  } catch { /* ignore */ }
}

/** 输出尾部用于诊断：剥掉终端控制字符、截断（包管理器输出可能很长） */
export function outputTail(s: string, n = 400): string {
  return s.replace(/\u001b\[[0-9;]*m/g, "").trim().slice(-n);
}

async function defaultInstallWin(): Promise<WinInstallOutcome> {
  const srt = await import("@anthropic-ai/sandbox-runtime");
  // 必须传 srtWin（srt 的 spawn 规格）：不传时 srt 内部 `opts.srtWin ?? resolveSrtWin()` 会抛
  // `no srt-win path configured` —— 见 sandbox/srt-win.ts
  const st = await srt.installWindowsSandboxAsync({ srtWin: srtWinSpawn(srt) });
  // 「用户关掉了 UAC 弹窗」这件事 srt 是用返回值表达的（cancel 不抛异常）：必须把它接出来，
  // 否则复核后发现没装上，只能笼统报"安装未完成（退出码 null）"，把用户自己的选择说成故障
  return { cancelled: st?.cancelled === true };
}

/** 计划层：Linux 走包管理器白名单；Windows 走 srt 装配（手工指引见 plan.ts 的 windowsInstallCommand） */
async function computePlan(ids: readonly string[]): Promise<Plan> {
  if (process.platform === "win32") {
    if (!isWindowsInstallRequest(ids)) return { strategy: "pkg", argv: null };
    try {
      const srt = await import("@anthropic-ai/sandbox-runtime");
      return { strategy: "winInstall", manualCommand: windowsInstallCommand(packagedSrtVersion(srt)) };
    } catch {
      return { strategy: "winInstall", manualCommand: windowsInstallCommand() };
    }
  }
  const distro = readDistro();
  const installer = resolveInstaller({ id: distro.id, idLike: distro.idLike ?? [] });
  // pkexec 的真实路径在这里解析（plan 层默认值只是兜底），**且它必须存在**才产出特权 argv：
  // 与 probe 的 auto 门槛同一判据，避免"界面不给按钮、执行层却硬跑"两边口径漂移
  const pkexec = resolvePkexec();
  return {
    strategy: "pkg",
    argv: installer && pkexec ? buildInstallArgv(ids, installer, pkexec) : null,
    manualCommand:
      manualInstallCommand(ids, installer) ?? distroManualInstallCommand(distro, ids) ?? undefined,
  };
}

/** Windows 提权入口只接受唯一的固定条目，未知 ID 或混合请求一律拒绝。 */
export function isWindowsInstallRequest(ids: readonly string[]): boolean {
  return ids.length === 1 && ids[0] === "winSandbox";
}

/** 提权命令没用退出码表达失败时的通用兜底（srt 的装配抛异常） */
const FAILED_EXIT = 1;

/**
 * 跑一条特权 argv 并等它结束：**只用 argv 直接 spawn，不起 shell**（杜绝命令拼接）；
 * 传干净且补全过 PATH 的环境；取消时 SIGTERM 子进程。
 */
async function runArgv(
  argv: readonly string[],
  spawnFn: typeof spawn,
  signal: AbortSignal | undefined,
  log: (line: string) => void,
): Promise<{ exitCode: number | null; tail: string }> {
  const head = argv[0];
  if (!head) return { exitCode: FAILED_EXIT, tail: "空命令" };
  log(`[exec] argv=${JSON.stringify(argv)}`);
  const child = spawnFn(head, [...argv.slice(1)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: prependPathDirs(cleanEnv(), probePathDirs()),
    windowsHide: true,
  });
  let out = "";
  child.stdout?.on("data", (d) => { out += String(d); });
  child.stderr?.on("data", (d) => { out += String(d); });
  const kill = (): void => { try { child.kill("SIGTERM"); } catch { /* 已退出 */ } };
  // 传入时已取消：abort 事件在取消那一刻就派发过了，事件不重放——之后注册的监听器收不到。
  // MDN「Implementing an abortable API」给的示范也是这个双分支写法（先判 aborted、再挂监听）：
  // 「the promise is rejected immediately **if the signal is already aborted**, or if the abort
  //   event is detected」→ 所以这一行不能省，否则"点取消时命令已在跑"这个边界没人处理
  if (signal?.aborted) kill();
  signal?.addEventListener("abort", kill, { once: true });
  const exitCode = await new Promise<number | null>((resolve) => child.on("close", (c) => resolve(c)));
  signal?.removeEventListener("abort", kill);
  const tail = outputTail(out, 200);
  log(`[exec] exit=${exitCode} tail=${tail}`);
  return { exitCode, tail };
}

export async function installDependencies(
  ids: readonly string[],
  onEvent: (e: InstallEvent) => void,
  deps: Partial<RunDeps> = {},
  signal?: AbortSignal,
): Promise<InstallResult> {
  const spawnFn = deps.spawn ?? spawn;
  const installWin = deps.installWin ?? defaultInstallWin;
  const probe = deps.probe ?? ((): Promise<EnvReport> => probeEnvironment());
  const log = deps.logger ?? defaultLog;
  const plan = deps.plan ?? (await computePlan(ids));
  const total = ids.length;

  onEvent({ phase: "preparing", index: 0, total, message: "正在准备安装…" });

  // ── 执行段：两种策略产出统一的 (exitCode | errorText)，后面共用复核逻辑 ──
  let exitCode: number | null = null;
  let errorText = "";
  /** 用户在 UAC 窗口点了取消——不是失败，措辞必须与"装失败了"分开 */
  let winCancelled = false;
  if (plan.strategy === "pkg") {
    if (!plan.argv) {
      return {
        ok: false,
        reason: "当前系统无法自动安装（未识别的发行版、没有可用的包管理器，或缺少系统授权组件 pkexec）",
        manualCommand: plan.manualCommand,
      };
    }
    log(`[install] argv=${JSON.stringify(plan.argv)}`);
    onEvent({ phase: "installing", index: 1, total, message: "正在安装系统组件（可能弹出系统授权窗口）…" });
    const r = await runArgv(plan.argv, spawnFn, signal, log);
    exitCode = r.exitCode;
    errorText = r.tail;
  } else {
    onEvent({ phase: "installing", index: 1, total, message: "正在安装系统保护组件（会弹出系统授权窗口）…" });
    log("[install] windows installWindowsSandboxAsync");
    try {
      winCancelled = (await installWin())?.cancelled === true;
    } catch (e) {
      errorText = (e as Error).message;
      exitCode = FAILED_EXIT; // 没有退出码，统一按失败处理
      log(`[install] windows failed: ${errorText}`);
    }
  }

  onEvent({ phase: "verifying", index: total, total, message: "正在复核…" });
  const report = await probe();
  const requested = new Set(ids);
  const remaining = [...requested].filter((id) => report.items.find((i) => i.id === id)?.status !== "ok");
  if (remaining.length === 0) {
    const hasOtherIssues = report.items.some((i) => i.status !== "ok");
    onEvent({
      phase: "done", index: total, total,
      message: hasOtherIssues ? "所选组件已安装，请继续处理其余环境问题" : "环境已就绪",
    });
    return { ok: true, report, exitCode };
  }

  // 失败原因要能指导下一步，四种情况分开说：取消 / 用户关掉了授权框 / 命令跑完了但仍不可用
  //（多为系统策略拦截）/ 命令没跑成。写成分支而非嵌套三元，是因为四种情形各自有独立措辞。
  let reason: string;
  if (signal?.aborted) {
    reason = "安装已取消";
  } else if (winCancelled) {
    // 用户的选择，不是故障：不能套下面那条"安装未完成（退出码 null）"
    reason = "你在系统授权窗口点了取消，环境没有改变——需要时再点一次「一键安装」即可";
  } else if (exitCode === 0) {
    reason = `组件已安装，但 ${remaining.join("、")} 仍不可用——多为系统策略拦截，请看下方说明`;
  } else {
    reason = `安装未完成（退出码 ${exitCode}：${pkexecExitNote(exitCode)}）`
      + (errorText ? `。错误信息：${outputTail(errorText, 160)}` : "");
  }
  onEvent({ phase: "failed", index: total, total, message: reason });
  return { ok: false, report, manualCommand: plan.manualCommand, reason, exitCode };
}

// ── userns 放行的一键修复 ─────────────────────────────────────────────────────
//
// AppImage / tar.gz / 源码运行拿不到 deb 的安装钩子，只能靠这条路：三条**绝对路径单命令**
// 经 pkexec 执行（系统弹授权框）。不写脚本、不调用应用自带文件——pkexec 以 root 执行传入的程序，
// 若该文件在用户可写目录（AppImage、解包目录）＝让 root 执行用户可改的代码。
//
// 每一步都**先判定再做**（模板在不在、install / apparmor_parser 在不在、目标是否已存在），
// 幂等且不覆盖已存在的 profile（可能是系统自带，也可能用户改过）。

export interface FixUsernsDeps {
  spawn: typeof spawn;
  probe: () => Promise<EnvReport>;
  logger: (line: string) => void;
  /** 文件存在判定（单测注入） */
  exists: (p: string) => boolean;
  /** 包管理器解析（单测注入；传 null = 明确"没有包管理器"） */
  installer: Installer | null;
  /** 平台（单测注入：本机是 macOS，但修复逻辑只针对 Linux，得能在测试里跑起来） */
  platform: string;
}

/**
 * pkexec 退出码的解释。依据 polkit 官方手册 `pkexec(1)` 的「RETURN VALUE」段：
 * - 未经授权 / 认证无法完成 / 发生错误 → **127**
 * - 因**用户关闭了认证对话框**而拿不到授权 → **126**
 * - 成功时**原样返回 PROGRAM 的返回码**
 * 所以这两位数字能给出比"常见原因…"精确得多的指引，不必只报数字。
 *
 * 但同一句话也意味着：**PROGRAM 自身返回 126/127 时无法区分**（我们执行的是 apt-get /
 * install / apparmor_parser，概率极低但不为零）——故措辞用「通常表示」，
 * 且不给 127 断言"命令没有执行"（那可能是 PROGRAM 自己的退出码）。
 * 来源：https://manpages.ubuntu.com/manpages/noble/man1/pkexec.1.html
 */
function pkexecExitNote(exitCode: number | null): string {
  if (exitCode === 126) return "通常表示你在系统授权窗口点了取消，命令没有执行";
  if (exitCode === 127) return "通常表示系统授权没成功（当前环境弹不出授权窗口，或被系统策略拒绝）";
  return "常见原因：取消了系统授权、当前环境弹不出授权窗口，或网络/镜像源不可达";
}

export async function fixUserns(
  onEvent: (e: InstallEvent) => void,
  deps: Partial<FixUsernsDeps> = {},
  signal?: AbortSignal,
): Promise<InstallResult> {
  if ((deps.platform ?? process.platform) !== "linux") return { ok: false, reason: "该修复只在 Linux 上适用" };

  const total = 2; // 阶段数固定（准备 / 安装 1~2 步 / 复核），进度条不假装精确到每步
  const manualCommand = usernsManualCommand();
  const spawnFn = deps.spawn ?? spawn;
  const probe = deps.probe ?? ((): Promise<EnvReport> => probeEnvironment());
  const log = deps.logger ?? defaultLog;
  const exists = deps.exists ?? ((p: string): boolean => fs.existsSync(p));
  // 与 probe 的 auto 门槛同源（见 plan.ts 的 resolvePkexec）：没有 pkexec 就弹不出授权框，
  // 直接给手工三步，不要让用户白等一轮再失败
  if (!resolvePkexec(exists)) {
    return {
      ok: false,
      reason: "这台机器没有系统授权组件（polkit / pkexec），无法在应用内完成——请按下面的命令自己执行",
      manualCommand,
    };
  }
  const installer = "installer" in deps
    ? (deps.installer ?? null)
    : ((): Installer | null => {
      const d = readDistro();
      return resolveInstaller({ id: d.id, idLike: [] });
    })();

  onEvent({ phase: "preparing", index: 0, total, message: "正在准备…" });

  /** 唯一判定成功的地方：重新探测，看 userns 这一项是否真的变成可用（不看命令的退出码） */
  const verify = async (failReason?: string, exitCode?: number | null): Promise<InstallResult> => {
    onEvent({ phase: "verifying", index: total, total, message: "正在复核…" });
    const report = await probe();
    const userns = report.items.find((i) => i.id === "userns");
    if (userns?.status === "ok") {
      // 进度文案不点包名（用户 2026-09-15：安装动画上"不要显示具体的在安装什么依赖"）
      onEvent({ phase: "done", index: total, total, message: "已允许创建隔离空间" });
      return { ok: true, report, exitCode };
    }
    const reason = failReason
      ?? (userns
        ? "配置已写入，但系统仍未放行——刚执行完可稍等片刻或重启后再检测；仍不行请按下面的命令手动执行"
        : "复核时没找到「隔离能力」这一项，请点「重新检测」确认");
    onEvent({ phase: "failed", index: total, total, message: reason });
    return { ok: false, report, reason, manualCommand, exitCode };
  };

  // 幂等：目标已在 → 什么都不做（不覆盖系统自带 / 用户改过的 profile），直接复核
  if (usernsProfileInstalled(exists)) return verify();

  // 1) 本地没有 profile 模板 → 先装提供模板的包（Ubuntu 24.04 是 apparmor-profiles；25.04+ 由 apparmor 自带）
  let source = resolveUsernsProfileSource(exists);
  if (!source) {
    const argv = usernsInstallSourceArgv(installer);
    if (!argv) {
      return {
        ok: false,
        reason: "本机没有 profile 模板，也无法自动安装（没有可用的包管理器）——请按下面的命令手动执行",
        manualCommand,
      };
    }
    onEvent({ phase: "installing", index: 1, total, message: "正在安装系统配置包（会弹出系统授权窗口）…" });
    const r = await runArgv(argv, spawnFn, signal, log);
    if (signal?.aborted) return { ok: false, reason: "已取消", manualCommand, exitCode: r.exitCode };
    if (r.exitCode !== 0) {
      return {
        ok: false,
        reason: `安装 ${APPARMOR_PROFILES_PACKAGE} 未完成（退出码 ${r.exitCode}：${pkexecExitNote(r.exitCode)}）`,
        manualCommand,
        exitCode: r.exitCode,
      };
    }
    source = resolveUsernsProfileSource(exists); // 装完再确认，不假设包一定提供了它
    if (!source) {
      return {
        ok: false,
        reason: `已安装 ${APPARMOR_PROFILES_PACKAGE}，但仍未找到 profile 模板——请按下面的命令手动执行`,
        manualCommand,
        exitCode: 0,
      };
    }
  }

  // 2) 落 profile：用系统的 install 写文件（argv 传参，不起 shell、不用重定向）
  const copy = usernsCopyArgv(source, exists);
  if (!copy) return { ok: false, reason: "找不到 install 命令（coreutils），请按下面的命令手动执行", manualCommand };
  onEvent({ phase: "installing", index: 1, total, message: "正在写入系统配置（会弹出系统授权窗口）…" });
  const rc = await runArgv(copy, spawnFn, signal, log);
  if (rc.exitCode !== 0) {
    return {
      ok: false,
      reason: signal?.aborted ? "已取消" : `写入系统配置未完成（退出码 ${rc.exitCode}：${pkexecExitNote(rc.exitCode)}）`,
      manualCommand,
      exitCode: rc.exitCode,
    };
  }

  // 3) 加载进内核（不重启就生效；apparmor_parser -r 在未加载时会新建）
  const load = usernsLoadArgv(exists);
  if (!load) {
    return verify("配置已写入，但本机没有 apparmor_parser 可立即加载——重启后由系统服务加载", 0);
  }
  onEvent({ phase: "installing", index: 2, total, message: "正在让系统加载配置…" });
  const rl = await runArgv(load, spawnFn, signal, log);
  return verify(
    signal?.aborted
      ? "已取消：配置已写入，重启后由系统服务加载"
      : rl.exitCode === 0
        ? undefined // 命令成功但仍被挡 → 用 verify 的默认文案
        : `配置已写入，但加载没成功（退出码 ${rl.exitCode}：${pkexecExitNote(rl.exitCode)}）——重启后由系统服务加载；仍不行请按下面的命令手动执行`,
    rl.exitCode,
  );
}
