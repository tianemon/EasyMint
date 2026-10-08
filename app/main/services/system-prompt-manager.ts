/**
 * 系统提示词读取服务
 *
 * 读取已有的 Chat 模式提示词配置；内置内容随源码同步。
 * 存储在 ~/.easymint/system-prompts.json
 *
 * 提示词内容统一从 app/shared/prompts.ts 引入。
 */

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { MINT_SYSTEM_PROMPT } from "../../shared/prompts";
import { emHome } from "../utils/paths";

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

const DATA_DIR = emHome();
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

/** Return the static prompt content (no dynamic time/user). Safe to inject on every call. */
export function resolveEffectivePrompt(): string {
  const config = readConfig();
  const promptId = config.defaultPromptId ?? BUILTIN_DEFAULT_ID;
  const prompt = config.prompts.find((p) => p.id === promptId);
  return prompt?.content ?? MINT_SYSTEM_PROMPT;
}
