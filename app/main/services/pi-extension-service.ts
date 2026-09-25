/** Read-only discovery of extensions configured in native Pi. No module is imported here. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
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

function fingerprint(file: string): string {
  const hash = createHash("sha256");
  if (fs.statSync(file).size > 8 * 1024 * 1024) throw new Error("扩展入口文件过大，无法自动校验");
  hash.update(fs.readFileSync(file));
  let root = path.dirname(file);
  let dir = root;
  let packageRoot = false;
  for (let i = 0; i < 5; i++) {
    const manifest = path.join(dir, "package.json");
    if (fs.existsSync(manifest)) { root = dir; packageRoot = true; break; }
    if (["extensions", ".pi", ".easymint"].includes(path.basename(dir))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  let count = 0;
  let bytes = 0;
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { visit(full); continue; }
      if (entry.isSymbolicLink()) { hash.update(path.relative(root, full)); hash.update(fs.readlinkSync(full)); continue; }
      if (!entry.isFile()) continue;
      const size = fs.statSync(full).size;
      count++;
      bytes += size;
      if (count > 5000 || bytes > 64 * 1024 * 1024) throw new Error("扩展文件过多或过大，无法自动校验");
      hash.update(path.relative(root, full));
      hash.update(fs.readFileSync(full));
    }
  };
  if (packageRoot || /^index\.(ts|js)$/.test(path.basename(file))) {
    visit(root);
  } else {
    const seen = new Set<string>();
    const scanImports = (modulePath: string): void => {
      const real = fs.realpathSync(modulePath);
      if (seen.has(real)) return;
      seen.add(real);
      if (seen.size > 100) throw new Error("扩展相对导入过多，无法自动校验");
      const source = fs.readFileSync(modulePath, "utf8");
      const imports = [...source.matchAll(/(?:from\s*|import\s*\(|require\s*\(|\bimport\s*)["'](\.[^"']+)["']/g)]
        .map((match) => match[1]!);
      for (const spec of imports) {
        const base = path.resolve(path.dirname(modulePath), spec);
        const next = [base, `${base}.ts`, `${base}.js`, `${base}.json`, path.join(base, "index.ts"), path.join(base, "index.js")]
          .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (!next) continue;
        if (fs.statSync(next).size > 8 * 1024 * 1024) throw new Error("扩展依赖文件过大，无法自动校验");
        hash.update(fs.realpathSync(next));
        hash.update(fs.readFileSync(next));
        scanImports(next);
      }
    };
    scanImports(file);
  }
  return hash.digest("hex");
}

function projectSettingsForPi(projectPath: string, configDir: ".pi" | ".easymint", installedPath: (source: string) => string | undefined): string {
  const piDir = path.join(projectPath, configDir);
  const raw = readSettings(path.join(piDir, "settings.json"));
  const localize = (source: string): string => {
    if (source.startsWith("npm:") || source.startsWith("git:") || /^https?:\/\//.test(source)) {
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
    if (typeof value === "string") return localize(value);
    if (value && typeof value === "object" && typeof (value as { source?: unknown }).source === "string") {
      return { ...value, source: localize((value as { source: string }).source) };
    }
    return value;
  });
  return JSON.stringify(raw);
}

export async function discoverPiExtensions(options: DiscoveryOptions = {}): Promise<PiExtensionInfo[]> {
  const nativeAgentDir = options.nativeAgentDir ?? path.join(os.homedir(), ".pi", "agent");
  const settingsDir = options.settingsDir ?? emHome();
  const projectConfigDir = options.projectConfigDir ?? ".pi";
  const projectPath = options.projectPath ? path.resolve(options.projectPath) : undefined;
  const sdk = await import("@earendil-works/pi-coding-agent");
  const projectManager = projectPath ? new sdk.DefaultPackageManager({
    cwd: projectPath, agentDir: nativeAgentDir,
    settingsManager: sdk.SettingsManager.inMemory({}, { projectTrusted: true }),
  }) : undefined;
  const projectInstalledPath = (source: string): string | undefined => {
    if (!projectPath) return undefined;
    const sdkPath = projectManager?.getInstalledPath(source, "project");
    if (!sdkPath) return undefined;
    const fromProject = path.relative(projectPath, sdkPath);
    if (fromProject.startsWith("..") || path.isAbsolute(fromProject)) return sdkPath;
    const relative = fromProject.split(path.sep).slice(1);
    return path.join(projectPath, projectConfigDir, ...relative);
  };
  const projectSettings = projectPath ? projectSettingsForPi(projectPath, projectConfigDir, projectInstalledPath) : "{}";
  const rawUserSettings = readSettings(path.join(nativeAgentDir, "settings.json"));
  const userSettings = JSON.stringify(rawUserSettings);
  const storage = {
    withLock(scope: "global" | "project", fn: (current: string | undefined) => string | undefined): void {
      if (fn(scope === "global" ? userSettings : projectSettings) !== undefined) throw new Error("Pi 扩展扫描禁止写入设置");
    },
  };
  const settings = sdk.SettingsManager.fromStorage(storage, { projectTrusted: true });
  const manager = new sdk.DefaultPackageManager({ cwd: projectPath ?? os.homedir(), agentDir: nativeAgentDir, settingsManager: settings });
  const resolved = await manager.resolve(async () => "skip");
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
    const exists = fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile();
    let digest = "";
    let error: string | undefined;
    if (exists) {
      try { digest = fingerprint(resolvedPath); }
      catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    }
    if (approved[id] === digest) error ??= runtimeErrors.get(resolvedPath);
    const enabledInPi = item.enabled;
    const stats = runtimeStats.get(resolvedPath);
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
      const installed = scope === "project" ? projectInstalledPath(source) : manager.getInstalledPath(source, "user");
      if (installed && fs.existsSync(installed)) continue;
      const id = `${scope}:missing-package:${source}`;
      if (seen.has(id)) continue;
      seen.add(id);
      result.push({ id, name: source, path: installed ?? source, scope, source, origin: projectConfigDir === ".pi" ? "pi" : "em",
        enabledInPi: false, approved: false, fingerprint: "", status: "missing", error: "来源尚未安装或路径不存在" });
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
