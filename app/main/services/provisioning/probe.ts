/**
 * 环境探测层：**防假检测**是这一层的首要目标（方案 §3.5）。
 *
 * 三条铁律（每条都对应一次真实误报）：
 * 1. 绝对路径候选 + PATH 前置：GUI 进程的 PATH 是启动时的快照，用户后装的工具
 *    （~/.cargo/bin、/snap/bin、~/.local/bin、homebrew、%APPDATA%\npm）不在里面；
 *    只用裸命令名 / `which` 会把"已安装"报成"没装"（codegraph 误报的根因之一）。
 * 2. 三态：`ok` / `missing` / `unknown`(探测失败) / `blocked`(装了但被系统策略挡)——
 *    绝不把探测失败或"被挡"压成"未安装"，那样用户会反复装、还是不行。
 * 3. 探测环境要干净：剔除会污染子进程的变量；**不用 EM 托管的环境**（用户自己设的变量不应影响判定）；
 *    也**不在沙盒里探测**（沙盒会 deny 掉读路径，把"存在"探成"不存在"）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  autoFixFor, distroHint, distroManualInstallCommand, hasDistroManualCommand, manualInstallCommand,
  readDistro, resolveInstaller, resolvePkexec, usernsFixAvailable, usernsManualCommand,
  windowsInstallCommand, type Installer,
} from "./plan";
import { probeWindowsRuntime, type WindowsRuntimeProbe } from "../windows-runtime";
import { packagedSrtVersion, srtWinSpawn } from "../sandbox/srt-win";
import type { EnvItem, EnvItemId, EnvItemStatus, EnvReport } from "./types";

/** 传下去会让被测程序行为异常的变量（本项目实际见过外部注入 NODE_OPTIONS） */
const POLLUTING_ENV = [
  "NODE_OPTIONS", "ELECTRON_RUN_AS_NODE", "NODE_ENV",
  "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
];

/** 探测/安装子进程都用一个干净且补全过 PATH 的环境（见文件头三条铁律） */
export function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of POLLUTING_ENV) delete env[k];
  return env;
}

/** PATH 前置目录（去重后拼到子进程 PATH 前面） */
export function prependPathDirs(env: NodeJS.ProcessEnv, dirs: readonly string[]): NodeJS.ProcessEnv {
  const sep = process.platform === "win32" ? ";" : ":";
  const existing = (env.PATH ?? "").split(sep).filter(Boolean);
  const merged = [...new Set([...dirs, ...existing])];
  return { ...env, PATH: merged.join(sep) };
}

/** PATH 前置目录（去重后拼到子进程 PATH 前面）——探测与安装子进程共用 */
export function probePathDirs(): string[] {
  const home = os.homedir();
  if (process.platform === "win32") {
    const pf = process.env.ProgramFiles ?? "C:\\Program Files";
    const appData = process.env.APPDATA ?? "";
    return [path.join(pf, "nodejs"), path.join(appData, "npm"), path.join(home, ".local", "bin")];
  }
  return [
    "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin",
    "/snap/bin", "/run/current-system/sw/bin",           // snap / NixOS
    path.join(home, ".local", "bin"), path.join(home, ".cargo", "bin"), // pipx / cargo
  ];
}

// ── 探测原语（依赖注入，便于单测三态）─────────────────────────────────────────

export interface ProbeDeps {
  exists(p: string): boolean;
  run(cmd: string, args: readonly string[]): { status: number | null; stdout: string };
}

const realDeps: ProbeDeps = {
  exists: (p) => fs.existsSync(p),
  run: (cmd, args) => {
    const r = spawnSync(cmd, [...args], {
      encoding: "utf-8", timeout: 5000, stdio: "pipe", windowsHide: true,
      env: prependPathDirs(cleanEnv(), probePathDirs()),
    });
    // 失败留痕：静默会把「装了但启不来」和「没装」压成同一个结论（这正是潜伏 v0.6.6→v0.23.1 的原因）
    if (r.status !== 0) {
      const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
      console.warn(`[provisioning] 探测失败 cmd=${cmd} reason=${code ?? `exit ${r.status}`}`);
    }
    return { status: r.status, stdout: (r.stdout ?? "").trim() };
  },
};

