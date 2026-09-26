/** Read-only discovery of extensions configured in native Pi. No module is imported here. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { builtinModules, createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { satisfies, validRange } from "semver";
import { emHome } from "../utils/paths";
import { readExternalField, writeExternalField } from "./em-settings-schema";
import { atomicWrite, lockConfigDirectory } from "./native-config-storage";
import type { ResolvedResource } from "@earendil-works/pi-coding-agent";

export interface PiExtensionInfo {
  id: string;
  name: string;
  path: string;
  scope: "user" | "project";
  source: string;
  origin: "pi" | "em";
  enabledInPi: boolean;
  approved: boolean;
  fingerprint: string;
  status: "ready" | "pending" | "disabled" | "missing" | "error";
  error?: string;
  tools?: number;
  commands?: number;
}

interface DiscoveryOptions {
  projectPath?: string;
  nativeAgentDir?: string;
  settingsDir?: string;
  projectConfigDir?: ".pi" | ".easymint";
}

const runtimeErrors = new Map<string, string>();
const runtimeStats = new Map<string, { tools: number; commands: number }>();
export function recordPiExtensionError(extensionPath: string, error?: string): void {
  if (!path.isAbsolute(extensionPath)) return;
  const key = path.resolve(extensionPath);
  if (error) runtimeErrors.set(key, error);
  else runtimeErrors.delete(key);
}
export function recordPiExtensionStats(extensionPath: string, tools: number, commands: number): void {
  if (path.isAbsolute(extensionPath)) runtimeStats.set(path.resolve(extensionPath), { tools, commands });
}

function readSettings(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Pi 设置格式无效：${file}`);
  return parsed as Record<string, unknown>;
}

function approvalsFile(settingsDir: string): string { return path.join(settingsDir, "em-settings.json"); }

function readApprovals(settingsDir: string): Record<string, string> {
  const file = approvalsFile(settingsDir);
  if (!fs.existsSync(file)) return {};
  const raw = readExternalField(readSettings(file), "approvedPiExtensions");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([key, value]) => key.length > 0 && typeof value === "string"));
}

function packageSource(value: unknown): string | undefined {
  return typeof value === "string" ? value
    : value && typeof value === "object" && typeof (value as { source?: unknown }).source === "string"
      ? (value as { source: string }).source : undefined;
}

// ── Pi Git 源解析（复用锁定版本的 SDK 实现）────────────
//
// 原生 Pi 接受 `git:github:owner/repo` 等简写；SDK 未从包入口导出 parseGitUrl，
// 故与 pi-sdk.ts 的 clearPiExtensionCache 同样走内部文件入口，直接加载已安装 SDK 的
// dist/utils/git.js——版本与 package.json 锁定的 SDK 严格一致（有版本锚定测试，
// 升级 SDK 时必须复核该文件行为）。hosted-git-info 由其自身嵌套依赖解析，版本同源。

type PiGitSource = { host: string; path: string; ref?: string } | null;
let piParseGitUrl: ((source: string) => PiGitSource) | undefined;

async function ensurePiGitParser(): Promise<void> {
  if (piParseGitUrl) return;
  const require = createRequire(path.join(__dirname, "pi-extension-service.cjs"));
  const gitModulePath = (require.resolve.paths("@earendil-works/pi-coding-agent") ?? [])
    .map((root) => path.join(root, "@earendil-works", "pi-coding-agent", "dist", "utils", "git.js"))
    .find((file) => fs.existsSync(file));
  if (!gitModulePath) throw new Error("找不到 Pi Git 解析模块");
  const mod = await import(/* @vite-ignore */ pathToFileURL(gitModulePath).href);
  if (typeof mod.parseGitUrl !== "function") throw new Error("Pi Git 解析接口不可用");
  piParseGitUrl = mod.parseGitUrl as (source: string) => PiGitSource;
}

/** 与 Pi parseGitUrl 的受理口径一致：git: 前缀接受全部历史简写，否则只认显式协议 URL。 */
function isGitSource(source: string): boolean {
  return source.startsWith("git:") || /^(https?|ssh|git):\/\//i.test(source);
}

