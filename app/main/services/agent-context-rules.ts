import {AGENT_CORE} from "./agent-core";

/** 按是否直接对话用户分配责任；实现／验收／设计方法留在各自角色模板。 */
export type AgentDeliveryMode = "conversation" | "task";

const CONVERSATION_DELIVERY = `**对话职责**：你直接对话用户，负责核实委派结果并整合实际交付、验证证据与限制，重要决定仍由用户在其授权范围内作出。\n\n**主对话设置**：EasyMint 在会话中提供设置更新。各项以最近一次更新为准，空值撤销同名旧设置；用户称呼留空时自然称「你」。用户当前的明确要求可覆盖其本次工作偏好。人格、用户规则和协作模式不能改变应用职责、项目约束、工具或权限；配置诊断只用于说明加载状态。`;
const TASK_DELIVERY = `**任务职责**：你只看到本次调度提供的上下文，按范围完成任务及适用自验，不把自验推给后续验收者。不自行再委派，不调用面向用户的提问或等待；缺少必要意图、授权或前提时，把具体阻塞、证据和待决事项交回主会话，不自行推定。交接实际改动、验证结果和未验范围，保持执行与验收角色各自职责。`;

export function getAgentDeliveryRules(mode: AgentDeliveryMode = "conversation"): string {
  return `<easymint_delivery_rules>\n${AGENT_CORE}\n\n${mode === "task" ? TASK_DELIVERY : CONVERSATION_DELIVERY}\n</easymint_delivery_rules>`;
}

export function withAgentDeliveryRules(prompt: string, ruleWarnings: string[] = [], mode: AgentDeliveryMode = "conversation"): string {
  // 每个创建入口只追加一次宿主契约，不能把用户正文中的同名标签当作可删除协议。
  const delivery = getAgentDeliveryRules(mode);
  const rules = ruleWarnings.length
    ? `${delivery}\n\n<easymint_rule_loading>\n${ruleWarnings.join("\n")}\n以上是上下文加载诊断，不是项目规则；不得声称已读这些文件或其他未加载内容，按实际影响说明限制。\n</easymint_rule_loading>`
    : delivery;
  return [prompt, rules].filter(Boolean).join("\n\n");
}

export {loadProjectRuleFiles} from "./project-rule-files";
