/**
 * Pi 单会话封装 — create/resume/prompt/steer/abort/dispose
 *
 * 参考：Proma pi-agent-adapter.ts
 */

import * as path from "node:path";
import {
  createAgentSession,
  SessionManager,
  DefaultResourceLoader,
  type AgentSession,
  type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getSettingsManager } from "./pi-init";
import { getBaseTools } from "./tool-registry";
import { Store } from "./store";

// ── 类型 ────────────────────────────────────────────

export interface PiSessionOptions {
  cwd: string;
  agentDir: string;
  model: Model<any>;
  thinkingLevel?: ThinkingLevel;
  store: Store;
  /** 恢复已有会话的 session 文件路径 */
  resumeSessionFile?: string;
  /** 系统提示词覆盖，直接从 prompts.ts 组装后传入 */
  systemPrompt?: string;
  /** 是否为设计模式（designer 会话） */
  isDesigner?: boolean;
}

// ── 工厂函数 ────────────────────────────────────────

/**
 * 创建新的 Pi AgentSession
 */
export async function createPiSession(opts: PiSessionOptions): Promise<AgentSession> {
  const sessionDir = getSessionDir(opts.cwd);
  const settingsMgr = getSettingsManager();

  const sessionManager = SessionManager.create(opts.cwd, sessionDir);

  const resourceLoader = new DefaultResourceLoader({
    cwd: opts.cwd,
    agentDir: opts.agentDir,
    settingsManager: settingsMgr,
    systemPromptOverride: opts.systemPrompt ? () => opts.systemPrompt! : undefined,
    noSkills: true, // 步骤五前暂不加载 Skills
  });
  await resourceLoader.reload();

  const tools = getBaseTools(opts.cwd);

  const sessionOpts: CreateAgentSessionOptions = {
    cwd: opts.cwd,
    agentDir: opts.agentDir,
    model: opts.model,
    thinkingLevel: opts.thinkingLevel ?? "medium",
    settingsManager: settingsMgr,
    resourceLoader,
    sessionManager,
    customTools: tools,
    noTools: "builtin", // 禁用 Pi 默认的 built-in，只用我们的 customTools
  };

  const { session } = await createAgentSession(sessionOpts);
  return session;
}

/**
 * 恢复已有 Pi AgentSession
 */
export async function resumePiSession(opts: PiSessionOptions): Promise<AgentSession> {
  const sessionDir = getSessionDir(opts.cwd);
  const settingsMgr = getSettingsManager();

  if (!opts.resumeSessionFile) {
    throw new Error("resumeSessionFile is required for resume");
  }

  const sessionManager = SessionManager.open(opts.resumeSessionFile, sessionDir, opts.cwd);

  const resourceLoader = new DefaultResourceLoader({
    cwd: opts.cwd,
    agentDir: opts.agentDir,
    settingsManager: settingsMgr,
    systemPromptOverride: opts.systemPrompt ? () => opts.systemPrompt! : undefined,
    noSkills: true,
  });
  await resourceLoader.reload();

  const tools = getBaseTools(opts.cwd);

  const { session } = await createAgentSession({
    cwd: opts.cwd,
    agentDir: opts.agentDir,
    model: opts.model,
    thinkingLevel: opts.thinkingLevel ?? "medium",
    settingsManager: settingsMgr,
    resourceLoader,
    sessionManager,
    customTools: tools,
    noTools: "builtin",
  });

  return session;
}

// ── 辅助 ────────────────────────────────────────────

/** 获取会话存储目录 */
function getSessionDir(cwd: string): string {
  return path.join(cwd, ".easymint", "pi-sessions");
}

/** 列出项目下的所有会话 */
export async function listPiSessions(cwd: string) {
  const sessionDir = getSessionDir(cwd);
  return SessionManager.list(cwd, sessionDir);
}
