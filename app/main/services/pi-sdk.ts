/**
 * Pi SDK 懒加载 wrapper
 *
 * @earendil-works/pi-coding-agent 是 ESM-only 包，不能通过 require() 加载。
 * Electron 主进程是 CJS，必须用动态 import() 访问 ESM 包。
 * 本模块统一所有 Pi 相关 import，其它文件只从这里引用。
 */

import type {
  AgentSession,
  AgentSessionEvent,
  CreateAgentSessionOptions,
  CreateAgentSessionResult,
  ToolDefinition,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// 重新导出类型（type-only 不影响运行时，esbuild 会擦除）
export type {
  AgentSession,
  AgentSessionEvent,
  CreateAgentSessionOptions,
  CreateAgentSessionResult,
  ToolDefinition,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
};

// ── 懒加载实例 ──────────────────────────────────────

let _sdk: typeof import("@earendil-works/pi-coding-agent") | null = null;

/** Pi's cache is process-wide; a fresh ResourceLoader does not invalidate factories from earlier sessions. */
export async function clearPiExtensionCache(): Promise<void> {
  const require = createRequire(path.join(__dirname, "pi-sdk.cjs"));
  const loaderPath = (require.resolve.paths("@earendil-works/pi-coding-agent") ?? [])
    .map((root) => path.join(root, "@earendil-works", "pi-coding-agent", "dist", "core", "extensions", "loader.js"))
    .find((file) => fs.existsSync(file));
  if (!loaderPath) throw new Error("找不到 Pi 扩展缓存接口");
  const loader = await import(/* @vite-ignore */ pathToFileURL(loaderPath).href);
  if (typeof loader.clearExtensionCache !== "function") throw new Error("Pi 扩展缓存接口不可用");
  loader.clearExtensionCache();
}

async function getSdk() {
  if (!_sdk) _sdk = await import("@earendil-works/pi-coding-agent");
  return _sdk;
}

/**
 * SessionManager 的**轻量加载通道**——只为了拿一个默认会话目录，不必付整包入口的代价。
 *
 * 包入口 `dist/index.js` 静态可达 994 个模块（其中 668 个是 typebox 的碎片文件）：
 * 本机实测冷导入 599ms，而只 import `dist/core/session-manager.js` 是 92ms。
 * 打包后同样成立（Electron 支持从 asar 内 ESM import，已实测）。
 *
 * 类身份不冲突：`index.js` 里的 SessionManager 就是从这个文件 re-export 的，同一模块实例。
 *
 * 回退：深路径取不到（SDK 目录结构变了）或导出的不是构造函数，直接退回整包入口——
 * 最坏情形等于改动前的行为，不会因为 SDK 升级而启动即失败。
 */
async function loadSessionManagerClassLite(): Promise<typeof SessionManager> {
  try {
    const require = createRequire(path.join(__dirname, "pi-sdk.cjs"));
    const candidates = (require.resolve.paths("@earendil-works/pi-coding-agent") ?? []).flatMap((root) => {
      const file = path.join(root, "@earendil-works", "pi-coding-agent", "dist", "core", "session-manager.js");
      // 打包后 node_modules 可能在 app.asar 里、也可能被 asarUnpack 到 app.asar.unpacked；
      // 两个前缀都试一遍（哪个存在读哪个），避免依赖打包配置的具体形态。
      return file.includes(".asar") && !file.includes(".asar.unpacked")
        ? [file, file.replace(".asar", ".asar.unpacked")]
        : [file];
    });
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue;
      const mod = await import(/* @vite-ignore */ pathToFileURL(file).href);
      if (typeof mod.SessionManager === "function") return mod.SessionManager as typeof SessionManager;
    }
  } catch (e) {
    console.warn("[pi] 轻量加载 SessionManager 失败，回退整包入口:", (e as Error).message);
  }
  return getSessionManagerClass();
}

