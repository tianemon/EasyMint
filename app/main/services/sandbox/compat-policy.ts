/**
 * 沙盒兼容性策略——让「标准模式」在真实开发里能干活的那一层。
 *
 * 来历：Codex 的 `codex-rs/sandboxing/src/seatbelt_base_policy.sbpl` 逐条列着
 * "Python 的 ProcessPoolExecutor 要这个 sysctl"、"Java 读 CPU 信息"、"PyTorch/libomp 要
 * ipc-posix-shm"、"交互式 shell 要 pseudo-tty"——**默认沙盒能正常开发不是自然结果，
 * 而是一份持续维护的豁免清单**（原话："instead of broadly allowing /System"）。
 * EM 过去缺的正是这一层，所以沙盒一开就"什么都做不了"。本文件是那份清单的落点。
 *
 * 三个部分，各有明确边界：
 * 1. `DEVELOPMENT_ALLOWED_DOMAINS` —— 网络面白名单（**沙盒过去完全没有这一半**，
 *    见 managers 的 network 注释：`allowedDomains: undefined` ⇒ seatbelt `allow network*`）。
 * 2. `sandboxProfileOptions()` —— 沙盒 profile 的兼容选项（PTY 等）。
 * 3. `isSandboxExcludedCommand()` —— **沙盒外豁免**（浏览器/容器这类"必须自建沙盒"的命令）。
 *
 * ⚠️ 三条硬约束（改动本文件前先读）：
 * - **只有「沙盒内确实跑不了」的单一命令才进豁免表**。任何管道、重定向、命令替换或复合命令
 *   都不得豁免，避免 `open URL && payload` 借首命令把整条 shell 移出沙盒。
 * - **域名白名单是"提高门槛"，不是"保证拦住"**。代理只按客户端给的主机名判定，存在
 *   domain fronting、TLS 不解密等已知弱点（Claude Code 官方文档同样如此自我描述）。
 * - **两种模式共用本文件**：完全访问不套沙盒，因此这一层对它不生效（不是"也给它开白名单"）。
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { parse as parseShell } from "shell-quote";
import { readExternalField } from "../em-settings-schema";

/**
 * 常用开发基础设施白名单。
 *
 * 取舍原则：**攻击者控制的域名不可能在这里**（evil.com 永远进不来），所以白名单足够宽是安全的；
 * 真正要防的是"被注入的 Agent 把数据发到陌生域名"——白名单挡住的就是那一条。
 * 因此这里按"主流生态 + 国内镜像"给足，避免出现"装不上依赖"这类误伤（那正是历史上
 * "什么都做不了"的来源）。
 *
 * 通配符语义（见 srt 的 domain-pattern）：`*.example.com` 匹配**严格子域**，
 * **不匹配** `example.com` 本身——所以基础设施域名通常要写两条。
 */
