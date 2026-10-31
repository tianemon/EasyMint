import path from "node:path";
import fs from "node:fs";
import { developmentRuntimeFor, developmentRuntimesRoot, ensureDevelopmentRuntime, type DevelopmentRuntime } from "./development-runtime";
import { readManagedEnvironment } from "../tools/environment-tool";
import { sshAgentSockets } from "../sandbox/compat-policy";

/**
 * 权限三档（2026-09-17 定案：**只读 / 标准 / 完全访问**）：
 * - `readonly` 只读模式：**读自由，其他一律拒绝**——不执行任何命令、不写入任何文件、
 *   不启用 MCP、不联网（`web_fetch`/`web_search` 这类工具本身就是外泄出口）。
 *   工具面按纯读白名单 fail-closed；高度敏感凭据仍禁止读取，因为工具结果会进入远程模型上下文，
 *   模型请求本身也是外发通道，不能把“没有联网工具”等同于“内容不会离开本机”。
 *   代价必须明说：不能构建 / 测试 / 装依赖，**连 `git log`、`git diff` 也不行**（都属执行）。
 *   定位是"只看不动"（审阅陌生项目、理解代码），不是日常开发。
 * - `standard` 标准模式（默认）：执行前判定 + 开发运行区隔离（HOME/TMPDIR/包缓存重定向）+ OS 沙盒。
 * - `full` 完全访问：不套沙盒，只保留系统核心/提权/持久化执行配置三类禁区判定。
 */
export type PermissionMode = "readonly" | "standard" | "full";

/** 旧值别名（会话缓存/设置里可能残留），一律归一到新三档。 */
export const LEGACY_PERMISSION_MODE_ALIASES: Record<string, PermissionMode> = {
  restricted: "readonly",
  sandbox: "readonly",
};

/** 会话缓存中的旧值/缺省值统一归一；缺省沿用产品默认的标准模式。 */
export function normalizePermissionMode(raw?: string): PermissionMode {
  if (raw === "full" || raw === "bypassPermissions") return "full";
  return LEGACY_PERMISSION_MODE_ALIASES[raw ?? ""] ?? (raw === "readonly" ? "readonly" : "standard");
}

const PERMISSION_MODE_RANK: Record<PermissionMode, number> = {
  readonly: 0,
  standard: 1,
  full: 2,
};

/** 只要新模式更严格，就必须立即撤销旧执行上下文，而不只处理 full → 其它档。 */
export function isPermissionModeTightening(previous: string | undefined, next: string | undefined): boolean {
  if (previous === undefined || next === undefined) return false;
  return PERMISSION_MODE_RANK[normalizePermissionMode(next)] < PERMISSION_MODE_RANK[normalizePermissionMode(previous)];
}

export interface ExecutionContext {
  mode: PermissionMode;
  workspaceRealPath: string;
  runtimeRoot: string;
  environment: NodeJS.ProcessEnv;
  policyVersion: "2";
  /** 会话级执行所有者。Windows 用它隔离 ACL 沙盒 worker，避免权限模式在会话间串用。 */
  ownerId?: string;
  /** 宿主验证过的内置工具目录，供Windows隔离账户获得只读执行权限。 */
  bundledRuntimeRoot?: string;
}

/** 给已经编译好的策略绑定执行所有者；所有者不是模型参数，不能从工具输入伪造。 */
export function bindExecutionOwner(context: ExecutionContext, ownerId: string): ExecutionContext {
  return { ...context, ownerId };
}

const UNSAFE_INHERITED_ENV = new Set([
  "BASH_ENV", "ENV", "ZDOTDIR", "PROMPT_COMMAND", "SHELLOPTS",
  "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
  "NODE_OPTIONS", "RUBYOPT", "PERL5OPT", "PYTHONSTARTUP",
  "GIT_EXEC_PATH", "GIT_SSH_COMMAND", "GIT_TEMPLATE_DIR",
  "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "ELECTRON_RUN_AS_NODE",
]);

function realWorkspace(workspace: string): string {
  const absolute = path.resolve(workspace);
  try { return fs.realpathSync.native(absolute); } catch { return absolute; }
}

function toolPathEntries(runtime: DevelopmentRuntime): string[] {
  const suffix = process.platform === "win32" ? "Scripts" : "bin";
  return [
    path.join(runtime.tools, "bin"),
    path.join(runtime.tools, "npm", "bin"),
    path.join(runtime.tools, "python", suffix),
    path.join(runtime.tools, "cargo", "bin"),
    path.join(runtime.tools, "go", "bin"),
    path.join(runtime.tools, "pnpm"),
    path.join(runtime.tools, "bun", "bin"),
  ];
}

function cleanEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && !UNSAFE_INHERITED_ENV.has(key.toUpperCase())) result[key] = value;
  }
  return result;
}