let _sessionManagerClassLite: Promise<typeof SessionManager> | null = null;

/** 幂等；失败时清空缓存以便下次重试（与 primeSessionManagerClass 同一套自愈约定）。 */
export function getSessionManagerClassLite(): Promise<typeof SessionManager> {
  if (!_sessionManagerClassLite) {
    _sessionManagerClassLite = loadSessionManagerClassLite().catch((e: unknown) => {
      _sessionManagerClassLite = null;
      throw e;
    });
  }
  return _sessionManagerClassLite;
}

// ── 导出的异步工厂函数 ──────────────────────────────

export async function createAgentSession(
  options: CreateAgentSessionOptions,
): Promise<CreateAgentSessionResult> {
  const sdk = await getSdk();
  return sdk.createAgentSession(options);
}

export async function getModelRuntimeClass(): Promise<typeof ModelRuntime> {
  const sdk = await getSdk();
  return sdk.ModelRuntime;
}

export async function getSessionManagerClass(): Promise<typeof SessionManager> {
  const sdk = await getSdk();
  return sdk.SessionManager;
}

export async function getSettingsManagerClass(): Promise<typeof SettingsManager> {
  const sdk = await getSdk();
  return sdk.SettingsManager;
}

export async function getDefaultResourceLoaderClass(): Promise<typeof DefaultResourceLoader> {
  const sdk = await getSdk();
  return sdk.DefaultResourceLoader;
}

export async function getCreateCodingTools(): Promise<
  typeof import("@earendil-works/pi-coding-agent").createCodingTools
> {
  const sdk = await getSdk();
  return sdk.createCodingTools;
}

export async function getCreateBashToolDefinition(): Promise<
  typeof import("@earendil-works/pi-coding-agent").createBashToolDefinition
> {
  const sdk = await getSdk();
  return sdk.createBashToolDefinition;
}

export async function getCreateEditToolDefinition(): Promise<
  typeof import("@earendil-works/pi-coding-agent").createEditToolDefinition
> {
  const sdk = await getSdk();
  return sdk.createEditToolDefinition;
}

export async function getCreateReadOnlyTools(): Promise<
  typeof import("@earendil-works/pi-coding-agent").createReadOnlyTools
> {
  const sdk = await getSdk();
  return sdk.createReadOnlyTools;
}

// grep/find/ls/powershell：SDK 内置工具，但 getCreateCodingTools 只返回 read/bash/edit/write，
// 这 4 个默认不激活。这里单独取出来，在 pi-session 工具装配时补上，使所有内置工具可用。
export async function getCreateExtraBuiltinTools(): Promise<{
  createGrepToolDefinition: typeof import("@earendil-works/pi-coding-agent").createGrepToolDefinition;
  createFindToolDefinition: typeof import("@earendil-works/pi-coding-agent").createFindToolDefinition;
  createLsToolDefinition: typeof import("@earendil-works/pi-coding-agent").createLsToolDefinition;
  createPowerShellToolDefinition: typeof import("@earendil-works/pi-coding-agent").createPowerShellToolDefinition;
}> {
  const sdk = await getSdk();
  return {
    createGrepToolDefinition: sdk.createGrepToolDefinition,
    createFindToolDefinition: sdk.createFindToolDefinition,
    createLsToolDefinition: sdk.createLsToolDefinition,
    createPowerShellToolDefinition: sdk.createPowerShellToolDefinition,
  };
}

export async function getDefineToolFn() {
  const sdk = await getSdk();
  return sdk.defineTool;
}

/** Read-only parsing helpers; importing a transcript must never open/write the source session. */
export async function getSessionDataHelpers() {
  const sdk = await getSdk();
  return { currentVersion: sdk.CURRENT_SESSION_VERSION, parseSessionEntries: sdk.parseSessionEntries, migrateSessionEntries: sdk.migrateSessionEntries, buildSessionContext: sdk.buildSessionContext };
}
