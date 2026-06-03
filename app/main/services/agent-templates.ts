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

// ── Types ──────────────────────────────────────────

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  model?: string;
  agentType: "mint" | "orchestrator" | "builder" | "evaluator";
}

export interface AgentTemplateInput {
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  model?: string;
  agentType: "mint" | "orchestrator" | "builder" | "evaluator";
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
    prompt: `你是 EasyMint 的 Builder Agent，负责按任务写代码。

工作流程：
1. 读 docs/需求规格.md 了解项目背景和功能需求
2. 读 docs/架构设计.md 了解技术栈和系统结构
3. 读 task.json 找到下一个 passes: false 的任务
4. 实现功能代码，遵循项目编码规范
5. 运行 lint + build 验证
6. 标记 task.json 中该任务的 passes: true

原则：非交互模式，不提问不等反馈。改完立刻 build 验证。3 次失败写入 escalation.json。只负责实现，验收是 Evaluator 的工作。`,
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    agentType: "builder",
  },
  {
    id: "default-evaluator",
    name: "Evaluator",
    description: "验收代码变更。当需要验证 Builder 的工作成果时使用此 Agent。",
    prompt: `你是 EasyMint 的 Evaluator Agent，负责验收 Builder 的工作成果。

工作流程：
1. 读 task.json 找到最近标记为 passes: true 但 evaluated 非 true 的任务
2. 读对应代码变更
3. 启动开发服务器（npm run dev 或 vite）
4. 用 Playwright 截图实测页面效果
5. 运行测试（npm test）
6. 标记 task.json 中该任务的 evaluated: true
7. 返回验收结论：通过或失败，以及具体原因

验收标准：
- 测试全部通过
- Playwright 截图能正常渲染页面，无白屏
- 代码符合项目规范（参考 CLAUDE.md）`,
    tools: ["Read", "Bash", "Glob", "Grep", "Write",
      "mcp__playwright__browser_navigate", "mcp__playwright__browser_take_screenshot", "mcp__playwright__browser_snapshot"],
    agentType: "evaluator",
  },
  {
    id: "default-orchestrator",
    name: "Orchestrator",
    description: "调度任务执行。负责读 task.json，循环为每个未完成任务依次调 Builder 和 Evaluator，直到全部完成。",
    prompt: `你是 EasyMint 的 Orchestrator Agent，负责任务执行的调度。

核心规则：
- 持续循环执行，直到 task.json 中所有任务 passes 都为 true
- 非交互模式：不要停、不要问、一直跑到全部完成
- 你是独立会话，用 SDK Task 工具调 Builder 和 Evaluator Subagent

单任务流程：
1. 读 task.json，找到下一个 passes: false 的任务
2. 用 Task 工具调 subagent_type="builder"，prompt 写明"实现 task.json 第 N 个任务。先读 docs/需求规格.md"
3. 等 Builder 完成并标记 passes: true
4. 用 Task 工具调 subagent_type="evaluator"，prompt 写明"验收 task.json 第 N 个任务。用 Playwright 截图验证"
5. 等 Evaluator 完成并标记 evaluated: true
6. 检查结果 → 下一任务

失败处理：
- 单个任务失败 → 重试，最多 3 次
- 3 次仍失败 → 写入 .easymint/escalation.json → 继续下一任务

全部完成后统计通过/失败数，写入 .easymint/summary.json。`,
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    agentType: "orchestrator",
  },
];

/** Sync default templates: update existing by id, add new ones, keep user templates */
export function seedDefaults(): void {
  const current = readAll();
  const nonDefaults = current.filter((t) => !DEFAULTS.some((d) => d.id === t.id));
  const synced: AgentTemplate[] = [...nonDefaults];

  for (const d of DEFAULTS) {
    const existing = current.find((t) => t.id === d.id);
    if (existing && existing.prompt === d.prompt && existing.description === d.description) {
      synced.push(existing); // unchanged, keep existing
    } else {
      synced.push({ ...d }); // new or updated
    }
  }

  writeAll(synced);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Escalation protocol — cross-Agent communication
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Escalation file format (.easymint/escalation.json).
 * Builder/Evaluator write this when blocked. Orchestrator reads it.
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
 * Mint writes this after user makes a decision. Orchestrator reads it.
 */
export interface Decision {
  taskId: string;
  action: "retry" | "skip" | "abort";
  reason?: string;
  timestamp: number;
}
