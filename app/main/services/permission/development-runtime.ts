import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { emHome } from "../../utils/paths";

export interface DevelopmentRuntime {
  id: string;
  root: string;
  home: string;
  cache: string;
  tmp: string;
  tools: string;
  config: string;
  state: string;
  logs: string;
}

export function developmentRuntimesRoot(): string {
  return path.join(emHome(), "runtimes");
}

function canonicalWorkspace(workspace: string): string {
  const absolute = path.resolve(workspace);
  let real = absolute;
  try { real = fs.realpathSync.native(absolute); } catch { /* 新工作区按绝对路径生成稳定 ID */ }
  return process.platform === "win32" ? real.toLowerCase() : real;
}

export function workspaceRuntimeId(workspace: string): string {
  return createHash("sha256").update(canonicalWorkspace(workspace)).digest("hex").slice(0, 24);
}

export function developmentRuntimeFor(workspace: string, baseRoot = developmentRuntimesRoot()): DevelopmentRuntime {
  const id = workspaceRuntimeId(workspace);
  const root = path.join(baseRoot, id);
  return {
    id,
    root,
    home: path.join(root, "home"),
    cache: path.join(root, "cache"),
    tmp: path.join(root, "tmp"),
    tools: path.join(root, "tools"),
    config: path.join(root, "config"),
    state: path.join(root, "state"),
    logs: path.join(root, "logs"),
  };
}

function assertPrivateDirectory(directory: string): void {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`开发运行区路径不安全：${directory}`);
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error(`开发运行区不属于当前用户：${directory}`);
  }
  if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
}

export function ensureDevelopmentRuntime(workspace: string, baseRoot = developmentRuntimesRoot()): DevelopmentRuntime {
  const parent = path.dirname(baseRoot);
  if (fs.existsSync(parent)) assertPrivateDirectory(parent);
  fs.mkdirSync(baseRoot, { recursive: true, mode: 0o700 });
  assertPrivateDirectory(parent);
  assertPrivateDirectory(baseRoot);
  const runtime = developmentRuntimeFor(workspace, baseRoot);
  const directories = [
    runtime.root, runtime.home, runtime.cache, runtime.tmp, runtime.tools, runtime.config, runtime.state, runtime.logs,
    path.join(runtime.tools, "bin"), path.join(runtime.tools, "npm", "bin"),
    path.join(runtime.tools, "python", process.platform === "win32" ? "Scripts" : "bin"),
    path.join(runtime.tools, "cargo", "bin"), path.join(runtime.tools, "go", "bin"),
    path.join(runtime.tools, "pnpm"), path.join(runtime.tools, "bun", "bin"),
    path.join(runtime.config, "npm"),
  ];
  for (const directory of directories) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    assertPrivateDirectory(directory);
  }
  seedSafeGitConfig(runtime);
  seedSshKnownHosts(runtime);
  return runtime;
}

const SAFE_GIT_CONFIG_KEYS = [
  "user.name", "user.email", "init.defaultBranch", "core.autocrlf", "core.eol",
  "pull.rebase", "merge.conflictStyle", "push.default", "fetch.prune",
] as const;

/** HOME 隔离后仍保留提交身份和纯行为设置；不复制凭据、签名密钥、URL 或 include。 */
function seedSafeGitConfig(runtime: DevelopmentRuntime): void {
  const target = path.join(runtime.home, ".gitconfig");
  if (fs.existsSync(target)) return;
  for (const key of SAFE_GIT_CONFIG_KEYS) {
    const read = spawnSync("git", ["config", "--global", "--get", key], {
      encoding: "utf8",
      timeout: 3000,
      env: process.env,
    });
    if (read.status !== 0 || !read.stdout.trim()) continue;
    const write = spawnSync("git", ["config", "--file", target, key, read.stdout.trim()], {
      encoding: "utf8",
      timeout: 3000,
      env: process.env,
    });
    if (write.status !== 0) {
      try { fs.rmSync(target, { force: true }); } catch { /* 下次创建上下文时重试 */ }
      return;
    }
  }
  if (fs.existsSync(target) && process.platform !== "win32") fs.chmodSync(target, 0o600);
}

/**
 * 把**服务器 host 指纹**复制进运行区（`known_hosts`）。
 *
 * 为什么必须给：HOME 隔离后 `~/.ssh` 不存在，ssh 连一台没见过的主机会**交互式询问**
 * "The authenticity of host … can't be established"，在非交互的会话里直接失败——而这与"凭据隔离"
 * 无关，纯粹是被隔离误伤的基础设施（`known_hosts` 是**公开的指纹信息**，不是凭据）。
 *
 * 只复制这一个文件：
 * - **不复制** `id_*`（私钥）、`authorized_keys`（凭据）
 * - **不复制** `config`（它会牵出 `IdentityFile` / `ProxyJump` 等更多路径，且常含主机别名，
 *   属"半敏感"；真需要时用户可自行把它放进运行区）
 *
 * 复制失败不阻塞：最坏情况是首次连接某主机失败，而那时的报错是明确的（不是静默）。
 */
function seedSshKnownHosts(runtime: DevelopmentRuntime): void {
  if (process.platform === "win32") return; // Windows 的 known_hosts 位置随安装形态而异，暂不处理
  const source = path.join(os.homedir(), ".ssh", "known_hosts");
  const target = path.join(runtime.home, ".ssh", "known_hosts");
  try {
    if (!fs.existsSync(source) || fs.existsSync(target)) return; // 幂等：已存在则不覆盖（保留运行区内的新增条目）
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.copyFileSync(source, target);
    fs.chmodSync(target, 0o600);
  } catch { /* 见上：失败退化为"该主机首次连接需要手动确认" */ }
}