export function createExecutionContext(
  workspace: string,
  mode: PermissionMode,
  additions: NodeJS.ProcessEnv = {},
  runtimeBaseRoot = developmentRuntimesRoot(),
): ExecutionContext {
  const workspaceRealPath = realWorkspace(workspace);
  const managed = readManagedEnvironment();
  // ⚠️ 判据是「非完全访问」而非「等于标准」：只读档也走运行区（它虽不执行，但环境仍要编译出来，
  //    且此前 restricted 档因为只判 standard 而拿到**未创建的** HOME/TMPDIR——已一并修正）。
  const runtime = mode !== "full"
    ? ensureDevelopmentRuntime(workspaceRealPath, runtimeBaseRoot)
    : developmentRuntimeFor(workspaceRealPath, runtimeBaseRoot);
  if (mode === "full") {
    return {
      mode,
      workspaceRealPath,
      runtimeRoot: runtime.root,
      environment: { ...process.env, ...managed, ...additions },
      policyVersion: "2",
    };
  }

  const base = cleanEnvironment({ ...process.env, ...managed, ...additions });
  const pathValue = [...toolPathEntries(runtime), base.PATH ?? ""].filter(Boolean).join(path.delimiter);
  const environment: NodeJS.ProcessEnv = {
    ...base,
    HOME: runtime.home,
    USERPROFILE: runtime.home,
    TMPDIR: runtime.tmp,
    TMP: runtime.tmp,
    TEMP: runtime.tmp,
    XDG_CACHE_HOME: runtime.cache,
    XDG_CONFIG_HOME: runtime.config,
    XDG_STATE_HOME: runtime.state,
    NPM_CONFIG_PREFIX: path.join(runtime.tools, "npm"),
    npm_config_prefix: path.join(runtime.tools, "npm"),
    npm_config_global_prefix: path.join(runtime.tools, "npm"),
    NPM_CONFIG_CACHE: path.join(runtime.cache, "npm"),
    npm_config_cache: path.join(runtime.cache, "npm"),
    NPM_CONFIG_USERCONFIG: path.join(runtime.config, "npm", "npmrc"),
    npm_config_userconfig: path.join(runtime.config, "npm", "npmrc"),
    npm_config_globalconfig: path.join(runtime.config, "npm", "global-npmrc"),
    COREPACK_HOME: path.join(runtime.cache, "corepack"),
    PNPM_HOME: path.join(runtime.tools, "pnpm"),
    YARN_CACHE_FOLDER: path.join(runtime.cache, "yarn"),
    BUN_INSTALL: path.join(runtime.tools, "bun"),
    BUN_INSTALL_CACHE_DIR: path.join(runtime.cache, "bun"),
    PIP_CACHE_DIR: path.join(runtime.cache, "pip"),
    UV_CACHE_DIR: path.join(runtime.cache, "uv"),
    PYTHONUSERBASE: path.join(runtime.tools, "python"),
    GRADLE_USER_HOME: path.join(runtime.cache, "gradle"),
    MAVEN_OPTS: `${base.MAVEN_OPTS ?? ""} -Dmaven.repo.local=${path.join(runtime.cache, "maven")}`.trim(),
    CARGO_HOME: path.join(runtime.tools, "cargo"),
    GOPATH: path.join(runtime.tools, "go"),
    GOMODCACHE: path.join(runtime.cache, "go", "pkg", "mod"),
    GOBIN: path.join(runtime.tools, "go", "bin"),
    PUB_CACHE: path.join(runtime.cache, "dart"),
    DENO_DIR: path.join(runtime.cache, "deno"),
    DOTNET_CLI_HOME: path.join(runtime.home, ".dotnet"),
    NUGET_PACKAGES: path.join(runtime.cache, "nuget"),
    COMPOSER_HOME: path.join(runtime.config, "composer"),
    COMPOSER_CACHE_DIR: path.join(runtime.cache, "composer"),
    CCACHE_DIR: path.join(runtime.cache, "ccache"),
    PATH: pathValue,
    PWD: workspaceRealPath,
    INIT_CWD: workspaceRealPath,
    EASYMINT_WORKSPACE: workspaceRealPath,
    EASYMINT_RUNTIME: runtime.root,
  };
  if (process.platform === "win32") {
    environment.APPDATA = path.join(runtime.config, "AppData", "Roaming");
    environment.LOCALAPPDATA = path.join(runtime.state, "AppData", "Local");
  }
  // ssh-agent 通道：标准档「能 push、而私钥不进会话」的关键（只读档不执行 git）。
  // 为什么需要补：macOS 从 Finder / Dock 启动的应用**不继承 shell 环境**，`SSH_AUTH_SOCK` 常常缺失，
  // 而它正是 git 找到 agent 的唯一线索（发现逻辑与安全取舍见 sandbox/compat-policy）。
  // ⚠️ 这里只注入**变量**；沙盒是否放行那个 socket 由 access-policy 的 `allowUnixSockets` 决定 ——
  //    两者必须同时成立（只注入不放行 = 连接被 seatbelt 拒，命令会以 socket 错误失败）。
  if (!environment.SSH_AUTH_SOCK) {
    const agent = sshAgentSockets().find((socket) => fs.existsSync(socket));
    if (agent) environment.SSH_AUTH_SOCK = agent;
  }
  return { mode, workspaceRealPath, runtimeRoot: runtime.root, environment, policyVersion: "2" };
}

export const executionContextInternals = {
  isUnsafeEnvironmentName: (name: string): boolean => UNSAFE_INHERITED_ENV.has(name.toUpperCase()),
};
