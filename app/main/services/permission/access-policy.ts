import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { developmentRuntimeFor, developmentRuntimesRoot } from "./development-runtime";
import { allowedDomainsFor, sandboxProfileOptions, sshAgentSockets } from "../sandbox/compat-policy";
import type { ExecutionContext, PermissionMode } from "./execution-context";
import { emHome } from "../../utils/paths";

export type { PermissionMode } from "./execution-context";

/**
 * 三档共同的安全底线。这里只列“禁止写入”的系统控制面；普通系统文件允许读取，
 * /tmp、用户文档、开发工具链也不属于系统核心。
 */
export function protectedWriteRoots(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "win32") {
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    const systemDrive = path.win32.parse(systemRoot).root || `${process.env.SystemDrive || "C:"}\\`;
    return [
      systemRoot,
      path.win32.join(systemDrive, "ProgramData"),
      path.win32.join(systemDrive, "Recovery"),
      path.win32.join(systemDrive, "PerfLogs"),
      ...windowsDriveRoots(platform).flatMap((root) => [
        path.win32.join(root, "System Volume Information"),
        path.win32.join(root, "$Recycle.Bin"),
      ]),
    ];
  }
  if (platform === "darwin") {
    return [
      "/System", "/Library", "/bin", "/sbin",
      "/usr/bin", "/usr/sbin", "/usr/lib", "/usr/libexec", "/usr/share",
      "/etc", "/private/etc", "/private/var/db", "/private/var/root",
      "/private/var/at", "/private/var/audit", "/private/var/log", "/private/var/run",
      "/private/var/vm", "/private/var/protected", "/private/var/networkd",
      "/cores",
    ];
  }
  return [
    "/boot", "/etc", "/bin", "/sbin", "/lib", "/lib32", "/lib64",
    "/usr/bin", "/usr/sbin", "/usr/lib", "/usr/lib32", "/usr/lib64", "/usr/share",
    "/var/lib", "/var/spool", "/var/log", "/var/run", "/run",
    "/proc/sys", "/sys", "/root", "/lost+found",
  ];
}

/** 原始设备不能通过“完全访问”获得写权限；按启动时实际存在的设备展开，避免 glob 后端差异。
 *  导出给命令预检复用（完全访问不进沙盒后，写裸设备也要在执行前拦掉）。 */
export function protectedDevicePaths(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "win32") return [];
  const fixed = ["/dev/mem", "/dev/kmem", "/dev/port", "/dev/kmsg", "/dev/mapper", "/dev/disk"];
  try {
    const dynamic = fs.readdirSync("/dev")
      .filter((name) => /^(?:disk|rdisk|sd[a-z]|nvme|vd[a-z]|xvd[a-z]|mmcblk)/.test(name))
      .map((name) => path.join("/dev", name));
    return [...fixed, ...dynamic];
  } catch {
    return fixed;
  }
}

/** 高敏凭据保留给受限认证能力，普通工具与脚本不可直接读写。 */
export function protectedCredentialPaths(platform: NodeJS.Platform = process.platform): string[] {
  const home = os.homedir();
  const common = [
    ".ssh", ".aws", ".gnupg", ".gnupg2", ".kube", ".docker",
    path.join(".config", "gcloud"), path.join(".config", "gh"),
    ".netrc", ".npmrc", ".pypirc", ".git-credentials", ".curlrc", ".wgetrc",
    ".zshrc", ".zprofile", ".bashrc", ".bash_profile", ".profile",
  ].map((p) => path.join(home, p));
  // EM 自己的全局配置**单独列出**：它们的根目录可被 EASYMINT_HOME 覆盖，不能假设在 home 下——
  // 否则换了数据目录之后，这些含凭据的文件会整批掉出保护名单（`path.join` 也不接受绝对路径拼接）。
  common.push(
    path.join(emHome(), "em-settings.json"),
    path.join(emHome(), "mcp-oauth.json"),
    path.join(emHome(), "environment.sh"),
    path.join(emHome(), ".control-tmp"),
    path.join(emHome(), "agent", "auth.json"),
  );
  if (platform === "darwin") common.push(path.join(home, "Library", "Keychains"));
  if (platform === "win32") {
    if (process.env.APPDATA) common.push(path.join(process.env.APPDATA, "Microsoft", "Credentials"));
    if (process.env.LOCALAPPDATA) common.push(path.join(process.env.LOCALAPPDATA, "Microsoft", "Credentials"));
  }
  return common;
}