const isAbsolutePath = (p: string): boolean => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);

export type ProbeOutcome =
  | { status: "ok"; version: string }
  | { status: "missing" }
  | { status: "unknown" };

/** 逐个候选尝试；绝对路径候选"存在但拿不到版本" → unknown（装了但启不来），不是 missing */
export function probeBinary(
  candidates: readonly string[],
  args: readonly string[],
  deps: ProbeDeps = realDeps,
): ProbeOutcome {
  let sawExistingButFailed = false;
  for (const cand of candidates) {
    if (isAbsolutePath(cand) && !deps.exists(cand)) continue;
    const r = deps.run(cand, args);
    if (r.status === 0 && r.stdout) return { status: "ok", version: r.stdout.split("\n")[0]!.trim() };
    if (isAbsolutePath(cand)) sawExistingButFailed = true;
  }
  return sawExistingButFailed ? { status: "unknown" } : { status: "missing" };
}

// ── 条目定义 ────────────────────────────────────────────────────────────────

interface BinarySpec {
  id: EnvItemId;
  label: string;
  /** 缺了它会影响什么功能（面向用户）。**必须说能力，不说包名**——用户不关心 bubblewrap 是什么，
   *  只关心"不装会怎样"（用户 2026-09-15 反馈：此前没说清影响，提醒不够明确） */
  impact: string;
  args: string[];
  candidates: string[];
}

/**
 * 沙盒三件套 = 只对 Linux 有意义（macOS 用系统 Seatbelt，无外部依赖）。
 *
 * **影响说明的口径（2026-09-15 校正）**：三项是 **AND 门**——`SandboxManager.initialize()`
 * 把短缺项收进 errors，非空即抛（`sandbox-dependencies not available`），沙盒整体起不来。
 * 所以三项的"缺了会怎样"**是同一句话**；区别只在"它负责什么"。此前每条各写各的后果，
 * 现在看是不准确的（例如写 socat 缺了只影响"联网的命令"，实际是沙盒整个不可用）。
 *
 * `rg` 那条还要特别说明：它是**启动时的检查项**，不是运行时依赖——srt 里 `ripGrep()` 已无调用点
 * （唯一调用者被 `scripts/patch-sandbox-runtime.cjs` 换成静态列表），而应用自带的检索功能用的是
 * SDK 自己管理/下载的那一份。旧文案"缺少它代码检索不可用"会误导，已删。
 */
const LINUX_BINARIES: BinarySpec[] = [
  {
    id: "bwrap", label: "bubblewrap（隔离进程）", args: ["--version"],
    impact: "它负责把命令关进隔离环境。沙盒这三项依赖缺一不可——缺它时沙盒整体不可用，命令只能选择「关闭沙盒运行」（不推荐）",
    candidates: ["bwrap", "/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap", "/snap/bin/bwrap", "/run/current-system/sw/bin/bwrap"],
  },
  {
    id: "socat", label: "socat（网络桥）", args: ["-V"],
    impact: "它负责把隔离环境里的网络接到宿主。沙盒这三项依赖缺一不可——缺它时沙盒同样整体不可用",
    candidates: ["socat", "/usr/bin/socat", "/usr/local/bin/socat", "/bin/socat", "/run/current-system/sw/bin/socat"],
  },
  {
    id: "rg", label: "ripgrep（沙盒依赖项）", args: ["--version"],
    impact: "沙盒启动时会检查它在不在（三项缺一不可，缺它沙盒同样整体不可用）；应用自带的检索功能不依赖它，缺了不影响检索",
    // cargo 安装（~/.cargo/bin）在开发者机器上很常见，必须列候选否则误报
    candidates: ["rg", "/usr/bin/rg", "/usr/local/bin/rg", "/bin/rg", "/snap/bin/rg",
      path.join(os.homedir(), ".cargo", "bin", "rg"), "/run/current-system/sw/bin/rg"],
  },
];