export const DEVELOPMENT_ALLOWED_DOMAINS: readonly string[] = [
  // ── Node / JS 生态 ──────────────────────────────────────────────
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  // 国内镜像必须写三条：registry 域只给元数据，tarball 落在 cdn 子域（2026-09-17 实测
  // `npm i` 卡在 cdn.npmmirror.com，且**元数据能取、包取不到**，现象看着像网络正常）；
  // 裸域是 Electron 等二进制的镜像入口（`.npmrc` 里 `electron_mirror` 指向它）。
  // 通配符只匹配严格子域、不匹配裸域，所以三条都要写——缺任一条都表现为「装不上依赖」。
  "registry.npmmirror.com",
  "npmmirror.com",
  "*.npmmirror.com",
  "registry.npm.taobao.org",
  "npmjs.com",
  "www.npmjs.com",
  "unpkg.com",
  "cdn.jsdelivr.net",
  "esm.sh",
  "esm.run",
  "cdnjs.cloudflare.com",
  "cdn.skypack.dev",
  "nodejs.org",
  "*.nodejs.org",
  "bun.sh",
  "deno.land",
  "dl.deno.land",
  "jsr.io",
  "npm.pkg.github.com",

  // ── Python ─────────────────────────────────────────────────────
  "pypi.org",
  "files.pythonhosted.org",
  "pypi.tuna.tsinghua.edu.cn",
  "mirrors.aliyun.com",
  "mirrors.cloud.tencent.com",
  "mirrors.tuna.tsinghua.edu.cn",
  "mirrors.ustc.edu.cn",
  "repo.anaconda.com",
  "conda.anaconda.org",

  // ── JVM / Android ──────────────────────────────────────────────
  "repo.maven.apache.org",
  "repo1.maven.org",
  "maven.aliyun.com",
  "plugins.gradle.org",
  "services.gradle.org",
  "repo.gradle.org",
  "dl.google.com",
  "maven.google.com",

  // ── Rust / Go / 其他语言 ────────────────────────────────────────
  "crates.io",
  "static.crates.io",
  "index.crates.io",
  "sh.rustup.rs",
  "static.rust-lang.org",
  "proxy.golang.org",
  "sum.golang.org",
  "goproxy.cn",
  "goproxy.io",
  "go.dev",
  "api.nuget.org",
  "nuget.org",
  "rubygems.org",
  "index.rubygems.org",
  "getcomposer.org",
  "repo.packagist.org",
  "hex.pm",
  "repo.hex.pm",
  "pub.dev",
  "pub.dartlang.org",

  // ── 代码托管 ────────────────────────────────────────────────────
  "github.com",
  "*.github.com",
  "*.githubusercontent.com",
  "codeload.github.com",
  "api.github.com",
  "gist.github.com",
  "gitlab.com",
  "*.gitlab.com",
  "bitbucket.org",
  "*.bitbucket.org",
  "gitee.com",
  "*.gitee.com",

  // ── 容器与镜像 ──────────────────────────────────────────────────
  "registry-1.docker.io",
  "auth.docker.io",
  "index.docker.io",
  "production.cloudflare.docker.com",
  "ghcr.io",
  "quay.io",
  "gcr.io",
  "*.gcr.io",
  "public.ecr.aws",
  "k8s.io",

  // ── 运行时 / 二进制分发（Electron、Playwright、字体） ────────────
  "electronjs.org",
  "*.electronjs.org",
  "storage.googleapis.com",
  "playwright.azureedge.net",
  "playwright.download.prss.microsoft.com",
  "cdn.playwright.dev",
  "fonts.googleapis.com",
  "fonts.gstatic.com",

  // ── 常见 AI / API 端点（本地开发要调；含 EM 内建联网工具与主流 MCP 的同源服务） ──
  "api.openai.com",
  "api.anthropic.com",
  "openrouter.ai",
  "generativelanguage.googleapis.com",
  "api.tavily.com",
  "api.deepseek.com",
  "api.moonshot.cn",
  "dashscope.aliyuncs.com",
  "open.bigmodel.cn",
  "api.siliconflow.cn",
  "api.githubcopilot.com",
  // ── 文档 / 社区（读文档是开发常规动作） ──────────────────────────
  "developer.mozilla.org",
  "stackoverflow.com",
  "*.stackexchange.com",
  "*.readthedocs.io",
  "*.readthedocs.org",
];

/**
 * 用户/项目追加的域名白名单（逃生口）。
 *
 * 白名单不可能穷尽（公司内网 registry、私有 API、临时 CDN 都可能需要），所以必须可扩展——
 * 否则一次真实误伤就会把用户推回"关掉沙盒"。
 *
 * 读取位置（任一存在即合并，去重）：
 * - `$EASYMINT_HOME/em-settings.json`（默认 `~/.easymint/em-settings.json`）的
 *   `sandbox.extraDomains: string[]`（全局）
 * - `<工作区>/.easymint/sandbox.json` 的 `allowedDomains: string[]`（项目级，随项目走）
 *
 * 校验与 srt 的 schema 对齐：拒绝 `*` 与 `*.com` 这类过宽模式（srt 原话：
 * "Overly broad patterns like `*.com` or `*` are not allowed for security reasons"）。
 * 非法项**忽略而不是抛错**——一个写错的设置不该让整个沙盒起不来。
 */