// Pi 通过 jiti 别名向扩展提供的模块（来源：锁定 SDK 0.87.1 dist/core/extensions/loader.js
// 的 getAliases——@earendil-works/* 与旧作用域 @mariozechner/* 指向 SDK 自身入口；
// typebox 与 @sinclair/typebox（含 /compile、/value 子路径）指向 SDK 的 typebox 依赖）。
// 这些由 EM 锁定的 SDK 版本提供，不属于用户可执行内容；版本锚定测试钉住 SDK 版本，
// 升级时必须对照新的 getAliases 复核此表。
const PI_PROVIDED_MODULE_SCOPES = ["@earendil-works/", "@mariozechner/"];
const PI_PROVIDED_MODULE_NAMES = ["typebox", "@sinclair/typebox"];

/** 导入说明符是否为 Pi 提供的模块（jiti 别名解析，用户不可控内容）。 */
function isPiProvidedModule(spec: string, packageName: string): boolean {
  if (PI_PROVIDED_MODULE_SCOPES.some((scope) => spec.startsWith(scope))) return true;
  return PI_PROVIDED_MODULE_NAMES.some((name) => spec === name || (spec.startsWith(name + "/") && packageName === name));
}

function gitInstallParts(source: string): { host: string; repo: string } | undefined {
  if (!piParseGitUrl) throw new Error("Pi Git 解析模块未初始化");
  const parsed = piParseGitUrl(source);
  if (!parsed) return undefined;
  return { host: parsed.host, repo: parsed.path };
}

function packageIdentity(source: string, baseDir: string): string {
  if (source.startsWith("npm:")) {
    const spec = source.slice(4);
    const versionAt = spec.lastIndexOf("@");
    return `npm:${versionAt > 0 ? spec.slice(0, versionAt) : spec}`;
  }
  if (isGitSource(source)) {
    const parts = gitInstallParts(source);
    // 解析失败的 git 源不能落进 local: 身份（可能与真实本地路径撞车导致错误去重）；
    // 其缺失/拒绝由 projectInstalledPath 的 undefined 分支体现
    if (parts) return `git:${parts.host}/${parts.repo}`.toLowerCase();
    return `git:invalid:${source}`;
  }
  return `local:${path.resolve(baseDir, source)}`;
}

function packageVersionMatches(source: string, installedPath: string): boolean {
  if (!source.startsWith("npm:")) return true;
  const spec = source.slice(4);
  const versionAt = spec.lastIndexOf("@");
  if (versionAt <= 0) return true;
  const range = validRange(spec.slice(versionAt + 1));
  if (!range) return true;
  const manifest = readSettings(path.join(installedPath, "package.json"));
  return typeof manifest.version === "string" && satisfies(manifest.version, range);
}