/**
 * 能在**后续会话或开机**时执行任意代码、或**持久化影响模型行为**的载体：MCP 配置（决定下次会话
 * 启动哪些本地进程）、EasyMint 的模型/供应商设置（能把请求转发到别的端点）、自启目录（开机即执行）。
 *
 * 它们不是"系统核心"，但改一次就等于把整个判定层绕过去——所以归到"危险操作"一侧，
 * **完全访问也保留保护**（2026-09-16 用户口径：除系统核心与危险操作外全放开）。
 */
export function protectedPersistencePaths(cwd: string, platform: NodeJS.Platform = process.platform): string[] {
  const home = os.homedir();
  const paths = [
    path.join(emHome(), "mcp.json"),
    // MCP server 自述缓存：`describeServers` 会把它的首句拼进 search_mcp_tools 的**工具说明**
    // （每轮请求都随行），搜索结果里还会给全文（≤2000 字符）。键里的 definitionFingerprint 可由
    // 可读的 mcp.json 现算，所以能直接改已有条目的值 —— 等于一条**绕开审批门**的持久化提示词
    // 注入通道（`description` 已纳入指纹要重新确认，这个文件此前两条路都没覆盖到）。
    path.join(emHome(), "mcp-instructions.json"),
    path.join(emHome(), "agent", "settings.json"),
    path.join(emHome(), "agent", "models.json"),
    path.join(home, ".config", "autostart"),
    path.join(home, ".config", "systemd"),
    path.join(home, ".config", "environment.d"),
    path.join(home, ".local", "share", "systemd"),
    path.join(home, ".pam_environment"),
    path.join(home, "Library", "LaunchAgents"),
    path.join(home, "Library", "LaunchDaemons"),
    path.join(cwd, ".easymint", "mcp.json"),
    // 网络白名单（项目级）：改它 = 给后续所有沙盒命令放行新的出口域名。
    // 它与 MCP 配置同属"**后续执行能力**的载体"——而标准档的沙盒进程自己能写工作区，
    // 所以不保护它 = 沙盒里的进程可以自己把出口放宽（自审时发现的缺口，2026-09-17）。
    path.join(cwd, ".easymint", "sandbox.json"),
    // 兼容 Claude/OMP 的项目级 MCP 配置。EasyMint 只读它，但它会决定下次会话
    // 可以启动哪些本地进程，因此不能由 Agent 通过普通文件工具持久化修改。
    path.join(cwd, ".mcp.json"),
  ];
  if (platform === "win32") {
    const appData = process.env.APPDATA || path.win32.join(home, "AppData", "Roaming");
    paths.push(path.win32.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup"));
  }
  return paths;
}

/** EasyMint 的会话状态（缓存、提示词覆盖）。改它不构成提权，完全访问下放开。 */
export function protectedStatePaths(): string[] {
  return [
    path.join(emHome(), "session-cache"),
    path.join(emHome(), "system-prompts.json"),
  ];
}

/**
 * EasyMint 与 shell 的持久控制面（两者合并，标准模式用）。
 * 它们不一定含凭据，所以仍可由只读工具检查，但普通文件工具和沙盒进程不能改写；
 * 修改应走宿主提供的专用、结构化能力。
 */
export function protectedControlPaths(cwd: string, platform: NodeJS.Platform = process.platform): string[] {
  return [...protectedPersistencePaths(cwd, platform), ...protectedStatePaths()];
}

/**
 * 该模式下"仍受保护"的目标集合（2026-09-16 用户口径：除系统核心与危险操作外全放开）。
 *
 * - 三档都保护：系统核心（`protectedWriteRoots`）+ 原始设备 + 持久化执行载体
 * - 标准与只读档额外：高敏凭据 + EasyMint 会话状态
 * - 完全访问**不再保护凭据**——用户明确要求"其他都放开"，读凭据属于他要打通的能力
 *   （`gh`/`git push`/本地 keychain 工具因此可用）；代价是提示注入也能读到，见文档说明
 */
export function protectedTargetsForMode(
  mode: PermissionMode,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const always = [
    ...protectedWriteRoots(platform),
    ...protectedDevicePaths(platform),
    ...protectedPersistencePaths(cwd, platform),
  ];
  return mode === "full" ? always : [...always, ...protectedCredentialPaths(platform), ...protectedStatePaths()];
}

/**
 * 可写根（标准 / 只读档）——**沙盒的 allowWrite 与判定层的「区外写」共用这一份**。
 *
 * 两处必须同源，否则同一个 `> /tmp/x` 会出现两套拒绝语义（判定层拒、沙盒放行，或反之），
 * 用户与模型都会看不懂（这正是历史上"命令被拦但报错口径不一致"的来源）。
 *
 * 系统临时目录是 2026-09-17 新加的（Codex 官方口径：工作区含 `cwd` 与 `/tmp` 等临时目录）：
 * 写 `/tmp/xxx` 是开发常规动作（进程间传文件、工具链 scratch），拦它属于纯误伤。
 * macOS 上 `/tmp` 是 `/private/tmp` 的符号链接，两个都要列（canonicalPolicyPath 会解符号链接）。
 */
export function standardWriteRoots(
  workspaceRealPath: string,
  runtimeRoot: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === "win32") {
    const temp = process.env.TEMP || process.env.TMP || path.win32.join(os.homedir(), "AppData", "Local", "Temp");
    return [...new Set([workspaceRealPath, runtimeRoot, temp])];
  }
  return [...new Set([workspaceRealPath, runtimeRoot, "/tmp", "/var/tmp", "/private/tmp", "/private/var/tmp"])];
}