export function extraAllowedDomains(workspaceRealPath?: string): string[] {
  const collected: string[] = [];
  const candidates = [
    path.join(os.homedir(), ".easymint", "em-settings.json"),
    workspaceRealPath ? path.join(workspaceRealPath, ".easymint", "sandbox.json") : "",
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
      const list = file.endsWith("sandbox.json") ? raw.allowedDomains : readExternalField(raw, "sandboxExtraDomains");
      if (Array.isArray(list)) collected.push(...list.filter((v): v is string => typeof v === "string"));
    } catch {
      // 文件不存在/解析失败都按"没有额外域名"处理
    }
  }
  return [...new Set(collected.filter(isValidDomainPattern))];
}

/** 与 srt 的 `isValidDomainPattern` 同判据：不接受 `*`、`*.com` 这类过宽模式。 */
export function isValidDomainPattern(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return false;
  if (trimmed === "*" || trimmed === "*.") return false;
  if (trimmed.startsWith("*.")) {
    const base = trimmed.slice(2);
    return base.includes(".") && !base.startsWith(".") && !base.endsWith(".");
  }
  return trimmed.includes(".") && !trimmed.startsWith(".") && !trimmed.endsWith(".");
}

/** 生效的完整域名白名单（内置 + 用户/项目追加，去重）。 */
export function allowedDomainsFor(workspaceRealPath?: string): string[] {
  return [...new Set([...DEVELOPMENT_ALLOWED_DOMAINS, ...extraAllowedDomains(workspaceRealPath)])];
}

/**
 * ssh-agent 的 unix socket —— **唯一被放行的 unix socket**。
 *
 * 为什么必须放行：`git push` 走 ssh 时 OpenSSH 优先向 agent 要身份，于是**私钥不进会话环境**
 * （agent 只做签名，沙盒进程拿不到私钥本身）——比"把 `~/.ssh` 复制进运行区"安全一个量级。
 * 不放行的话，srt 的 macOS profile 默认**禁掉全部 unix socket**（`allowUnixSockets` 为空即全禁），
 * push / fetch 必然失败。
 *
 * ⚠️ **代价写清楚**：放行 agent socket ⇒ 沙盒里的进程可以用你的身份签名（能推代码、能通过任何
 * 依赖 agent 的认证），但**拿不到私钥**。这是"凭据不出域"的轻量形态，不是零风险；
 * 用户明确选了这条（2026-09-17：标准档要能 push，且不想把私钥放进会话）。
 * **不要顺手把 `allowAllUnixSockets` 打开**——那会把 docker.sock / 各种本地服务一起交出去。
 *
 * 发现顺序（macOS 从 Finder / Dock 启动的应用**不继承 shell 环境**，`SSH_AUTH_SOCK` 常常不存在）：
 * 1. `SSH_AUTH_SOCK`（终端启动 EM 时会有）
 * 2. 兜底扫 launchd 的 socket 目录（`/var/run`、`/private/tmp`、`/tmp` 下 `com.apple.launchd.` 开头的
 *    目录里的 `Listeners`）—— 系统自带的 ssh-agent 就是这种 socket 激活形态，路径带随机后缀，只能扫
 * 每个候选都要用 `ssh-add -l` 验明身份（退出码 0 / 1 = 是 agent；2 = 连不上或不是）。
 *
 * 结果按路径缓存（会话内基本不变）；缓存里的 socket 全消失时重扫一次。
 */
