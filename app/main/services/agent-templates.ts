/**
 * Agent Template Service — CRUD for user-defined Agent templates.
 *
 * Templates are stored in ~/.easymint/agent-templates.json
 * task 工具按模板 ID 选择正文，执行器在创建子会话时组装系统提示词。
 *
 * **模板只承载人设**：子 Agent 的模型与思考等级一律跟随主会话
 * （2026-09-16 用户拍板「必须收敛到一处决定，取消全部子 agent 的配置入口」），
 * 模板上没有任何运行配置字段。
 */

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BUILDER_AGENT_PROMPT, EVALUATOR_AGENT_PROMPT, DESIGNER_AGENT_PROMPT, MINT_SYSTEM_PROMPT } from "../../shared/prompts";
import { emHome } from "../utils/paths";
import { atomicWrite } from "./native-config-storage";

// ── Types ──────────────────────────────────────────

/**
 * 这里**刻意没有** model / provider / thinkingLevel：子 Agent 的运行配置只有
 * 「主会话」一个来源，所以不存在"模板配置 vs 主会话"的冲突。
 * 旧版写进 json 的这三个字段由 seedDefaults 在启动时清理（见 DEPRECATED_TEMPLATE_FIELDS）。
 */
export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
  /** 任意自定义角色类型(原限定 mint|builder|evaluator|designer,现已放开) */
  agentType: string;
  customized?: boolean;
}

export interface AgentTemplateInput {
  name: string;
  description: string;
  prompt: string;
  agentType?: string;
}

// ── Storage ────────────────────────────────────────

const DATA_DIR = emHome();
const STORE_PATH = path.join(DATA_DIR, "agent-templates.json");

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readAll(): AgentTemplate[] {
  if (!existsSync(STORE_PATH)) return [];
  return JSON.parse(readFileSync(STORE_PATH, "utf-8"));
}

function writeAll(templates: AgentTemplate[]): void {
  ensureDir();
  atomicWrite(STORE_PATH, JSON.stringify(templates, null, 2));
}

// ── Public API ─────────────────────────────────────

export function listTemplates(): AgentTemplate[] {
  return readAll().filter(template => template.id !== "mint-designer");
}

export function getTemplate(id: string): AgentTemplate | undefined {
  // 旧委派记录仍可恢复；新的模板清单不再提供独立 Mint-D。
  if (id === "mint-designer") return { id, name: "UI 设计", description: "旧设计任务兼容", prompt: DESIGNER_AGENT_PROMPT, agentType: "designer" };
  const templates = readAll();
  const aliases: Record<string, string> = { builder: "default-builder", evaluator: "default-evaluator" };
  return templates.find(template => template.id === id) ?? templates.find(template => template.id === aliases[id]);
}

export function createTemplate(input: AgentTemplateInput): AgentTemplate {
  const templates = readAll();
  const t: AgentTemplate = { id: randomUUID(), agentType: "custom", ...input };
  templates.push(t);
  writeAll(templates);
  return t;
}

/** 主对话独立配置；Builder/Evaluator 仅可编辑提示词，内置模板不可删除。 */
const BUILTIN_TEMPLATE_IDS = new Set(["mint", "mint-designer", "default-builder", "default-evaluator"]);

export function updateTemplate(id: string, input: Partial<AgentTemplateInput>): AgentTemplate {
  const templates = readAll();
  const idx = templates.findIndex((t) => t.id === id);
  if (idx === -1) throw new Error(`模板不存在: ${id}`);
  if (id === "mint" || id === "mint-designer") throw new Error("请在主对话设置中修改");
  if (BUILTIN_TEMPLATE_IDS.has(id)) {
    if (Object.keys(input).some(key => key !== "prompt")) throw new Error("内置执行模板仅支持修改提示词");
    if (!input.prompt?.trim()) throw new Error("提示词不能为空");
    templates[idx] = { ...templates[idx]!, prompt: input.prompt, customized: true };
  } else templates[idx] = { ...templates[idx]!, ...input };
  writeAll(templates);
  return templates[idx]!;
}

export function deleteTemplate(id: string): void {
  if (BUILTIN_TEMPLATE_IDS.has(id)) throw new Error("系统内置模板不可删除");
  const templates = readAll().filter((t) => t.id !== id);
  writeAll(templates);
}

