/**
 * Pi 单会话封装 — create/resume/prompt/steer/abort/dispose
 *
 * 通过 pi-sdk.ts wrapper 懒加载 Pi SDK（ESM-only → CJS dynamic import）
 */

import * as path from "node:path";
import type {
  AgentSession,
  CreateAgentSessionOptions,
  ToolDefinition,
  SessionManager,
} from "./pi-sdk";
import {
  createAgentSession,
  getSessionManagerClass,
  getDefaultResourceLoaderClass,
  getCreateCodingTools,
} from "./pi-sdk";
import { createEnhancedBashTool } from "./background-shell/tool";
import { createEnhancedEditTool } from "./enhanced-edit";
import type { BackgroundShell } from "./background-shell/registry";
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
  /** 会话落盘目录（缺省 getPiSessionDir(cwd)）；子 Agent 传 subagents/ 子目录避免平级出现在列表 */
  sessionDir?: string;
  systemPrompt?: string;
  isDesigner?: boolean;
  /** 额外的工具（task 等）。createPiSession 会自动追加基础 coding 工具 */
  extraTools?: ToolDefinition[];
  /** 权限回调：对所有工具（含基础 coding 工具）生效；缺省不包装 */
  canUseTool?: (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions) => Promise<PermissionResult>;
  /** 后台 shell 进程退出回调（主会话传入,结果注入主会话；缺省不通知） */
  onShellExit?: (shell: BackgroundShell) => void;
}

// ── 工厂函数 ────────────────────────────────────────

async function buildSession(
  opts: PiSessionOptions,
  sessionManager: SessionManager,
): Promise<AgentSession> {
  const settingsMgr = await getSettingsManager(opts.cwd, opts.agentDir);
  const modelRuntime = await getModelRuntime(opts.store);
  const DRL = await getDefaultResourceLoaderClass();
  const createTools = await getCreateCodingTools();

  // 保持 Pi SDK 默认行为：资源发现（AGENTS.md/CLAUDE.md、项目 .pi/、SYSTEM.md 等）不做限制，
  // 仅用 systemPromptOverride 注入 EM 的 Mint 提示词（EM 在 Pi 默认行为之上扩展）
  const resourceLoader = new DRL({
    cwd: opts.cwd,
    agentDir: opts.agentDir,
    settingsManager: settingsMgr as any,
    systemPromptOverride: opts.systemPrompt ? () => opts.systemPrompt! : undefined,
  });
  await resourceLoader.reload();

  const codingTools = createTools(opts.cwd);
  // bash 用增强版替换(原生 + background 参数):同名工具后者覆盖前者(agent-session Map.set)
  // 放在最后,确保覆盖 codingTools 中的原生 bash
  const enhancedBash = await createEnhancedBashTool(opts.cwd, { onExit: opts.onShellExit });
  // edit 用增强版替换(原生 + diff 注入返回文本):Mint 可见变更内容
  const enhancedEdit = await createEnhancedEditTool(opts.cwd);
  const codingToolsReplaced = codingTools.filter((t) => t.name !== "bash" && t.name !== "edit");
  // 统一权限包装：extraTools 与基础 coding 工具（Read/Write/Edit/Bash 等）全部生效
  const wrapAll = (tools: ToolDefinition[]): ToolDefinition[] =>
    opts.canUseTool ? tools.map((t) => wrapToolWithPermission(t, { canUseTool: opts.canUseTool })) : tools;
  const tools = [...wrapAll(opts.extraTools ?? []), ...wrapAll(codingToolsReplaced), ...wrapAll([enhancedBash, enhancedEdit])];

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
  const sessionDir = opts.sessionDir ?? getPiSessionDir(opts.cwd);
  const SM = await getSessionManagerClass();
  const sessionManager = SM.create(opts.cwd, sessionDir);
  return buildSession(opts, sessionManager);
}

export async function resumePiSession(opts: PiSessionOptions): Promise<AgentSession> {
  if (!opts.resumeSessionFile) {
    throw new Error("resumeSessionFile is required for resume");
  }
  const sessionDir = getPiSessionDir(opts.cwd);
  const SM = await getSessionManagerClass();
  const sessionManager = SM.open(opts.resumeSessionFile, sessionDir, opts.cwd);
  return buildSession(opts, sessionManager);
}

// ── 辅助 ────────────────────────────────────────────

const os = require("node:os");

/** 全局会话目录：agentDir/sessions/<项目路径编码>/（Pi 默认布局；agentDir = ~/.easymint/agent，v0.7.2 起归默认） */
export function getPiSessionDir(cwd: string): string {
  const base = path.join(os.homedir(), ".easymint", "agent", "sessions");
  const encoded = cwd.replace(/[:/\\]/g, "-");
  return path.join(base, encoded);
}

export async function listPiSessions(cwd: string) {
  const SM = await getSessionManagerClass();
  const sessionDir = getPiSessionDir(cwd);
  return SM.list(cwd, sessionDir);
}
