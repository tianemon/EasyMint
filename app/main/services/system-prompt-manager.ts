/**
 * 系统提示词管理服务（CRUD）
 *
 * 管理 Chat 模式的系统提示词 CRUD。
 * 存储在 ~/.easymint/system-prompts.json
 *
 * 提示词内容统一从 app/shared/prompts.ts 引入。
 */

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { MINT_SYSTEM_PROMPT } from "../../shared/prompts";

// ── Types ──────────────────────────────────────────

export interface SystemPrompt {
  id: string;
  name: string;
  content: string;
  isBuiltin: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SystemPromptConfig {
  prompts: SystemPrompt[];
  defaultPromptId?: string;
}

export interface SystemPromptCreateInput {
  name: string;
  content: string;
}

export interface SystemPromptUpdateInput {
  name?: string;
  content?: string;
}

// ── Constants ──────────────────────────────────────

export const BUILTIN_DEFAULT_ID = "builtin-default";
export const BUILTIN_DEFAULT_PROMPT_STRING = MINT_SYSTEM_PROMPT;

export const BUILTIN_DEFAULT_PROMPT: SystemPrompt = {
  id: BUILTIN_DEFAULT_ID,
  name: "Mint 内置提示词",
  content: BUILTIN_DEFAULT_PROMPT_STRING,
  isBuiltin: true,
  createdAt: 0,
  updatedAt: 0,
};

// ── Paths ──────────────────────────────────────────

const DATA_DIR = path.join(os.homedir(), ".easymint");
const CONFIG_PATH = path.join(DATA_DIR, "system-prompts.json");

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ── Config IO ──────────────────────────────────────

function getDefaultConfig(): SystemPromptConfig {
  return {
    prompts: [{ ...BUILTIN_DEFAULT_PROMPT }],
    defaultPromptId: BUILTIN_DEFAULT_ID,
  };
}

function readConfig(): SystemPromptConfig {
  ensureDir();

  if (!existsSync(CONFIG_PATH)) {
    return getDefaultConfig();
  }

  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const data = JSON.parse(raw) as SystemPromptConfig;

  // 确保内置提示词始终存在，且内容与源码保持同步
  const builtinIndex = data.prompts.findIndex((p) => p.id === BUILTIN_DEFAULT_ID);
  if (builtinIndex === -1) {
    data.prompts.unshift({ ...BUILTIN_DEFAULT_PROMPT });
  } else {
    data.prompts[builtinIndex] = { ...BUILTIN_DEFAULT_PROMPT };
  }

  return {
    prompts: data.prompts,
    defaultPromptId: data.defaultPromptId ?? BUILTIN_DEFAULT_ID,
  };
}

function writeConfig(config: SystemPromptConfig): void {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

// ── Public API ─────────────────────────────────────

export function getSystemPromptConfig(): SystemPromptConfig {
  return readConfig();
}

export function createSystemPrompt(input: SystemPromptCreateInput): SystemPrompt {
  const config = readConfig();
  const now = Date.now();

  const prompt: SystemPrompt = {
    id: randomUUID(),
    name: input.name,
    content: input.content,
    isBuiltin: false,
    createdAt: now,
    updatedAt: now,
  };

  config.prompts.push(prompt);
  writeConfig(config);
  return prompt;
}

export function updateSystemPrompt(id: string, input: SystemPromptUpdateInput): SystemPrompt {
  const config = readConfig();
  const index = config.prompts.findIndex((p) => p.id === id);

  if (index === -1) {
    throw new Error(`提示词不存在: ${id}`);
  }

  const prompt = config.prompts[index]!;
  if (prompt.isBuiltin) {
    throw new Error("内置提示词不可编辑");
  }

  if (input.name !== undefined) prompt.name = input.name;
  if (input.content !== undefined) prompt.content = input.content;
  prompt.updatedAt = Date.now();

  writeConfig(config);
  return prompt;
}

export function deleteSystemPrompt(id: string): void {
  const config = readConfig();
  const prompt = config.prompts.find((p) => p.id === id);

  if (!prompt) {
    throw new Error(`提示词不存在: ${id}`);
  }

  if (prompt.isBuiltin) {
    throw new Error("内置提示词不可删除");
  }

  config.prompts = config.prompts.filter((p) => p.id !== id);

  // 如果被删除的是默认提示词，重置为内置默认
  if (config.defaultPromptId === id) {
    config.defaultPromptId = BUILTIN_DEFAULT_ID;
  }

  writeConfig(config);
}

export function setDefaultPrompt(id: string | null): void {
  const config = readConfig();

  if (id !== null) {
    const exists = config.prompts.some((p) => p.id === id);
    if (!exists) {
      throw new Error(`提示词不存在: ${id}`);
    }
  }

  config.defaultPromptId = id ?? BUILTIN_DEFAULT_ID;
  writeConfig(config);
}

/**
 * 解析最终的 system prompt 文本
 * 根据 defaultPromptId 找到对应提示词，拼接日期时间和用户名。
 */
/** Return the static prompt content (no dynamic time/user). Safe to inject on every call. */
export function resolveEffectivePrompt(): string {
  const config = readConfig();
  const promptId = config.defaultPromptId ?? BUILTIN_DEFAULT_ID;
  const prompt = config.prompts.find((p) => p.id === promptId);
  return prompt?.content ?? "";
}

