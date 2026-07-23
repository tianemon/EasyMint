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
} from "@earendil-works/pi-coding-agent";

// 重新导出类型（type-only 不影响运行时，esbuild 会擦除）
export type {
  AgentSession,
  AgentSessionEvent,
  CreateAgentSessionOptions,
  CreateAgentSessionResult,
  ToolDefinition,
};

// ── 懒加载实例 ──────────────────────────────────────

let _sdk: typeof import("@earendil-works/pi-coding-agent") | null = null;
let _piAi: typeof import("@earendil-works/pi-ai") | null = null;
let _piAiCompat: typeof import("@earendil-works/pi-ai/compat") | null = null;
let _piAgentCore: typeof import("@earendil-works/pi-agent-core") | null = null;

async function getSdk() {
  if (!_sdk) _sdk = await import("@earendil-works/pi-coding-agent");
  return _sdk;
}

async function getPiAi() {
  if (!_piAi) _piAi = await import("@earendil-works/pi-ai");
  return _piAi;
}

async function getPiAiCompat() {
  if (!_piAiCompat) _piAiCompat = await import("@earendil-works/pi-ai/compat");
  return _piAiCompat;
}

async function getPiAgentCore() {
  if (!_piAgentCore) _piAgentCore = await import("@earendil-works/pi-agent-core");
  return _piAgentCore;
}

// ── 导出的异步工厂函数 ──────────────────────────────

export async function createAgentSession(
  options: CreateAgentSessionOptions,
): Promise<CreateAgentSessionResult> {
  const sdk = await getSdk();
  return sdk.createAgentSession(options);
}

export async function getModelRuntimeClass(): Promise<
  typeof import("@earendil-works/pi-coding-agent").ModelRuntime
> {
  const sdk = await getSdk();
  return sdk.ModelRuntime;
}

export async function getSessionManagerClass(): Promise<
  typeof import("@earendil-works/pi-coding-agent").SessionManager
> {
  const sdk = await getSdk();
  return sdk.SessionManager;
}

export async function getSettingsManagerClass(): Promise<
  typeof import("@earendil-works/pi-coding-agent").SettingsManager
> {
  const sdk = await getSdk();
  return sdk.SettingsManager;
}

export async function getDefaultResourceLoaderClass(): Promise<
  typeof import("@earendil-works/pi-coding-agent").DefaultResourceLoader
> {
  const sdk = await getSdk();
  return sdk.DefaultResourceLoader;
}

export async function getCreateCodingTools(): Promise<
  typeof import("@earendil-works/pi-coding-agent").createCodingTools
> {
  const sdk = await getSdk();
  return sdk.createCodingTools;
}

export async function getCreateReadOnlyTools(): Promise<
  typeof import("@earendil-works/pi-coding-agent").createReadOnlyTools
> {
  const sdk = await getSdk();
  return sdk.createReadOnlyTools;
}

export async function getDefineTool(): Promise<
  typeof import("@earendil-works/pi-coding-agent").defineTool
> {
  const sdk = await getSdk();
  return sdk.defineTool;
}

export async function getPiAiModelType(): Promise<
  typeof import("@earendil-works/pi-ai").Model
> {
  const ai = await getPiAi();
  return ai.Model;
}

export async function getPiAiCompatModule() {
  return getPiAiCompat();
}

export async function getPiAgentCoreTypes() {
  return getPiAgentCore();
}
