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
6. 如果 git 可用：git add . && git commit -m "[任务标题]"
7. 标记 task.json 中该任务的 passes: true

原则：非交互模式，不提问不等反馈。改完立刻 build 验证。每次完成任务必须 git commit。3 次失败写入 escalation.json。只负责实现，验收是 Evaluator 的工作。`,
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    agentType: "builder",
  },
  {
    id: "default-evaluator",
    name: "Evaluator",
    description: "验收代码变更。当需要验证 Builder 的工作成果时使用此 Agent。",
    prompt: `你是 EasyMint 的 Evaluator Agent，负责验收 Builder 的工作成果。

1. 读 task.json，找到最近 passes: true 但 evaluated 非 true 的任务
2. 读 docs/需求规格.md 了解该功能的预期行为和交互流程
3. 判断项目类型：

**Web 项目（有前端页面）：**
- 启动开发服务器
- 用 Playwright 打开对应页面，模拟用户操作流程（点击、输入、导航）
- 截图分析 UI 是否正确：布局、颜色、间距、文案是否符合规格
- 验证交互逻辑：点击有响应、表单能提交、状态切换正确
- 检查控制台无 JS 报错

**非 Web 项目（CLI/API/库）：**
- 读实现代码，对照需求规格逐项检查
- 运行测试（npm test 或等效命令）
- 用 curl 或直接调命令行验证关键功能

4. 运行 lint + build 确认无编译错误
5. 标记 task.json 中该任务的 evaluated: true
6. 输出验收结论：PASS 或 FAIL，附具体原因`,
    tools: ["Read", "Bash", "Glob", "Grep", "Write",
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
