/**
 * Pi 单会话封装 — create/resume/prompt/steer/abort/dispose
 *
 * 通过 pi-sdk.ts wrapper 懒加载 Pi SDK（ESM-only → CJS dynamic import）
 */

import * as path from "node:path";
import type { AgentSession, CreateAgentSessionOptions, ToolDefinition } from "./pi-sdk";
import {
  createAgentSession,
  getSessionManagerClass,
  getDefaultResourceLoaderClass,
  getCreateCodingTools,
} from "./pi-sdk";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { getSettingsManager, getModelRuntime } from "./pi-init";
import { Store } from "./store";
import { wrapToolWithPermission } from "./permission/wrap-tool";
import type { CanUseToolOptions, PermissionResult } from "./permission/agent-permission-service";

// ── 类型 ────────────────────────────────────────────

export interface PiSessionOptions {
  cwd: string;
  agentDir: string;
  model: Model<any>;
  thinkingLevel?: ThinkingLevel;
  store: Store;
  resumeSessionFile?: string;
  systemPrompt?: string;
  isDesigner?: boolean;
  /** 额外的工具（task 等）。createPiSession 会自动追加基础 coding 工具 */
  extraTools?: ToolDefinition[];
  /** 权限回调：对所有工具（含基础 coding 工具）生效；缺省不包装 */
  canUseTool?: (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions) => Promise<PermissionResult>;
}

// ── 工厂函数 ────────────────────────────────────────

async function buildSession(
  opts: PiSessionOptions,
  sessionManager: Awaited<ReturnType<typeof getSessionManagerClass>>["prototype"],
): Promise<AgentSession> {
  const settingsMgr = await getSettingsManager();
  const modelRuntime = await getModelRuntime(opts.store);
  const DRL = await getDefaultResourceLoaderClass();
  const createTools = await getCreateCodingTools();

  const resourceLoader = new DRL({
    cwd: opts.cwd,
    agentDir: opts.agentDir,
    settingsManager: settingsMgr as any,
    systemPromptOverride: opts.systemPrompt ? () => opts.systemPrompt! : undefined,
    noSkills: true,
  });
  await resourceLoader.reload();

  const codingTools = createTools(opts.cwd);
  // 统一权限包装：extraTools 与基础 coding 工具（Read/Write/Edit/Bash 等）全部生效
  const wrapAll = (tools: ToolDefinition[]): ToolDefinition[] =>
    opts.canUseTool ? tools.map((t) => wrapToolWithPermission(t, { canUseTool: opts.canUseTool })) : tools;
  const tools = [...wrapAll(opts.extraTools ?? []), ...wrapAll(codingTools)];

  const sessionOpts: CreateAgentSessionOptions = {
    cwd: opts.cwd,
    agentDir: opts.agentDir,
    modelRuntime: modelRuntime as any,
    model: opts.model as any,
    thinkingLevel: opts.thinkingLevel ?? "medium",
    settingsManager: settingsMgr as any,
    resourceLoader,
    sessionManager: sessionManager as any,
    customTools: tools,
    noTools: "builtin",
  };

  const { session } = await createAgentSession(sessionOpts);
  return session;
}

export async function createPiSession(opts: PiSessionOptions): Promise<AgentSession> {
  const sessionDir = getPiSessionDir(opts.cwd);
  const SM = await getSessionManagerClass();
  const sessionManager = SM.create(opts.cwd, sessionDir);
  return buildSession(opts, sessionManager as any);
}

export async function resumePiSession(opts: PiSessionOptions): Promise<AgentSession> {
  if (!opts.resumeSessionFile) {
    throw new Error("resumeSessionFile is required for resume");
  }
  const sessionDir = getPiSessionDir(opts.cwd);
  const SM = await getSessionManagerClass();
  const sessionManager = SM.open(opts.resumeSessionFile, sessionDir, opts.cwd);
  return buildSession(opts, sessionManager as any);
}

// ── 辅助 ────────────────────────────────────────────

const os = require("node:os");

/** 全局会话目录：~/.easymint/sessions/<项目路径编码>/ */
export function getPiSessionDir(cwd: string): string {
  const base = path.join(os.homedir(), ".easymint", "sessions");
  const encoded = cwd.replace(/[:/\\]/g, "-");
  return path.join(base, encoded);
}

export async function listPiSessions(cwd: string) {
  const SM = await getSessionManagerClass();
  const sessionDir = getPiSessionDir(cwd);
  return SM.list(cwd, sessionDir);
}