/** userns 条目（两种状态共用）：说的是"少了哪项能力"，不是"哪个内核开关" */
const USERNS_IMPACT = "系统不允许创建隔离空间——即使 bubblewrap 装好了，命令仍会被拦下";

/** Windows 系统保护条目：装配本身要弹一次 UAC，影响也说清"少了它会被怎样" */
const WIN_SANDBOX_IMPACT = "缺少它 Mint 无法隔离执行命令，也不限制其网络访问（安装时会弹一次系统授权窗口）";

/** userns 功能实测命令：`which bwrap` 查不出「包在但被 AppArmor 挡」（Ubuntu 24.04+ 默认如此） */
const USERNS_PROBE_ARGS = ["--ro-bind", "/", "/", "--dev", "/dev", "--unshare-pid", "--", "echo", "ok"];

/**
 * Ubuntu 24.04 起 AppArmor 默认禁止非特权进程创建 user namespace，bwrap 因此失败。
 * **官方做法是只给 bwrap 放行**（加载 bwrap-userns-restrict 这份 profile），而不是全局关掉限制
 * （`sysctl kernel.apparmor_restrict_unprivileged_userns=0`）——后者会扩大所有进程的内核攻击面，
 * Ubuntu 与同类产品（OpenAI Codex）的指引都是优先加载 profile。
 * deb 安装时由 `build/linux-after-install.sh` 自动落这份 profile；这里仍展示命令，
 * 是因为 AppImage / tar.gz / 源码运行拿不到那一步。
 */
const APPARMOR_HINT =
  "系统默认策略不允许 bubblewrap 创建隔离空间（Ubuntu 24.04 起的默认行为）。"
  + "用 deb 安装时已自动处理过，这里仍显示说明那一步没成功；其余安装形态执行一次下面三条命令即可（不必重启）。";

/**
 * 机器上没有 pkexec（polkit 缺失：WSL、精简镜像、无 polkit 的桌面）时的说明。
 * 必须说清"为什么没有一键按钮"——否则按钮凭空消失，用户只会以为功能坏了。
 */
const NO_PKEXEC_DETAIL =
  "这台机器没有系统授权组件（polkit / pkexec），应用内无法自动安装——请把下面的命令复制到终端执行";

/** 「被系统策略拦住」的修法：能一键修的给 auto，否则只给官方三步命令（两条路都留着） */
function blockedFix(installer: Installer | null, exists: (p: string) => boolean): EnvItem["fix"] {
  return {
    // 应用内一键修复：三条**绝对路径单命令**经 pkexec 执行（改系统安全配置，故必须由系统弹框授权，
    // 不是静默执行）。不可用时（缺 install/apparmor_parser、无 pkexec、无包管理器、profile 已在）
    // 只留手工指引。
    ...(usernsFixAvailable(installer, exists) ? { auto: { strategy: "usernsProfile" as const } } : {}),
    manual: {
      command: usernsManualCommand(),
      url: "https://documentation.ubuntu.com/server/how-to/security/apparmor",
    },
    sandboxOff: true,
  };
}

// ── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * 探测整套环境。**异步**：Windows 的 srt-sandbox 状态探测是 async（后续接入）。
 * 只读、不改任何状态；失败留痕、绝不抛错（探测本身不能把主流程带崩）。
 */
