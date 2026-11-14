/** 执行模板使用统一提示配置；模板不决定模型、权限或主对话人格。 */
import { randomUUID } from "node:crypto";
import { getConfiguredTemplates, getConversationConfig, getPromptDefaults, initializePromptConfigurationForStartup, removeConfiguredTemplate, saveConfiguredTemplate } from "./system-prompt-manager";

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
  agentType: string;
  customized?: boolean;
  revision?: string;
}
export interface AgentTemplateInput {
  name: string;
  description: string;
  prompt: string;
  agentType?: string;
}
export const MINT_TEMPLATE_ID = "mint";
const builtinIds = new Set(["mint", "mint-designer", "default-builder", "default-evaluator"]);
export function listTemplates(): AgentTemplate[] {
  const main = getConversationConfig().main;
  return [{ id: "mint", name: main.nickname, description: "主会话助手", prompt: main.rules, agentType: "mint" }, ...getConfiguredTemplates()];
}
export function getTemplate(id: string): AgentTemplate | undefined {
  if (id === "mint-designer") return { id, name: "UI 设计", description: "旧设计任务兼容", prompt: getPromptDefaults().legacyDesigner, agentType: "designer" };
  const templates = getConfiguredTemplates();
  const exact = templates.find(template => template.id === id);
  if (exact) return exact;
  const aliases: Record<string, string> = { builder: "default-builder", evaluator: "default-evaluator" };
  return Object.hasOwn(aliases, id) ? templates.find(template => template.id === aliases[id]) : undefined;
}
export function createTemplate(input: AgentTemplateInput): AgentTemplate {
  return saveConfiguredTemplate(randomUUID(), { ...input, agentType: input.agentType ?? "custom" });
}
export function updateTemplate(id: string, input: Partial<AgentTemplateInput>, revision?: string): AgentTemplate {
  if (id === "mint" || id === "mint-designer") throw new Error("请在主对话设置中修改");
  const before = getTemplate(id);
  if (!before) throw new Error("模板不存在");
  return saveConfiguredTemplate(id, input, revision ?? before.revision);
}
export function deleteTemplate(id: string, revision?: string): void {
  if (builtinIds.has(id)) throw new Error("系统内置模板不可删除");
  removeConfiguredTemplate(id, false, revision);
}
export function restoreTemplate(id: string, revision?: string): AgentTemplate {
  if (id === "mint" || id === "mint-designer") throw new Error("该模板不支持恢复");
  return removeConfiguredTemplate(id, true, revision)!;
}
/** 显式启动迁移；读取模板和配置接口本身保持只读。 */
export function seedDefaults(): string | undefined { return initializePromptConfigurationForStartup(); }

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
