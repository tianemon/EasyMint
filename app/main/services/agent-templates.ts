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
import { BUILDER_AGENT_PROMPT, EVALUATOR_AGENT_PROMPT } from "../../shared/prompts";

// ── Types ──────────────────────────────────────────

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  model?: string;
  agentType: "mint" | "builder" | "evaluator";
}

export interface AgentTemplateInput {
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  model?: string;
  agentType: "mint" | "builder" | "evaluator";
}

// ── Storage ────────────────────────────────────────

const DATA_DIR = path.join(os.homedir(), ".easymint");
const STORE_PATH = path.join(DATA_DIR, "agent-templates.json");

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readAll(): AgentTemplate[] {
  if (!existsSync(STORE_PATH)) return [];
  try { return JSON.parse(readFileSync(STORE_PATH, "utf-8")); } catch { return []; }
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
  const t: AgentTemplate = { id: randomUUID(), ...input };
  templates.push(t);
  writeAll(templates);
  return t;
}

export function updateTemplate(id: string, input: Partial<AgentTemplateInput>): AgentTemplate {
  const templates = readAll();
  const idx = templates.findIndex((t) => t.id === id);
  if (idx === -1) throw new Error(`模板不存在: ${id}`);
  templates[idx] = { ...templates[idx]!, ...input };
  writeAll(templates);
  return templates[idx]!;
}

export function deleteTemplate(id: string): void {
  const templates = readAll().filter((t) => t.id !== id);
  writeAll(templates);
}

const DEFAULTS: AgentTemplate[] = [
  {
    id: "default-builder",
    name: "Builder",
    description: "实现代码任务。当需要实现 task.json 中的开发任务时使用此 Agent。",
    prompt: BUILDER_AGENT_PROMPT,
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "mcp__codegraph__codegraph_context", "mcp__codegraph__codegraph_impact", "mcp__codegraph__codegraph_callers", "mcp__codegraph__codegraph_search", "mcp__codegraph__codegraph_trace"],
    agentType: "builder",
  },
  {
    id: "default-evaluator",
    name: "Evaluator",
    description: "验收代码变更。当需要验证 Builder 的工作成果时使用此 Agent。",
    prompt: EVALUATOR_AGENT_PROMPT,
    tools: ["Read", "Bash", "Glob", "Grep", "Write",
      "mcp__codegraph__codegraph_context", "mcp__codegraph__codegraph_impact", "mcp__codegraph__codegraph_callers", "mcp__codegraph__codegraph_search",
      "mcp__playwright__browser_navigate", "mcp__playwright__browser_take_screenshot", "mcp__playwright__browser_snapshot",
      "mcp__playwright__browser_click", "mcp__playwright__browser_type", "mcp__playwright__browser_evaluate",
      "mcp__playwright__browser_console_messages", "mcp__playwright__browser_wait_for",
      "mcp__playwright__browser_fill_form", "mcp__playwright__browser_select_option",
      "mcp__playwright__browser_hover", "mcp__playwright__browser_press_key",
      "mcp__playwright__browser_resize", "mcp__playwright__browser_navigate_back"],
    agentType: "evaluator",
  },
];

/** Sync default templates: update existing by id, add new ones, keep user templates */
/** Default template IDs that have been removed in a newer version.
 *  On seed, these are purged from the user's local store. */
const REMOVED_DEFAULT_IDS = new Set(["default-orchestrator"]);

export function seedDefaults(): void {
  const current = readAll();
  // Purge removed defaults + keep user templates
  const keepers = current.filter((t) =>
    !REMOVED_DEFAULT_IDS.has(t.id) && !DEFAULTS.some((d) => d.id === t.id)
  );
  const synced: AgentTemplate[] = [...keepers];

  for (const d of DEFAULTS) {
    const existing = current.find((t) => t.id === d.id);
    if (existing && existing.prompt === d.prompt && existing.description === d.description) {
      synced.push(existing);
    } else {
      synced.push({ ...d });
    }
  }

  writeAll(synced);
  if (current.length !== synced.length) {
  }
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