function fingerprint(file: string): string {
  const hash = createHash("sha256");
  const directoryEntry = fs.statSync(file).isDirectory();
  if (!directoryEntry) {
    if (fs.statSync(file).size > 8 * 1024 * 1024) throw new Error("扩展入口文件过大，无法自动校验");
    hash.update(fs.readFileSync(file));
  }
  let root = directoryEntry ? file : path.dirname(file);
  let dir = root;
  let packageRoot = directoryEntry;
  for (let i = 0; !directoryEntry && i < 5; i++) {
    const manifest = path.join(dir, "package.json");
    if (fs.existsSync(manifest)) { root = dir; packageRoot = true; break; }
    if (path.basename(dir) === "extensions" && ["agent", ".pi", ".easymint"].includes(path.basename(path.dirname(dir)))) break;
    if ([".pi", ".easymint"].includes(path.basename(dir))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  let count = 0;
  let bytes = 0;
  const visitedDirs = new Set<string>();
  const visit = (current: string): void => {
    const realDir = fs.realpathSync(current);
    if (visitedDirs.has(realDir)) return;
    visitedDirs.add(realDir);
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".git") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { visit(full); continue; }
      if (entry.isSymbolicLink()) {
        hash.update(path.relative(root, full));
        hash.update(fs.readlinkSync(full));
        const target = fs.realpathSync(full);
        if (fs.statSync(target).isDirectory()) visit(target);
        else if (fs.statSync(target).isFile()) {
          count++;
          bytes += fs.statSync(target).size;
          if (count > 50000 || bytes > 512 * 1024 * 1024) throw new Error("扩展文件过多或过大，无法自动校验");
          hash.update(target);
          hash.update(fs.readFileSync(target));
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const size = fs.statSync(full).size;
      count++;
      bytes += size;
      if (count > 50000 || bytes > 512 * 1024 * 1024) throw new Error("扩展文件过多或过大，无法自动校验");
      hash.update(path.relative(root, full));
      hash.update(fs.readFileSync(full));
    }
  };
  // 按 Node 解析语义从 fromDir 逐级向上找 node_modules/<name>——与运行时实际加载位置一致
  const resolvePackageDir = (fromDir: string, name: string): string | undefined => {
    let cursor = fromDir;
    while (true) {
      const candidate = path.join(cursor, "node_modules", name);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
      const parent = path.dirname(cursor);
      if (parent === cursor) return undefined;
      cursor = parent;
    }
  };
  const checkedPackages = new Set<string>();
  const visitDependencies = (packageDir: string): void => {
    const realPackage = fs.realpathSync(packageDir);
    if (checkedPackages.has(realPackage)) return;
    checkedPackages.add(realPackage);
    if (checkedPackages.size > 1000) throw new Error("扩展依赖过多，无法自动校验");
    const manifest = readSettings(path.join(packageDir, "package.json"));
    // dependencies 与 optionalDependencies 都是运行时可能导入的代码，一并纳入
    const declared = [manifest.dependencies, manifest.optionalDependencies]
      .filter((value): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value));
    const names = [...new Set(declared.flatMap((deps) => Object.keys(deps)))].sort();
    for (const name of names) {
      const found = resolvePackageDir(packageDir, name);
      // 清单声明但未安装：包根本跑不起来，不改变既有指纹口径（静默跳过）
      if (!found) continue;
      visit(found);
      visitDependencies(found);
    }
  };
  if (packageRoot || /^index\.(ts|js)$/.test(path.basename(file))) {
    visit(root);
    if (packageRoot) visitDependencies(root);
  } else {
    // 单文件扩展的导入分析是 **best-effort 的变更提示**，不是安全边界（2026-09-26 复查定案）：
    // 授权含义 = 信任扩展来源；指纹用于发现常见的源码/依赖更新并提示重新确认，静态分析
    // 无法证明「所有将执行的代码都没变」。因此尽力收集能静态看到的导入并纳入指纹，
    // 看不到的（动态 import、Pi 提供的模块、定位不到的依赖）一律跳过、不拒绝启用——
    // 曾用正则检测动态导入，会误匹配注释/字符串文本，已移除；要做语法级分析需真正的解析器。
    const seen = new Set<string>();
    const scannable = /\.(?:[cm]?[tj]s)$/;
    const scanImports = (modulePath: string): void => {
      const real = fs.realpathSync(modulePath);
      if (seen.has(real)) return;
      seen.add(real);
      if (seen.size > 100) throw new Error("扩展相对导入过多，无法自动校验");
      // 只对代码文件做导入分析：JSON 等内容文件里的引号文本会误匹配导入语法
      if (!scannable.test(modulePath)) return;
      const source = fs.readFileSync(modulePath, "utf8");
      const specs = [...source.matchAll(/(?:from\s*|import\s*\(|require\s*\(|\bimport\s*)["']([^"']+)["']/g)]
        .map((match) => match[1]!);
      for (const spec of specs) {
        if (spec.startsWith(".")) {
          const base = path.resolve(path.dirname(modulePath), spec);
          const next = [base, `${base}.ts`, `${base}.js`, `${base}.json`, path.join(base, "index.ts"), path.join(base, "index.js")]
            .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
          if (!next) continue;
          if (fs.statSync(next).size > 8 * 1024 * 1024) throw new Error("扩展依赖文件过大，无法自动校验");
          hash.update(fs.realpathSync(next));
          hash.update(fs.readFileSync(next));
          scanImports(next);
          continue;
        }
        // 以下导入不属于用户可执行内容，或静态分析无法定位——跳过（不阻塞启用）
        if (spec.startsWith("node:")) continue;
        const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
        if (builtinModules.includes(name)) continue;
        // Pi 提供的模块（jiti 别名，来源 SDK 0.87.1 loader.js getAliases，版本锚定测试钉住版本）：
        // @earendil-works/* 与旧作用域 @mariozechner/* 映射到 SDK 自身入口；typebox 与
        // @sinclair/typebox（含 /compile、/value 子路径）映射到 SDK 的 typebox 依赖。
        // 它们由 EM 锁定的 SDK 版本提供，与用户扩展代码无关，不纳入指纹。
        if (isPiProvidedModule(spec, name)) continue;
        // 协议前缀（https: 等）jiti 无法按文件解析，运行时自会失败——跳过
        if (/^[a-z][a-z0-9+.-]*:/i.test(spec)) continue;
        const found = resolvePackageDir(path.dirname(modulePath), name);
        // 定位不到（未安装、由运行时动态解析等）：best-effort 口径下跳过，不拒绝启用
        if (!found) continue;
        visit(found);
        visitDependencies(found);
      }
    };
    scanImports(file);
  }
  return hash.digest("hex");
}

function projectSettingsForPi(projectPath: string, configDir: ".pi" | ".easymint", installedPath: (source: string) => string | undefined, userInstalledPath: (source: string) => string | undefined, userPackages: unknown[]): string {
  const piDir = path.join(projectPath, configDir);
  const raw = readSettings(path.join(piDir, "settings.json"));
  const localize = (source: string): string => {
    if (source.startsWith("npm:") || isGitSource(source)) {
      const resolved = installedPath(source);
      return resolved && fs.existsSync(resolved) ? resolved : source;
    }
    if (source === "~" || source.startsWith("~/")) return path.join(os.homedir(), source.slice(2));
    return path.resolve(piDir, source);
  };
  if (Array.isArray(raw.extensions)) raw.extensions = raw.extensions.map((value) => {
    if (typeof value !== "string") return value;
    const prefix = /^[!+-]/.test(value) ? value[0]! : "";
    return prefix + localize(prefix ? value.slice(1) : value);
  });
  const autoDir = path.join(piDir, "extensions");
  if (fs.existsSync(autoDir)) raw.extensions = [autoDir, ...(Array.isArray(raw.extensions) ? raw.extensions : [])];
  if (Array.isArray(raw.packages)) raw.packages = raw.packages.map((value) => {
    const source = packageSource(value);
    if (!source) return value;
    const delta = typeof value === "object" && value !== null && (value as { autoload?: unknown }).autoload === false;
    const userMatch = delta ? userPackages.map(packageSource).find((candidate) => candidate && packageIdentity(candidate, path.dirname(piDir)) === packageIdentity(source, piDir)) : undefined;
    const resolved = userMatch ? userInstalledPath(userMatch) : undefined;
    const localized = resolved && fs.existsSync(resolved) ? resolved : localize(source);
    if (typeof value === "string") return localized;
    return { ...value, source: localized };
  });
  return JSON.stringify(raw);
}

export async function discoverPiExtensions(options: DiscoveryOptions = {}): Promise<PiExtensionInfo[]> {
  const nativeAgentDir = options.nativeAgentDir ?? path.join(os.homedir(), ".pi", "agent");
  const settingsDir = options.settingsDir ?? emHome();
  const projectConfigDir = options.projectConfigDir ?? ".pi";
  const projectPath = options.projectPath ? path.resolve(options.projectPath) : undefined;
  const sdk = await import("@earendil-works/pi-coding-agent");
  await ensurePiGitParser();
  const userManager = new sdk.DefaultPackageManager({
    cwd: projectPath ?? os.homedir(), agentDir: nativeAgentDir,
    settingsManager: sdk.SettingsManager.inMemory(),
  });
  const projectInstalledPath = (source: string): string | undefined => {
    if (!projectPath) return undefined;
    const base = path.join(projectPath, projectConfigDir);
    let installed: string;
    if (source.startsWith("npm:")) {
      installed = path.join(base, "npm", "node_modules", packageIdentity(source, base).slice(4));
    } else if (isGitSource(source)) {
      const parts = gitInstallParts(source);
      if (!parts) return undefined;
      installed = path.join(base, "git", parts.host, parts.repo);
    } else {
      installed = source === "~" || source.startsWith("~/") ? path.join(os.homedir(), source.slice(2)) : path.resolve(base, source);
    }
    return fs.existsSync(installed) && packageVersionMatches(source, installed) ? installed : undefined;
  };
  const rawUserSettings = readSettings(path.join(nativeAgentDir, "settings.json"));
  const userPackages = Array.isArray(rawUserSettings.packages) ? rawUserSettings.packages : [];
  const rawProjectSettings = projectPath ? readSettings(path.join(projectPath, projectConfigDir, "settings.json")) : {};
  const projectPackages = Array.isArray(rawProjectSettings.packages) ? rawProjectSettings.packages : [];
  const replaced = new Set(projectPackages.filter((pkg) => !(pkg && typeof pkg === "object" && (pkg as { autoload?: unknown }).autoload === false))
    .map(packageSource).filter((source): source is string => !!source).map((source) => packageIdentity(source, path.join(projectPath!, projectConfigDir))));
  const userSettings = JSON.stringify({ ...rawUserSettings,
    packages: userPackages.filter((pkg) => {
      const source = packageSource(pkg);
      return !source || !replaced.has(packageIdentity(source, nativeAgentDir));
    }),
  });
  const projectSettings = projectPath ? projectSettingsForPi(projectPath, projectConfigDir, projectInstalledPath, (source) => {
    const installed = userManager.getInstalledPath(source, "user");
    return installed && packageVersionMatches(source, installed) ? installed : undefined;
  }, userPackages) : "{}";
  const storage = {
    withLock(scope: "global" | "project", fn: (current: string | undefined) => string | undefined): void {
      if (fn(scope === "global" ? userSettings : projectSettings) !== undefined) throw new Error("Pi 扩展扫描禁止写入设置");
    },
  };
  const settings = sdk.SettingsManager.fromStorage(storage, { projectTrusted: true });
  const manager = new sdk.DefaultPackageManager({ cwd: projectPath ?? os.homedir(), agentDir: nativeAgentDir, settingsManager: settings });
  const unavailable = new Set<string>();
  const resolved = await manager.resolve(async (source) => { unavailable.add(source); return "skip"; });
  const wrongProjectDir = projectConfigDir === ".pi" ? ".easymint" : ".pi";
  const resources: ResolvedResource[] = resolved.extensions.filter((item) => !projectPath || !item.path.startsWith(path.join(projectPath, wrongProjectDir) + path.sep));
  const approved = readApprovals(settingsDir);
  const seen = new Set<string>();
  const result: PiExtensionInfo[] = [];
  for (const item of resources) {
    const resolvedPath = path.resolve(item.path);
    const scope = item.metadata.scope === "project" ? "project" : "user";
    const id = `${scope}:${fs.existsSync(resolvedPath) ? fs.realpathSync(resolvedPath) : resolvedPath}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const exists = fs.existsSync(resolvedPath) && (
      fs.statSync(resolvedPath).isFile() || fs.statSync(resolvedPath).isDirectory() &&
      ["index.ts", "index.js"].some((name) => fs.existsSync(path.join(resolvedPath, name)))
    );
    let digest = "";
    let error: string | undefined;
    if (exists) {
      try { digest = fingerprint(resolvedPath); }
      catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    }
    if (approved[id] === digest) error ??= runtimeErrors.get(resolvedPath);
    const enabledInPi = item.enabled;
    const stats = approved[id] === digest ? runtimeStats.get(resolvedPath) : undefined;
    const fileName = path.basename(resolvedPath);
    const name = /^index\.(ts|js)$/.test(fileName) ? path.basename(path.dirname(resolvedPath)) : fileName.replace(/\.(ts|js)$/, "");
    result.push({
      id, name, path: resolvedPath,
      scope, source: item.metadata.source, origin: projectConfigDir === ".pi" ? "pi" : "em", enabledInPi, approved: !!digest && approved[id] === digest,
      fingerprint: digest, error, ...stats,
      status: !exists ? "missing" : error ? "error" : !enabledInPi ? "disabled" : approved[id] === digest ? "ready" : "pending",
    });
  }
  const packageEntries = (raw: Record<string, unknown>, scope: "user" | "project") => {
    if (!Array.isArray(raw.packages)) return;
    for (const pkg of raw.packages) {
      const source = typeof pkg === "string" ? pkg : pkg && typeof pkg === "object" ? (pkg as { source?: unknown }).source : undefined;
      if (typeof source !== "string") continue;
      if (scope === "user" && replaced.has(packageIdentity(source, nativeAgentDir))) continue;
      const installed = scope === "project" ? projectInstalledPath(source) : manager.getInstalledPath(source, "user");
      if (installed && fs.existsSync(installed) && !unavailable.has(source) && packageVersionMatches(source, installed)) continue;
      const id = `${scope}:missing-package:${source}`;
      if (seen.has(id)) continue;
      seen.add(id);
      result.push({ id, name: source, path: installed ?? source, scope, source, origin: projectConfigDir === ".pi" ? "pi" : "em",
        enabledInPi: false, approved: false, fingerprint: "", status: "missing", error: "来源尚未安装、路径不存在或版本不匹配" });
    }
  };
  packageEntries(rawUserSettings, "user");
  if (projectPath) packageEntries(readSettings(path.join(projectPath, projectConfigDir, "settings.json")), "project");
  const missingPaths = (raw: Record<string, unknown>, scope: "user" | "project", baseDir: string) => {
    if (!Array.isArray(raw.extensions)) return;
    for (const entry of raw.extensions) {
      if (typeof entry !== "string" || /^[!+-]/.test(entry) || /[*?[\]]/.test(entry) || entry.startsWith("npm:") || entry.startsWith("git:")) continue;
      const resolvedPath = entry === "~" || entry.startsWith("~/")
        ? path.join(os.homedir(), entry.slice(2)) : path.resolve(baseDir, entry);
      if (fs.existsSync(resolvedPath)) continue;
      const id = `${scope}:missing-extension:${resolvedPath}`;
      if (seen.has(id)) continue;
      seen.add(id);
      result.push({ id, name: path.basename(resolvedPath), path: resolvedPath, scope, source: entry,
        origin: projectConfigDir === ".pi" ? "pi" : "em", enabledInPi: false, approved: false,
        fingerprint: "", status: "missing", error: "扩展文件不存在" });
    }
  };
  missingPaths(rawUserSettings, "user", nativeAgentDir);
  if (projectPath) missingPaths(readSettings(path.join(projectPath, projectConfigDir, "settings.json")), "project", path.join(projectPath, projectConfigDir));
  return result.sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name));
}

export async function discoverAvailableExtensions(options: DiscoveryOptions = {}): Promise<PiExtensionInfo[]> {
  const emOptions = {
    ...options,
    nativeAgentDir: path.join(options.settingsDir ?? emHome(), "agent"),
    projectConfigDir: ".easymint" as const,
  };
  const scans = await Promise.allSettled([discoverPiExtensions(options), discoverPiExtensions(emOptions)]);
  const errorRow = (origin: "pi" | "em", error: unknown): PiExtensionInfo => ({
    id: `${origin}:settings-error`, name: `${origin === "pi" ? "原生 Pi" : "EasyMint"} 扩展配置`,
    path: origin === "pi" ? path.join(options.nativeAgentDir ?? path.join(os.homedir(), ".pi", "agent"), "settings.json") : path.join(emOptions.nativeAgentDir, "settings.json"),
    scope: "user", source: "settings", origin, enabledInPi: false, approved: false,
    fingerprint: "", status: "error", error: error instanceof Error ? error.message : String(error),
  });
  const native = scans[0].status === "fulfilled" ? scans[0].value : [errorRow("pi", scans[0].reason)];
  const em = scans[1].status === "fulfilled" ? scans[1].value : [errorRow("em", scans[1].reason)];
  const seen = new Set<string>();
  return [...native, ...em].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export async function setPiExtensionApproved(id: string, fingerprintValue: string, enabled: boolean, options: DiscoveryOptions = {}): Promise<void> {
  const settingsDir = options.settingsDir ?? emHome();
  const current = (await discoverAvailableExtensions(options)).find((item) => item.id === id);
  if (!current || current.fingerprint !== fingerprintValue || !current.enabledInPi) throw new Error("扩展已变更，请刷新列表后重试");
  const release = lockConfigDirectory(settingsDir);
  try {
    const file = approvalsFile(settingsDir);
    const data = readSettings(file);
    const approvals = readApprovals(settingsDir);
    if (enabled) approvals[id] = fingerprintValue;
    else delete approvals[id];
    writeExternalField(data, "approvedPiExtensions", approvals);
    atomicWrite(file, JSON.stringify(data, null, 2) + "\n");
  } finally { release(); }
}