export function sshAgentSockets(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "win32") return []; // Windows 的 agent 走 named pipe，不是 unix socket
  if (cachedAgentSockets && cachedAgentSockets.length > 0 && cachedAgentSockets.every((socket) => fs.existsSync(socket))) {
    return cachedAgentSockets;
  }
  const candidates = new Set<string>();
  const fromEnv = process.env.SSH_AUTH_SOCK;
  if (fromEnv) candidates.add(fromEnv);
  for (const base of ["/var/run", "/private/tmp", "/tmp"]) {
    let entries: string[];
    try { entries = fs.readdirSync(base); } catch { continue; } // 目录不可读就跳过
    for (const entry of entries) {
      if (!entry.startsWith("com.apple.launchd.")) continue;
      const listener = path.join(base, entry, "Listeners");
      if (fs.existsSync(listener)) candidates.add(listener);
    }
  }
  cachedAgentSockets = [...candidates].filter(isSshAgentSocket);
  return cachedAgentSockets;
}

let cachedAgentSockets: string[] | null = null;

/** 用 `ssh-add -l` 验明候选是不是 ssh-agent（退出码判据来自 ssh-add 手册：0=有身份，1=agent 在但无身份，2=连不上）。 */
function isSshAgentSocket(socketPath: string): boolean {
  try {
    const probe = spawnSync("ssh-add", ["-l"], {
      env: { ...process.env, SSH_AUTH_SOCK: socketPath },
      encoding: "utf8",
      timeout: 2000,
      windowsHide: true,
    });
    return probe.status === 0 || probe.status === 1;
  } catch {
    return false; // ssh-add 不存在或探针异常 ⇒ 当作不是 agent
  }
}

/**
 * 沙盒 profile 的兼容性选项（对应 Codex `seatbelt_base_policy.sbpl` 里那几条带注释的豁免）。
 * - `allowPty`：交互式 shell / 需要检测 TTY 的工具（Codex 原话："so interactive shells
 *   detect a TTY and remain functional"）。不开的话 `npm run` 的进度输出、`less`、REPL 都会异常。
 * - `allowAppleEvents`：**保持关闭**。它不是兼容性需求而是能力放开（`open`/`osascript` 可对
 *   任意 App 发 Apple Events）。需要打开浏览器的场景走 `isSandboxExcludedCommand` 的精确豁免，
 *   而不是给整个沙盒开这个口子。
 */
export function sandboxProfileOptions(): { allowPty: boolean; allowAppleEvents: boolean } {
  return { allowPty: true, allowAppleEvents: false };
}

/**
 * 沙盒外豁免的命令（**必须自建沙盒 / 依赖宿主 GUI 会话，在 seatbelt 内结构性跑不了**）。
 *
 * 每一条都有实测依据，不是"被拦了不方便"：
 * - **Chromium 系（`playwright` / `chrome-headless-shell` 等）**：Chromium 会给自己的子进程
 *   apply 沙盒，而 macOS 不允许在已沙盒的进程里再 apply →
 *   `sandbox initialization failed: Operation not permitted` 崩。三组对照实测过：
 *   裸跑崩 / `sandbox-exec -p '(allow default)'` 跑普通命令正常 / 加 `--no-sandbox` 成功。
 *   ⇒ **放宽 profile 救不了它，"身处任何 seatbelt 内"即失败**。
 * - **容器（`docker` / `podman` / `docker compose`）**：容器本身要 namespace + 自己的沙盒，
 *   嵌套同理。Codex 也把这类列在 `excludedCommands` 语义之外单独处理。
 * - **`open`**：走 LaunchServices / Apple Events，沙盒内会以 -10822 / -54 失败。
 *   这里豁免的是**这个命令**，不是给沙盒开 appleevent 权限（见 sandboxProfileOptions 注释）。
 *   且只豁免**单个 http(s) URL**（`open 本地文件` / `open -a 应用` 不豁免）——判定在
 *   `isSandboxExcludedCommand` 的前置分支里，下面清单里的名字仅作索引。
 */