export function buildExecutionPolicy(context: Pick<ExecutionContext, "mode" | "workspaceRealPath" | "runtimeRoot">): SandboxRuntimeConfig {
  const { mode, workspaceRealPath, runtimeRoot } = context;
  const credentials = protectedCredentialPaths();
  const runtimesRoot = developmentRuntimesRoot();
  const allowWrite = mode === "full"
    ? filesystemRoots(workspaceRealPath)
    : standardWriteRoots(workspaceRealPath, runtimeRoot);
  return {
    // 网络面（2026-09-17 补齐）。过去三平台的配置分别是：
    //   macOS  → `allowedDomains: undefined`：srt 视作"未配置网络限制" ⇒ seatbelt `allow network*` 全放；
    //   Linux  → `allowedDomains: ["*"]`：看似有配置，实为逐条放行（且 `*` 本身就违反 srt 的
    //            schema 意图——它明确拒绝"过宽模式"）。
    //   ⇒ 净效果是**沙盒拦得住"碰你机器上的东西"，却完全拦不住"把你项目里的东西送出去"**，
    //     而后者才是提示注入的出口（详见 temp/权限模式复盘…md §三）。
    // 现在统一走真实白名单：`allowedDomains` 一旦有值，srt 就启用它的内置 HTTP+SOCKS mux 代理
    // （sandbox-manager 的 `needsNetworkRestriction = allowedDomains !== undefined`），
    // seatbelt 只在代理端口上放行出网，实际可达域名由代理判定。
    network: {
      // 完全访问不套沙盒 ⇒ 这份配置不会被使用（注意 `[]` 在 srt 里是"全断网"语义，别外泄出去）。
      // 保留空数组只是让配置形状完整；真要给 full 定义网络策略是另一件事。
      allowedDomains: mode === "full" ? [] : allowedDomainsFor(workspaceRealPath),
      deniedDomains: [],
      // 未匹配域名**直接拒绝**，不落回调。EM 不传 sandboxAskCallback，这里显式化语义：
      // 不引入逐条审批（用户明确不接受），未知域名失败但可见（stderr 注解 + 域名清单可扩展）。
      strictAllowlist: true,
      // 开发服务器必须能监听本机端口；同时 srt 会额外放行"回环出站"，
      // 所以 `curl localhost:3000` 这类本机互访不受白名单影响。
      allowLocalBinding: true,
      // **唯一放行的 unix socket 是 ssh-agent**（取舍与发现逻辑见 compat-policy）：
      // 让 `git push` / `fetch` 借用 agent 签名，而私钥不进会话环境。
      // ⚠️ 空数组意味着 srt 禁掉**全部** unix socket（docker.sock、gradle daemon 等一并不可用）——
      //    这是有意的：那些 socket 能直接控制宿主服务，不该为了顺手而打开。
      allowUnixSockets: mode === "full" ? [] : sshAgentSockets(),
    },
    filesystem: {
      // EasyMint 自己按绝对资源保护安全边界；工作区内 .git/config 等开发文件需要正常可写。
      allowGitConfig: true,
      denyRead: mode === "full" ? credentials : [...credentials, runtimesRoot],
      allowRead: mode === "full" ? [] : [runtimeRoot],
      allowWrite,
      denyWrite: [
        ...protectedWriteRoots(),
        ...windowsVolumeMetadataPaths(allowWrite),
        ...protectedDevicePaths(),
        ...credentials,
        ...protectedControlPaths(workspaceRealPath),
        ...(mode === "full" ? [] : sandboxRuntimeDefaultWriteLeaks()),
      ],
    },
    // profile 兼容性选项（PTY 等）——逐条依据见 compat-policy；缺了它交互式工具会在沙盒里表现异常
    ...sandboxProfileOptions(),
  };
}

