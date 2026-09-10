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

async function getSdk() {
  if (!_sdk) _sdk = await import("@earendil-works/pi-coding-agent");
  return _sdk;
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