export function restoreTemplate(id: string): AgentTemplate {
  const baseline = DEFAULTS.find(template => template.id === id);
  if (!baseline || id === "mint") throw new Error("该模板不支持恢复");
  const templates = readAll();
  const index = templates.findIndex(template => template.id === id);
  if (index < 0) throw new Error("模板不存在");
  templates[index] = { ...baseline };
  writeAll(templates);
  return templates[index]!;
}

const DEFAULTS: AgentTemplate[] = [
  {
    id: "mint",
    name: "Mint",
    description: "主会话助手。理解需求、直接推进实现与验证，并按任务需要协调子 Agent、整合结果。",
    prompt: MINT_SYSTEM_PROMPT,
    agentType: "mint",
  },
  {
    id: "default-builder",
    name: "Builder",
    description: "承担主会话已决定委派的独立代码实现任务，返回改动与验证证据。",
    prompt: BUILDER_AGENT_PROMPT,
    agentType: "builder",
  },
  {
    id: "default-evaluator",
    name: "Evaluator",
    description: "对指定范围独立复核实现、验证证据与风险，返回发现和验收结论。",
    prompt: EVALUATOR_AGENT_PROMPT,
    agentType: "evaluator",
  },
];

/** Sync default templates: update existing by id, add new ones, keep user templates */
/** Default template IDs that have been removed in a newer version.
 *  On seed, these are purged from the user's local store. */
const REMOVED_DEFAULT_IDS = new Set(["default-orchestrator", "mint-designer"]);

/** 系统内置模板 id:Mint 始终强制内置(不可修改,提示词随版本更新) */
export const MINT_TEMPLATE_ID = "mint";

/**
 * 已废弃的模板字段:子 Agent 的模型/供应商/思考等级改为唯一跟随主会话后,
 * 这些字段**不再被任何代码读取**。启动时一并清掉,免得 json 里留着让人以为它们生效
 * (本机 mint-designer 就残留过一个永不生效的 thinkingLevel=max)。
 *
 * 用 as const 数组而不是直接写 delete 语句:将来再废弃字段时只改这一处。
 */
const DEPRECATED_TEMPLATE_FIELDS = ["model", "provider", "thinkingLevel"] as const;

function stripDeprecatedFields(t: AgentTemplate): AgentTemplate {
  const rec = { ...(t as unknown as Record<string, unknown>) };
  for (const k of DEPRECATED_TEMPLATE_FIELDS) delete rec[k];
  return rec as unknown as AgentTemplate;
}

export function seedDefaults(): void {
  const current = readAll();
  // Purge removed defaults + keep user templates(含用户编辑过的内置模板)
  const keepers = current.filter((t) =>
    !REMOVED_DEFAULT_IDS.has(t.id) && !DEFAULTS.some((d) => d.id === t.id)
  );
  const synced: AgentTemplate[] = [...keepers];

  for (const d of DEFAULTS) {
    const existing = current.find((t) => t.id === d.id);
    if (existing) {
      // All built-in roles are read-only; task exposes their descriptions to Mint.
      // Refresh the contract while preserving names and separate user-created templates.
      synced.push({ ...existing, prompt: existing.customized && d.id !== "mint" ? existing.prompt : d.prompt, description: d.description });
    } else {
      synced.push({ ...d });
    }
  }

  writeAll(synced.map(stripDeprecatedFields));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Escalation protocol — cross-Agent communication
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Escalation file format (.easymint/escalation.json).
 * Builder/Evaluator write this when blocked. Mint reads it and reports to user.
 */
export interface Escalation {
  type: "escalation";
  from: string;        // Agent name
  taskId: string;       // task.json task id
  reason: string;       // human-readable reason
  details: string;      // detailed error / context
  options: string[];    // suggested actions, e.g. ["重试", "跳过", "人工介入"]
  timestamp: number;
}

/**
 * Decision file format (.easymint/decision.json).
 * Mint writes this after user makes a decision, then Mint continues task execution.
 */
export interface Decision {
  taskId: string;
  action: "retry" | "skip" | "abort";
  reason?: string;
  timestamp: number;
}