export const SANDBOX_EXCLUDED_COMMANDS: readonly string[] = [
  // 浏览器自动化（Chromium 自建沙盒，嵌套必崩）
  "playwright",
  "chromium",
  "chrome",
  "google-chrome",
  "chrome-headless-shell",
  "msedge",
  "chromium-browser",
  // 容器（嵌套命名空间）
  "docker",
  "docker-compose",
  "podman",
  "nerdctl",
  // 打开宿主浏览器——**只在单个 http(s) URL 时才豁免**，判定见 isSandboxExcludedCommand
  // 的前置分支（这里列名只为让豁免清单保持完整，实际不靠本数组命中）
  "open",
  "xdg-open",
];

/** 会包装别的命令的包管理执行器（`npx playwright …` 这类要看到第二段 token 才判得出）。 */
const PACKAGE_RUNNERS = new Set(["npx", "bunx", "pnpm", "yarn", "npm", "dlx", "corepack"]);

/** 执行器的子命令（跳过它们才看得到真正要跑的程序：`pnpm dlx playwright` / `npm exec playwright`）。 */
const RUNNER_SUBCOMMANDS = new Set(["dlx", "exec", "x"]);

/** 命令首 token 的规范化（去引号、取 basename、小写）——与 agent-permission-service 同判据。 */
function commandBasename(token: string): string {
  return token.replace(/^['"]|['"]$/g, "").replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
}

/**
 * 该命令是否应在**沙盒外**执行（见 `SANDBOX_EXCLUDED_COMMANDS` 的逐条依据）。
 *
 * 只认不含 shell 操作符的单一命令首 token（跳过 `VAR=x` 前缀与 `env`/`command`/`nohup` 等包装器），
 * 以及包管理器执行器的**第二段**（`npx playwright`）。
 *
 * `open` / `xdg-open` 只接受单个 http(s) URL；打开本地文件或指定应用不属于标准档兼容能力。
 * 本函数仍只是兼容性兜底：被豁免程序及其自身参数会在沙盒外运行。
 */
export function isSandboxExcludedCommand(command: string): boolean {
  let parsed: ReturnType<typeof parseShell>;
  try {
    parsed = parseShell(command);
  } catch {
    return false;
  }
  // shell-quote 把 &&、;、|、重定向、括号/命令替换等表示为对象。只要出现任一操作符，
  // 整条命令都必须留在沙盒中，不能让首命令替后续 payload 获得宿主权限。
  if (parsed.some((entry) => typeof entry !== "string")) return false;
  const words = parsed.filter((entry): entry is string => typeof entry === "string");
  let index = 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] ?? "")) index++;
  while (["command", "exec", "nohup", "env", "nice", "time"].includes(commandBasename(words[index] ?? ""))) {
    const wrapper = commandBasename(words[index++] ?? "");
    while (words[index]?.startsWith("-")) index++;
    if (wrapper === "env") while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] ?? "")) index++;
  }
  const head = commandBasename(words[index] ?? "");
  if (!head) return false;
  if (head === "open" || head === "xdg-open") {
    const args = words.slice(index + 1);
    return args.length === 1 && /^https?:\/\//i.test(args[0] ?? "");
  }
  if (SANDBOX_EXCLUDED_COMMANDS.includes(head)) return true;
  if (!PACKAGE_RUNNERS.has(head)) return false;
  // 包管理器执行器：找它后面第一个**非 flag、非子命令**的 token
  // （`npx playwright` / `npx -y playwright` / `pnpm dlx playwright` / `npm exec playwright`）
  const rest = words.slice(index + 1).filter((word) => !word.startsWith("-"));
  let subIndex = 0;
  while (RUNNER_SUBCOMMANDS.has(commandBasename(rest[subIndex] ?? ""))) subIndex++;
  const sub = commandBasename(rest[subIndex] ?? "");
  return sub !== "" && SANDBOX_EXCLUDED_COMMANDS.includes(sub);
}
