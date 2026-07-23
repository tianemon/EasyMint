/**
 * Pi 单会话封装 — create/resume/prompt/steer/abort/dispose
 *
 * 通过 pi-sdk.ts wrapper 懒加载 Pi SDK（ESM-only → CJS dynamic import）
 */

import * as path from "node:path";
import type { AgentSession, CreateAgentSessionOptions } from "./pi-sdk";
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

  const tools = createTools(opts.cwd);

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
  const sessionDir = getSessionDir(opts.cwd);
  const SM = await getSessionManagerClass();
  const sessionManager = SM.create(opts.cwd, sessionDir);
  return buildSession(opts, sessionManager as any);
}

export async function resumePiSession(opts: PiSessionOptions): Promise<AgentSession> {
  if (!opts.resumeSessionFile) {
    throw new Error("resumeSessionFile is required for resume");
  }
  const sessionDir = getSessionDir(opts.cwd);
  const SM = await getSessionManagerClass();
  const sessionManager = SM.open(opts.resumeSessionFile, sessionDir, opts.cwd);
  return buildSession(opts, sessionManager as any);
}

// ── 辅助 ────────────────────────────────────────────

function getSessionDir(cwd: string): string {
  return path.join(cwd, ".easymint_pi_core", "pi-sessions");
}

export async function listPiSessions(cwd: string) {
  const SM = await getSessionManagerClass();
  const sessionDir = getSessionDir(cwd);
  return SM.list(cwd, sessionDir);
}