/** sandbox-runtime 为兼容性自动开放的宿主写路径；标准模式已有自己的运行区，不需要这些例外。 */
function sandboxRuntimeDefaultWriteLeaks(): string[] {
  const home = os.homedir();
  return [
    "/tmp/claude",
    "/private/tmp/claude",
    path.join(home, ".npm", "_logs"),
    path.join(home, ".claude", "debug"),
  ];
}

function filesystemRoots(
  workspaceRealPath: string,
  platform: NodeJS.Platform = process.platform,
  discoveredDriveRoots: readonly string[] = windowsDriveRoots(platform),
): string[] {
  if (platform !== "win32") return ["/"];
  const roots = new Set<string>();
  // Windows 可以把项目放在与系统盘、用户目录不同的卷上。完全访问至少必须覆盖
  // 当前工作区所在卷，否则从 standard 切到 full 反而会失去项目写权限。
  for (const value of [
    process.env.SystemDrive,
    path.win32.parse(os.homedir()).root,
    path.win32.parse(workspaceRealPath).root,
    ...discoveredDriveRoots,
  ]) {
    if (value) roots.add(value.endsWith("\\") ? value : `${value}\\`);
  }
  return [...roots];
}

/** 查询当前可用的 Windows 文件系统卷；失败时仍由系统盘、HOME 与工作区卷兜底。 */
function windowsDriveRoots(platform: NodeJS.Platform = process.platform): string[] {
  if (platform !== "win32") return [];
  if (cachedWindowsDriveRoots) return [...cachedWindowsDriveRoots];
  try {
    const probe = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; [IO.DriveInfo]::GetDrives() | Where-Object { $_.IsReady } | ForEach-Object { $_.RootDirectory.FullName }"],
      { encoding: "utf8", timeout: 3000, windowsHide: true },
    );
    if (probe.status !== 0) return [];
    cachedWindowsDriveRoots = [...new Set(probe.stdout.split(/\r?\n/).map((value) => value.trim()).filter((value) => /^[A-Za-z]:\\$/.test(value)))];
    return [...cachedWindowsDriveRoots];
  } catch {
    return [];
  }
}

let cachedWindowsDriveRoots: string[] | undefined;

function windowsVolumeMetadataPaths(roots: readonly string[], platform: NodeJS.Platform = process.platform): string[] {
  if (platform !== "win32") return [];
  return roots.flatMap((root) => /^[A-Za-z]:\\$/.test(root) ? [
    path.win32.join(root, "System Volume Information"),
    path.win32.join(root, "$Recycle.Bin"),
  ] : []);
}

/** 规范化用于策略提前判定；真实强制边界仍由 OS 沙盒负责。 */
export function canonicalPolicyPath(input: string, cwd: string): string {
  let expanded = input.trim();
  if (expanded === "~") expanded = os.homedir();
  else if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
    expanded = path.join(os.homedir(), expanded.slice(2));
  }
  const absolute = path.resolve(cwd, expanded);
  let cursor = absolute;
  const suffix: string[] = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  try {
    return path.join(fs.realpathSync.native(cursor), ...suffix);
  } catch {
    return absolute;
  }
}

export function isWithin(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function pathHitsAny(candidate: string, roots: readonly string[], cwd: string): boolean {
  const target = canonicalPolicyPath(candidate, cwd);
  return roots.some((root) => isWithin(canonicalPolicyPath(root, cwd), target));
}

/**
 * 完整访问（standard / readonly）档的可写目标判定。
 * 与沙盒的 `allowWrite` 同源（`standardWriteRoots`）——两处必须一致，否则同一操作两套语义。
 */
export function isStandardWritableTarget(cwd: string, candidate: string): boolean {
  const workspace = canonicalPolicyPath(cwd, cwd);
  const target = canonicalPolicyPath(candidate, cwd);
  const runtime = canonicalPolicyPath(developmentRuntimeFor(workspace).root, workspace);
  return standardWriteRoots(workspace, runtime).some((root) => isWithin(canonicalPolicyPath(root, cwd), target));
}

export const accessPolicyInternals = { filesystemRoots, windowsDriveRoots, windowsVolumeMetadataPaths };
