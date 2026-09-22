/**
 * Agent Template Service — CRUD for user-defined Agent templates.
 *
 * Templates are stored in ~/.easymint/agent-templates.json
 * Injected into SDK's options.agents when a session starts.
 *
 * **模板只承载人设**：子 Agent 的模型与思考等级一律跟随主会话
 * （2026-09-16 用户拍板「必须收敛到一处决定，取消全部子 agent 的配置入口」），
 * 模板上没有任何运行配置字段。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BUILDER_AGENT_PROMPT, EVALUATOR_AGENT_PROMPT, DESIGNER_AGENT_PROMPT, MINT_SYSTEM_PROMPT } from "../../shared/prompts";
import { DESIGNER_TEMPLATE_FILES, START_POINT_FREE, START_POINT_TEMPLATE_PREFIX } from "../../shared/designer-templates";
import { emHome } from "../utils/paths";

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

/**
 * 内置模板:不可修改、不可删除。
 *
 * Mint / Mint-D 一向完全锁定;Builder / Evaluator 原为「受限编辑」(仅允许改
 * 供应商/模型/思考等级)——那三个字段随运行配置收敛而消失,受限编辑已无字段可编辑,
 * 故四个内置统一为只读。要定制请新建自定义模板。
 */
const BUILTIN_TEMPLATE_IDS = new Set(["mint", "mint-designer", "default-builder", "default-evaluator"]);

export function updateTemplate(id: string, input: Partial<AgentTemplateInput>): AgentTemplate {
  const templates = readAll();
  const idx = templates.findIndex((t) => t.id === id);
  if (idx === -1) throw new Error(`模板不存在: ${id}`);
  if (BUILTIN_TEMPLATE_IDS.has(id)) {
    throw new Error("系统内置模板不可修改——如需定制请新建自定义模板");
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
    description: "UI 设计师。将需求转化为 HTML 原型页面，在编辑器中预览。"
      // 调用契约写在该模板自己身上：task 工具的模板清单由 id+名称+描述拼成，
      // 这段因此会随清单带出、委派方（Mint）可见。task 工具**不特判任何业务角色**——
      // 谁有特殊调用要求，谁在自己的描述里声明。
      + `委派时必须写明起点：\`${START_POINT_TEMPLATE_PREFIX}<文件名>\`（可用 ${DESIGNER_TEMPLATE_FILES.join(" / ")}）或 \`${START_POINT_FREE}\`（附方向）——子 Agent 不自选版式，也不会去翻目录。`,
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
      // Mint 始终强制内置提示词;其余内置模板保留用户看到的那份(它们本就不可改)
      synced.push(d.id === MINT_TEMPLATE_ID
        ? { ...existing, prompt: d.prompt, description: d.description }
        : existing);
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
