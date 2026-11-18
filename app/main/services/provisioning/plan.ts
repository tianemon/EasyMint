/**
 * 依赖安装的「计划」层：发行版识别 + 白名单命令生成。**纯函数，便于单测**。
 *
 * 安全规则（方案 §8）：命令模板与包名全部是代码常量；本文件产出的 argv 是唯一被允许执行的形态；
 * 渲染层永远不能传命令片段——只能传 EnvItemId，未知 id 一律拒绝（返回 null → 界面转「自助安装」）。
 */
import fs from "node:fs";
import path from "node:path";
import type { EnvDistro, EnvItemId } from "./types";

/** 条目 → 包名。四个包管理器家族（apt/dnf/pacman/zypper）这三项包名一致；
 *  新增家族或新增条目时**必须逐家核对包名**，核不到就走 manual，不要猜。 */
const PACKAGE_OF: Partial<Record<EnvItemId, string>> = {
  bwrap: "bubblewrap",
  socat: "socat",
  rg: "ripgrep",
  // userns：需改系统安全配置（AppArmor/sysctl），**只展示给用户，不代执行** → 无包名
};

/** 发行版家族 → 包管理器（绝对路径候选按顺序取第一个存在的） */
const INSTALLER_CANDIDATES: Record<string, string[]> = {
  apt: ["/usr/bin/apt-get", "/usr/bin/apt"],
  dnf: ["/usr/bin/dnf", "/usr/bin/dnf5"],
  pacman: ["/usr/bin/pacman"],
  zypper: ["/usr/bin/zypper"],
};

/** os-release ID → 包管理器家族；同族发行版按 ID_LIKE 兜底 */
const FAMILY_BY_ID: Record<string, keyof typeof INSTALLER_CANDIDATES> = {
  ubuntu: "apt", debian: "apt", linuxmint: "apt", pop: "apt", kali: "apt", raspbian: "apt",
  fedora: "dnf", rhel: "dnf", centos: "dnf", rocky: "dnf", almalinux: "dnf", nobara: "dnf",
  arch: "pacman", manjaro: "pacman", endeavouros: "pacman", cachyos: "pacman",
  opensuse: "zypper", "opensuse-leap": "zypper", "opensuse-tumbleweed": "zypper", sles: "zypper",
};

/** 安装器 argv 模板（包名由调用方追加） */
const INSTALL_ARGS: Record<keyof typeof INSTALLER_CANDIDATES, string[]> = {
  apt: ["install", "-y", "--no-install-recommends"],
  dnf: ["install", "-y"],
  pacman: ["-S", "--noconfirm", "--needed"],
  zypper: ["--non-interactive", "install", "-y"],
};

export interface Installer {
  kind: keyof typeof INSTALLER_CANDIDATES;
  /** 包管理器绝对路径（pkexec 不继承 PATH、且要求绝对路径，故必须解析出来） */
  path: string;
  args: string[];
}

