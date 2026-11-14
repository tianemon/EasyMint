/**
 * 系统提示词读取服务
 *
 * 读取已有的 Chat 模式提示词配置；内置内容随源码同步。
 * 存储在 ~/.easymint/system-prompts.json
 *
 * 提示词内容统一从 app/shared/prompts.ts 引入。
 */

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import path from "node:path";
import { MINT_SYSTEM_PROMPT, MINT_DESIGN_BOOST } from "../../shared/prompts";
import { DEFAULT_MAIN_CHAT, UI_DESIGN_MODE_ID, DOMAIN_GUIDANCE_MODE_ID, BUILTIN_MODE_DISPLAY } from "../../shared/collaboration";
import type { MainChatProfile, CollaborationMode, ConversationConfig } from "../../shared/collaboration";
import { emHome, getResourcesDir } from "../utils/paths";
import { atomicWrite } from "./native-config-storage";

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
  conversation?: {
    useBuiltinRules?: boolean;
    main?: Partial<MainChatProfile>;
    modes?: Array<{ id: string } & Partial<Omit<CollaborationMode, "id">>>;
  };
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
    ...data,
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

const mainProfileSchema = z.object({
  nickname: z.string().trim().min(1).max(40),
  avatar: z.string().max(1024 * 1024).refine(value => !value || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)),
  personality: z.string().max(100_000),
  rules: z.string().max(100_000),
});
const modeInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(40),
  scenario: z.string().trim().max(200),
  prompt: z.string().trim().min(1).max(100_000),
  defaultEnabled: z.boolean(),
});

function builtinModes(): CollaborationMode[] {
  const guidance = readFileSync(path.join(getResourcesDir(), "prompts", "domain-guidance.md"), "utf8").trim();
  return [
    { id: UI_DESIGN_MODE_ID, name: BUILTIN_MODE_DISPLAY[UI_DESIGN_MODE_ID]!.name, scenario: BUILTIN_MODE_DISPLAY[UI_DESIGN_MODE_ID]!.scenario, prompt: MINT_DESIGN_BOOST.trim(), defaultEnabled: false, builtin: true },
    { id: DOMAIN_GUIDANCE_MODE_ID, name: BUILTIN_MODE_DISPLAY[DOMAIN_GUIDANCE_MODE_ID]!.name, scenario: BUILTIN_MODE_DISPLAY[DOMAIN_GUIDANCE_MODE_ID]!.scenario, prompt: guidance, defaultEnabled: false, builtin: true },
  ];
}

export function getConversationConfig(baseRules = resolveEffectivePrompt()): ConversationConfig {
  const saved = readConfig().conversation;
  const modes = builtinModes().map(mode => ({ ...mode, ...saved?.modes?.find(item => item.id === mode.id), builtin: true }));
  const builtinIds = new Set(modes.map(mode => mode.id));
  modes.push(...(saved?.modes ?? []).filter(mode => !builtinIds.has(mode.id)).map(mode => ({ ...modeInputSchema.parse(mode), id: mode.id, builtin: false })));
  return { main: { ...DEFAULT_MAIN_CHAT, rules: saved?.useBuiltinRules ? MINT_SYSTEM_PROMPT : baseRules, ...saved?.main }, modes };
}

function writeConversation(config: ConversationConfig, restoreBuiltinRules = false): ConversationConfig {
  const stored = readConfig();
  const useBuiltinRules = restoreBuiltinRules || stored.conversation?.useBuiltinRules;
  // 只落盘用户覆盖项；保存昵称或默认开关不应冻结未修改的内置规则。
  const defaults = { ...DEFAULT_MAIN_CHAT, rules: useBuiltinRules ? MINT_SYSTEM_PROMPT : resolveEffectivePrompt() };
  const main: Partial<MainChatProfile> = {};
  for (const key of ["nickname", "avatar", "personality", "rules"] as const) {
    if (config.main[key] !== defaults[key]) main[key] = config.main[key];
  }
  const baselines = builtinModes();
  const modes = config.modes.map(mode => {
    const baseline = baselines.find(item => item.id === mode.id);
    if (!baseline) return mode;
    const overrides: { id: string } & Partial<Omit<CollaborationMode, "id">> = { id: mode.id };
    for (const key of ["name", "scenario", "prompt", "defaultEnabled"] as const) {
      if (mode[key] !== baseline[key]) Object.assign(overrides, { [key]: mode[key] });
    }
    return overrides;
  }).filter(mode => Object.keys(mode).length > 1);
  // 同一文件保留旧版选中的基础提示词，避免升级丢失用户已有定制。
  atomicWrite(CONFIG_PATH, JSON.stringify({ ...stored, conversation: { useBuiltinRules, main, modes } }, null, 2));
  return config;
}

export function saveMainChat(input: MainChatProfile): ConversationConfig {
  const main = mainProfileSchema.parse(input);
  return writeConversation({ ...getConversationConfig(), main });
}

export function restoreMainChat(): ConversationConfig {
  return writeConversation({ ...getConversationConfig(), main: { ...DEFAULT_MAIN_CHAT, rules: MINT_SYSTEM_PROMPT } }, true);
}

export function saveCollaborationMode(input: Omit<CollaborationMode, "id" | "builtin"> & { id?: string }): ConversationConfig {
  const value = modeInputSchema.parse(input);
  const config = getConversationConfig();
  const index = value.id ? config.modes.findIndex(mode => mode.id === value.id) : -1;
  if (value.id && index < 0) throw new Error("模式不存在");
  const mode: CollaborationMode = { ...value, id: value.id ?? randomUUID(), builtin: index >= 0 && config.modes[index]!.builtin };
  if (index < 0) config.modes.push(mode);
  else config.modes[index] = mode;
  return writeConversation(config);
}

export function deleteCollaborationMode(id: string): ConversationConfig {
  const config = getConversationConfig();
  if (config.modes.find(mode => mode.id === id)?.builtin) throw new Error("内置模式不可删除");
  return writeConversation({ ...config, modes: config.modes.filter(mode => mode.id !== id) });
}

export function restoreCollaborationMode(id: string): ConversationConfig {
  const baseline = builtinModes().find(mode => mode.id === id);
  if (!baseline) throw new Error("该模式没有内置默认内容");
  const config = getConversationConfig();
  return writeConversation({ ...config, modes: config.modes.map(mode => mode.id === id ? baseline : mode) });
}

/** 仅主会话调用；子任务的模板和提示词独立组装。 */
export function conversationPromptSection(modeIds: string[], baseRules?: string): string {
  const config = getConversationConfig(baseRules);
  const enabled = config.modes.filter(mode => modeIds.includes(mode.id));
  return `<easymint_collaboration>\n当前主对话身份以本段为准。你的昵称是 ${config.main.nickname}。\n<personality>\n${config.main.personality}\n</personality>\n<user_rules>\n${config.main.rules}\n</user_rules>\n当前启用的协作模式：${enabled.map(mode => mode.name).join("、") || "标准"}。仅按下列当前模式工作，历史中的模式选择以本段为准。\n${enabled.map(mode => `<collaboration_mode name=${JSON.stringify(mode.name)}>\n${mode.id === DOMAIN_GUIDANCE_MODE_ID ? "用户已启用领域引导，沿用这个选择，不再次邀请。\n" : ""}${mode.prompt}\n</collaboration_mode>`).join("\n")}\n</easymint_collaboration>`;
}
