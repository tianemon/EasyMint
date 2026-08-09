/**
 * Agent Template Service — CRUD for user-defined Agent templates.
 *
 * Templates are stored in ~/.easymint/agent-templates.json
 * Injected into SDK's options.agents when a session starts.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { BUILDER_AGENT_PROMPT, EVALUATOR_AGENT_PROMPT, DESIGNER_AGENT_PROMPT, MINT_SYSTEM_PROMPT } from "../../shared/prompts";

// ── Types ──────────────────────────────────────────

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
  model?: string;
  /** 供应商 piId(需求 3:模板指定供应商,与 model 搭配) */
  provider?: string;
  /** 任意自定义角色类型(原限定 mint|builder|evaluator|designer,现已放开) */
  agentType: string;
  /** 子 Agent 思考级别(默认 medium,executor 按此创建子 session) */
  thinkingLevel?: string;
}

export interface AgentTemplateInput {
  name: string;
  description: string;
  prompt: string;
  model?: string;
  provider?: string;
  agentType?: string;
  /** 可选:子 Agent 思考级别 */
  thinkingLevel?: string;
}

// ── Storage ────────────────────────────────────────

const DATA_DIR = path.join(os.homedir(), ".easymint");
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
  writeFileSync(STORE_PATH, JSON.stringify(templates, null, 2));
}

// ── Public API ─────────────────────────────────────

export function listTemplates(): AgentTemplate[] {
  return readAll();
}

export function getTemplate(id: string): AgentTemplate | undefined {
  return readAll().find((t) => t.id === id);
}

export function createTemplate(input: AgentTemplateInput): AgentTemplate {
  const templates = readAll();
  const t: AgentTemplate = { id: randomUUID(), agentType: "custom", ...input };
  templates.push(t);
  writeAll(templates);
  return t;
}

/** 完全锁定(不可修改):Mint / Mint-D */
const LOCKED_TEMPLATE_IDS = new Set(["mint", "mint-designer"]);
/** 受限编辑(仅供应商/模型/思考等级):Builder / Evaluator */
const RESTRICTED_TEMPLATE_IDS = new Set(["default-builder", "default-evaluator"]);
const BUILTIN_TEMPLATE_IDS = new Set([...LOCKED_TEMPLATE_IDS, ...RESTRICTED_TEMPLATE_IDS]);

export function updateTemplate(id: string, input: Partial<AgentTemplateInput>): AgentTemplate {
  const templates = readAll();
  const idx = templates.findIndex((t) => t.id === id);
  if (idx === -1) throw new Error(`模板不存在: ${id}`);
  // 内置模板权限:mint/mint-designer 完全不可改;builder/evaluator 仅允许 供应商/模型/思考等级
  if (LOCKED_TEMPLATE_IDS.has(id)) {
    throw new Error("系统内置模板(Mint/Mint-D)不可修改");
  }
  if (RESTRICTED_TEMPLATE_IDS.has(id)) {
    const allowed: Partial<AgentTemplateInput> = {};
    if (input.provider !== undefined) allowed.provider = input.provider;
    if (input.model !== undefined) allowed.model = input.model;
    if (input.thinkingLevel !== undefined) allowed.thinkingLevel = input.thinkingLevel;
    input = allowed;
  }
  templates[idx] = { ...templates[idx]!, ...input };
  writeAll(templates);
  return templates[idx]!;
}

export function deleteTemplate(id: string): void {
  if (BUILTIN_TEMPLATE_IDS.has(id)) throw new Error("系统内置模板不可删除");
  const templates = readAll().filter((t) => t.id !== id);
  writeAll(templates);
}

const DEFAULTS: AgentTemplate[] = [
  {
    id: "mint",
    name: "Mint",
    description: "总调度 Agent(PM)。统筹分析需求、规划任务、协调 Builder/Evaluator 完成开发。",
    prompt: MINT_SYSTEM_PROMPT,
    agentType: "mint",
  },
  {
    id: "mint-designer",
    name: "Mint-D",
    description: "UI 设计师。将需求转化为 HTML 原型页面，在编辑器中预览。",
    prompt: DESIGNER_AGENT_PROMPT,
    agentType: "designer",
  },
  {
    id: "default-builder",
    name: "Builder",
    description: "实现代码任务。当需要实现开发任务时使用此 Agent。",
    prompt: BUILDER_AGENT_PROMPT,
    agentType: "builder",
  },
  {
    id: "default-evaluator",
    name: "Evaluator",
    description: "验收代码变更。当需要验证 Builder 的工作成果时使用此 Agent。",
    prompt: EVALUATOR_AGENT_PROMPT,
    agentType: "evaluator",
  },
];

/** Sync default templates: update existing by id, add new ones, keep user templates */
/** Default template IDs that have been removed in a newer version.
 *  On seed, these are purged from the user's local store. */
const REMOVED_DEFAULT_IDS = new Set(["default-orchestrator"]);

/** 系统内置模板 id:Mint 始终强制内置(不可修改),其余内置模板用户可编辑(编辑版持久) */
export const MINT_TEMPLATE_ID = "mint";

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
      // Mint 始终强制内置提示词;其他内置模板保留用户编辑版本
      if (d.id === MINT_TEMPLATE_ID) {
        synced.push({ ...existing, prompt: d.prompt, description: d.description });
      } else {
        synced.push(existing);
      }
    } else {
      synced.push({ ...d });
    }
  }

  writeAll(synced);
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