/** 解析 /etc/os-release（key=value，值可能带引号） */
export function parseOsRelease(text: string): { id: string; versionId?: string; idLike: string[] } {
  const map: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    map[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
  return {
    id: (map.ID ?? "").toLowerCase(),
    versionId: map.VERSION_ID || undefined,
    idLike: (map.ID_LIKE ?? "").toLowerCase().split(/\s+/).filter(Boolean),
  };
}

export function readDistro(
  readFile: (p: string) => string = (p) => fs.readFileSync(p, "utf-8"),
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = fs.existsSync,
): EnvDistro {
  if (platform !== "linux") {
    // macOS 用系统 Seatbelt、Windows 走 srt-sandbox，都没有"发行版包管理器"这一层
    return { id: platform === "darwin" ? "macos" : "windows", idLike: [], autoInstallable: false };
  }
  try {
    const parsed = parseOsRelease(readFile("/etc/os-release"));
    return {
      id: parsed.id || "unknown",
      idLike: parsed.idLike,
      versionId: parsed.versionId,
      autoInstallable: resolveInstaller(parsed, exists) !== null,
    };
  } catch {
    return { id: "unknown", idLike: [], autoInstallable: false };
  }
}

export function resolveInstaller(
  os: { id: string; idLike: string[] },
  exists: (p: string) => boolean = fs.existsSync,
): Installer | null {
  const family = FAMILY_BY_ID[os.id] ?? os.idLike.map((v) => FAMILY_BY_ID[v]).find(Boolean);
  if (!family) return null;
  const found = INSTALLER_CANDIDATES[family]!.find((p) => exists(p));
  if (!found) return null;
  return { kind: family, path: found, args: INSTALL_ARGS[family]! };
}

/**
 * 生成安装 argv：`pkexec <包管理器绝对路径> <参数> <包名…>`。
 * - 返回 null = 不允许自动安装（未知条目 / 需人工处理的条目 / 无可用包管理器）→ 界面转自助安装。
 * - 只用 argv（不拼 shell 字符串），包名来自常量表，杜绝任意命令。
 */
export function buildInstallArgv(
  ids: readonly string[],
  installer: Installer | null,
  pkexecPath = "/usr/bin/pkexec",
): string[] | null {
  if (ids.length === 0) return null;
  const packages: string[] = [];
  for (const id of ids) {
    const pkg = PACKAGE_OF[id as EnvItemId];
    if (!pkg) return null; // 白名单外 / 不可自动安装 → 整批拒绝，不做部分猜测
    if (!packages.includes(pkg)) packages.push(pkg);
  }
  return buildPackageArgv(packages, installer, pkexecPath);
}

/**
 * 由**包名常量**直接构造安装 argv（供白名单常量之外的固定包使用，如 AppArmor profile 来源包）。
 * 与 buildInstallArgv 共用同一条执行路径：包名只能是本文件里的常量，调用方无法传任意包名。
 */
export function buildPackageArgv(
  packages: readonly string[],
  installer: Installer | null,
  pkexecPath = "/usr/bin/pkexec",
): string[] | null {
  if (packages.length === 0 || !installer) return null;
  return [pkexecPath, installer.path, ...installer.args, ...packages];
}

/** pkexec 的绝对路径候选（由 polkit 提供） */
const PKEXEC_CANDIDATES = ["/usr/bin/pkexec", "/bin/pkexec"];

/**
 * 返回可用的 pkexec 绝对路径；机器上没有则 null。
 *
 * **为什么必须探测它（2026-09-15 补）**：上面那条 argv 把 `/usr/bin/pkexec` 写死，而界面此前只看
 * 「包在白名单里」就给「一键安装 / 一键修复」。可 WSL、精简镜像、没装 polkit 的桌面上这个文件压根
 * 不存在——用户点了必然失败，还会以为是自己的权限问题；而这类机器**其实有 sudo，手工命令一贴就成**。
 * 所以判据要落到"这台机器上到底有没有能弹授权的那个程序"，而不是"发行版是不是我们认识的"。
 */
export function resolvePkexec(exists: (p: string) => boolean = fs.existsSync): string | null {
  return PKEXEC_CANDIDATES.find((p) => exists(p)) ?? null;
}

// ── userns 放行（AppArmor profile）：应用内一键修复用 ────────────────────────────
//
// 背景：Ubuntu 24.04+ 的 AppArmor 默认禁止非特权进程创建 user namespace。官方做法是加载
// `bwrap-userns-restrict` 这份 profile（只给 /usr/bin/bwrap 放行），**而不是**把限制全局关掉。
// deb 安装期由 build/linux-after-install.sh 自动落；AppImage / tar.gz / 源码运行拿不到那一步，
// 所以应用内再给一条"一键修复"通道——每条都是**绝对路径单命令**，经 pkexec 由系统弹授权框。
//
// 为什么不把这几步写成脚本 / 不调用应用自带文件：pkexec 是以 root 执行你给的第一个参数，
// 若该文件位于用户可写目录（AppImage、解包目录），等于让 root 执行用户可改的代码。

const USERNS_PROFILE_DEST = "/etc/apparmor.d/bwrap-userns-restrict";

/** profile 模板的候选来源（按顺序取第一个存在的）。都是发行版包提供的内容——EM 不自带、不自己编策略 */
const USERNS_PROFILE_SRC_CANDIDATES = [
  "/usr/share/apparmor/extra-profiles/bwrap-userns-restrict",
  "/usr/share/doc/apparmor-profiles/extras/bwrap-userns-restrict",
];

/** 提供 profile 模板的包（Ubuntu 24.04 的 apparmor-profiles；25.04+ 由 apparmor 包自带该 profile） */
export const APPARMOR_PROFILES_PACKAGE = "apparmor-profiles";

const INSTALL_BIN_CANDIDATES = ["/usr/bin/install", "/bin/install"];
const APPARMOR_PARSER_CANDIDATES = ["/usr/sbin/apparmor_parser", "/sbin/apparmor_parser", "/usr/bin/apparmor_parser"];

const firstExisting = (cands: readonly string[], exists: (p: string) => boolean): string | null =>
  cands.find((p) => exists(p)) ?? null;

/** 本地是否已有 profile 模板（决定要不要先装 apparmor-profiles） */
export function resolveUsernsProfileSource(exists: (p: string) => boolean = fs.existsSync): string | null {
  return firstExisting(USERNS_PROFILE_SRC_CANDIDATES, exists);
}

/** 目标 profile 是否已存在（已存在就整条跳过——可能是系统自带，也可能用户改过，不覆盖） */
export function usernsProfileInstalled(exists: (p: string) => boolean = fs.existsSync): boolean {
  return exists(USERNS_PROFILE_DEST);
}

/** `pkexec apt-get install -y apparmor-profiles`（拿 profile 模板；无包管理器时返回 null） */
export function usernsInstallSourceArgv(
  installer: Installer | null,
  pkexecPath = "/usr/bin/pkexec",
): string[] | null {
  return buildPackageArgv([APPARMOR_PROFILES_PACKAGE], installer, pkexecPath);
}

/** `pkexec /usr/bin/install -m 0644 <src> /etc/apparmor.d/bwrap-userns-restrict`（不用 shell 重定向） */
export function usernsCopyArgv(
  src: string,
  exists: (p: string) => boolean = fs.existsSync,
  pkexecPath = "/usr/bin/pkexec",
): string[] | null {
  const installBin = firstExisting(INSTALL_BIN_CANDIDATES, exists);
  if (!installBin) return null;
  return [pkexecPath, installBin, "-m", "0644", src, USERNS_PROFILE_DEST];
}

/** `pkexec /usr/sbin/apparmor_parser -r /etc/apparmor.d/bwrap-userns-restrict`（-r 未加载时会新建） */
export function usernsLoadArgv(
  exists: (p: string) => boolean = fs.existsSync,
  pkexecPath = "/usr/bin/pkexec",
): string[] | null {
  const parser = firstExisting(APPARMOR_PARSER_CANDIDATES, exists);
  if (!parser) return null;
  return [pkexecPath, parser, "-r", USERNS_PROFILE_DEST];
}

/**
 * 应用内能否自助修复 userns 放行：需要 `install` 与 `apparmor_parser` 都在，
 * 且要么本地已有 profile 模板、要么能装到模板（有可用包管理器）。
 * false → 界面只展示官方三步命令（见 probe 的 manual）。探测用纯函数，便于单测。
 */
export function usernsFixAvailable(
  installer: Installer | null,
  exists: (p: string) => boolean = fs.existsSync,
): boolean {
  if (usernsProfileInstalled(exists)) return false; // 已装好还报 blocked → 不是这一层的问题
  if (!resolvePkexec(exists)) return false;         // 没有能弹授权的 pkexec → 只能照手工三步自己来
  if (!usernsCopyArgv("/x", exists) || !usernsLoadArgv(exists)) return false;
  return resolveUsernsProfileSource(exists) !== null || usernsInstallSourceArgv(installer) !== null;
}

/** 官方三步命令（应用内一键修复不可用/失败时的自助指引）。与 build/linux-after-install.sh 同源 */
export function usernsManualCommand(): string {
  return [
    `sudo apt-get install -y ${APPARMOR_PROFILES_PACKAGE}`,
    `sudo install -m 0644 ${USERNS_PROFILE_SRC_CANDIDATES[0]} ${USERNS_PROFILE_DEST}`,
    `sudo apparmor_parser -r ${USERNS_PROFILE_DEST}`,
  ].join("\n");
}

/** 界面展示用（复制到终端可执行的字符串）。只用引号包裹，不引入任何 shell 语法 */
export function formatCommand(argv: readonly string[]): string {
  return argv.map((a) => (/[\s"'$`\\]/.test(a) ? `'${a.replace(/'/g, `'\\''`)}'` : a)).join(" ");
}

/**
 * 某条目"能自动装"时的 fix.auto —— 包名以本文件白名单为**唯一来源**（probe 不重复维护包名）。
 * 不在白名单里（如需改系统安全配置的 userns、或平台专属项）返回 undefined。
 */
export function autoFixFor(id: EnvItemId): { strategy: "pkg"; packages: string[] } | undefined {
  const pkg = PACKAGE_OF[id];
  return pkg ? { strategy: "pkg", packages: [pkg] } : undefined;
}

/** 无 polkit（无桌面/企业镜像）时的自助安装命令：去掉 pkexec，让用户自己 sudo */
export function manualInstallCommand(ids: readonly string[], installer: Installer | null): string | null {
  const argv = buildInstallArgv(ids, installer, "sudo");
  return argv ? formatCommand(argv) : null;
}

/**
 * Windows 手动安装命令（srt 的一次性装配：`srt-sandbox` 隔离账户 + WFP 网络过滤，装时弹一次 UAC）。
 *
 * 为什么不用 srt 的 `windowsInstallInstructions()` 原文（2026-09-15 改）：
 * ① 它给的包名是**非作用域的 `sandbox-runtime`** —— npm 上那个名字是别人的 "Empty package"
 *    （维护者与本项目无关），照着跑等于把陌生人的代码拉下来执行；
 * ② 它是「英文散文 + 命令」的多行文本，而界面把 `manual.command` **整块**当代码给用户复制
 *    （`EnvPanel` 的 `<code>` + 复制按钮），连散文一起粘进终端第一行就不是命令。
 *
 * 另外两个必须是这个形态：
 * - `--yes`：npx 在本地没有该包时会交互式询问。用户是"从设置页复制到终端"跑的，
 *   遇到询问的观感就是"没反应/报错"——用户实测拿到的正是 npm 11 的
 *   `npx canceled due to missing packages and no YES option`（此前字符串里写的是已废弃的
 *   `--no-install`，npm 把它译成 `--yes false`，必失败）。
 * - 钉版本：见 `packagedSrtVersion()` 的说明；传 undefined 时才退化为 latest。
 */
export function windowsInstallCommand(version?: string): string {
  const spec = version ? `@anthropic-ai/sandbox-runtime@${version}` : "@anthropic-ai/sandbox-runtime";
  return `npx --yes ${spec} windows-install --skip-profile-grant${version ? " --force" : ""}`;
}

/**
 * 少数「不走包管理器白名单」的发行版的手工安装命令（**只展示、不代执行**）。
 *
 * 为什么只写 NixOS：命令里的包名必须**逐个核过**（与本文件白名单同一条纪律：核不到就不写，
 * 继续退给 distroHint 的包名提示）。已核（2026-09-15 实查）：nixpkgs 的 `bubblewrap` / `socat` /
 * `ripgrep` 三个 by-name 位置都在（`pkgs/by-name/{bu,so,ri}/…`）。
 * 刻意**不列 Alpine（apk）**：那三个包 Alpine 确实都有，但 Electron 本身是 glibc 程序，
 * 原版 Alpine（musl）上根本跑不起来 EasyMint，列出来是误导。
 */
const DISTRO_MANUAL_COMMAND: Record<string, (packages: readonly string[]) => string> = {
  nixos: (packages) => `nix profile install ${packages.map((p) => `nixpkgs#${p}`).join(" ")}`,
};

/** 该发行版是否有「核过包名」的手工命令（界面据此决定还要不要再补一句泛泛的包名提示） */
export function hasDistroManualCommand(distro: { id: string; idLike?: string[] }): boolean {
  return Boolean(DISTRO_MANUAL_COMMAND[distro.id] ?? DISTRO_MANUAL_COMMAND[distro.idLike?.[0] ?? ""]);
}

/** 该发行版的手工安装命令；没有（未核过包名）或条目里含非包类项（如 userns）→ null */
export function distroManualInstallCommand(
  distro: { id: string; idLike?: string[] },
  ids: readonly string[],
): string | null {
  const make = DISTRO_MANUAL_COMMAND[distro.id] ?? DISTRO_MANUAL_COMMAND[distro.idLike?.[0] ?? ""];
  if (!make) return null;
  // id 可能是渲染层传来的任意串（执行层拿到的是未校验的 string[]）：查不到白名单就整批拒绝
  const packages = ids.map((id) => PACKAGE_OF[id as EnvItemId]).filter((p): p is string => Boolean(p));
  // 只要有一个条目不是"装个包"能解决的（例如 userns 要改系统安全配置），整批不给命令
  return packages.length > 0 && packages.length === ids.length ? make(packages) : null;
}

/** 各发行版的"没有包管理器时的兜底指引"（只展示，不执行） */
export function distroHint(distroId: string): string {
  const name = path.basename(distroId || "linux");
  return `未识别的发行版（${name}）：请用你的包管理器安装 bubblewrap、socat、ripgrep，或从源码安装后确保它们在 PATH 中`;
}