export async function probeEnvironment(
  deps: {
    probe?: (spec: BinarySpec) => ProbeOutcome;
    platform?: string;
    /** 文件存在性（注入用）：pkexec 与 userns 一键修复的可用性都靠它判定，测试里不能碰真实文件系统 */
    exists?: (p: string) => boolean;
    runtimeProbe?: () => Promise<WindowsRuntimeProbe>;
  } = {},
): Promise<EnvReport> {
  const platform = deps.platform ?? process.platform;   // 可注入：Windows 分支要能在任意宿主上被测试
  const exists = deps.exists ?? ((p: string) => fs.existsSync(p));
  const distro = readDistro();
  const items: EnvItem[] = [];
  const probe = deps.probe ?? ((spec: BinarySpec) => probeBinary(spec.candidates, spec.args));

  // **macOS 分支刻意不存在**：沙盒用系统自带的 Seatbelt，没有任何外部依赖要装 —— 于是
  // 下面两个平台分支都不进，`items` 保持空数组。面板据此显示"无需额外组件"，引导流程则
  // 判为就绪并直接跳到下一步（这正是用户要的"检测没问题就直接跳"）。将来若 macOS 也需要
  // 检查某项，别漏了这个分支。

  if (platform === "linux") {
    const installer = resolveInstaller({ id: distro.id, idLike: distro.idLike ?? [] });
    // 一键通道的**唯一前提**：机器上真有能弹系统授权的 pkexec（见 plan.ts 的 resolvePkexec）。
    // 没有它就只给手工命令——否则按钮点了必失败，还把"缺 polkit"误报成"权限不够"。
    const pkexec = resolvePkexec(exists);
    const manual = (ids: EnvItemId[]): string | undefined =>
      manualInstallCommand(ids, installer) ?? distroManualInstallCommand(distro, ids) ?? undefined;

    const results = LINUX_BINARIES.map((spec) => ({ spec, out: probe(spec) }));
    let bwrapOk = false;
    for (const { spec, out } of results) {
      if (spec.id === "bwrap" && out.status === "ok") bwrapOk = true;
      const status: EnvItemStatus = out.status;
      const auto = autoFixFor(spec.id); // 包名以 plan 白名单为唯一来源
      const detail = [
        out.status === "unknown" ? "已安装但无法启动——可能是权限问题或安装不完整（不是没装）" : "",
        status !== "ok" && !pkexec ? NO_PKEXEC_DETAIL : "",
      ].filter(Boolean).join("；");
      items.push({
        id: spec.id,
        label: spec.label,
        required: true,
        status,
        impact: spec.impact,
        ...(out.status === "ok" ? { version: out.version } : {}),
        ...(detail ? { detail } : {}),
        fix: {
          ...(auto && pkexec ? { auto } : {}),
          ...(status === "ok" ? {} : { manual: { command: manual([spec.id]) } }),
        },
      });
    }

    // userns：功能实测（只有 bwrap 在才测；否则不重复报错）
    if (!bwrapOk) {
      items.push({
        id: "userns", label: "隔离能力（用户命名空间）", required: true, status: "unknown",
        impact: USERNS_IMPACT,
        detail: "需先装好 bubblewrap 才能验证",
        fix: { sandboxOff: true },
      });
    } else {
      const out = probe({ id: "userns", label: "", impact: USERNS_IMPACT, args: USERNS_PROBE_ARGS, candidates: ["bwrap", "/usr/bin/bwrap"] });
      const ok = out.status === "ok";
      items.push({
        id: "userns", label: "隔离能力（用户命名空间）", required: true,
        status: ok ? "ok" : "blocked",
        impact: USERNS_IMPACT,
        ...(ok ? {} : { detail: pkexec ? APPARMOR_HINT : `${APPARMOR_HINT}${NO_PKEXEC_DETAIL}` }),
        fix: ok ? {} : blockedFix(installer, exists),
      });
    }

    // 非 apt/dnf/pacman/zypper 且我们**没有**核过包名的现成命令（如 NixOS 有）→ 补一句发行版提示。
    // 有命令时不补：那句"未识别的发行版…请用你的包管理器"会和下面可复制的命令互相打架。
    if (!distro.autoInstallable && !hasDistroManualCommand(distro)) {
      const hint = distroHint(distro.id);
      for (const item of items) if (item.status !== "ok") item.detail = item.detail ? `${item.detail}；${hint}` : hint;
    }
  }

  if (platform === "win32") {
    // Windows 的一次性装配（sandbox 账户 + WFP 网络过滤）由 srt 自己的接口负责，装配时弹一次 UAC。
    // 探测也走 srt 的状态接口——不自己拼命令行判断，口径才不会漂。
    // 注意：这类接口**必须显式传 srtWin**（srt 的 spawn 规格），不传会抛
    // `no srt-win path configured` —— 详见 sandbox/srt-win.ts 的说明。
    try {
      const srt = await import("@anthropic-ai/sandbox-runtime");
      const st = await srt.checkWindowsSandboxStatusAsync({ srtWin: srtWinSpawn(srt) });
      const userOk = Boolean(st.user?.provisioned && st.user?.credPresent);
      // WFP 三态：installed / absent / cannot-read。**cannot-read 不是"没装"**——BFE 枚举需要管理员，
      // 非提权进程读不到；按 srt 的说明此时应以账户状态为准（同「探测失败 ≠ 未安装」这条铁律）。
      const wfpState = st.wfp?.state;
      const ok = userOk && wfpState !== "absent";
      const missingPart = !userOk ? "隔离账户未就绪" : "网络过滤未生效";
      items.push({
        id: "winSandbox",
        label: "系统保护（隔离账户 + 网络过滤）",
        required: false,
        status: ok ? "ok" : "missing",
        impact: WIN_SANDBOX_IMPACT,
        ...(ok
          ? { version: wfpState === "cannot-read" ? "网络过滤需管理员权限才能读取（不影响使用）" : undefined }
          : { detail: `未安装：${missingPart}（安装时会弹一次系统授权窗口）` }),
        fix: ok ? {} : {
          auto: { strategy: "winInstall" },
          // 手工指引用我们自己的命令：srt 原文的包名是非作用域的（npm 上那是别人的包）且含散文，
          // 界面按代码块整块复制 → 不可用。理由见 plan.ts 的 windowsInstallCommand()
          manual: { command: windowsInstallCommand(packagedSrtVersion(srt)) },
        },
      });
    } catch (e) {
      // 留痕：这一处曾静默吞掉 `spawn_failed: ENOTDIR`（asar 路径不可 spawn），界面只显示
      // "检测失败"，谁都没法从界面上看出是哪一步挂的（用户 2026-09-15 的第二轮报告）
      console.warn("[provisioning] Windows 系统保护状态探测失败:", (e as Error).message);
      items.push({
        id: "winSandbox",
        label: "系统保护（隔离账户 + 网络过滤）",
        required: false,
        status: "unknown",
        impact: WIN_SANDBOX_IMPACT,
        detail: "检测失败（可能已安装）——不代表未安装，可点「重新检测」重试",
        fix: { manual: { command: windowsInstallCommand() } },
      });
    }

    // One capability check covers Git, Bash and their required utilities; presence alone is insufficient.
    try {
      const runtime = await (deps.runtimeProbe ?? probeWindowsRuntime)();
      items.push({
        id: "windowsRuntime", label: "命令运行环境（Git + Bash）", required: true,
        status: runtime.status === "ready" ? "ok" : runtime.status === "missing" ? "missing" : "unknown",
        ...(runtime.version ? { version: runtime.version } : {}),
        impact: "缺少或损坏时无法执行 Git 和 Bash 命令，可从应用内置组件修复",
        ...(runtime.detail ? { detail: runtime.detail } : {}),
        fix: runtime.status === "ready" ? {} : { auto: { strategy: "windowsRuntime" } },
      });
    } catch (error) {
      items.push({
        id: "windowsRuntime", label: "命令运行环境（Git + Bash）", required: true, status: "unknown",
        detail: error instanceof Error ? error.message : "运行环境检测失败，请重新检测",
        fix: { auto: { strategy: "windowsRuntime" } },
      });
    }
  }

  return { items, distro, probedAt: Date.now() };
}
