import { getDefineToolFn, type ToolDefinition } from "../pi-sdk";
import { readCache } from "../session-cache";
import { resolveParentSessionId } from "../task/registry";
import { broadcast } from "../ipc-broadcast";
import { DOMAIN_GUIDANCE_MODE_ID } from "../../../shared/collaboration";

export async function createGuidanceTool(sessionId: string): Promise<ToolDefinition> {
  const defineTool = await getDefineToolFn();
  let offered = false;
  return defineTool({
    name: "offer_domain_guidance",
    label: "建议领域引导",
    description: "用户面对陌生领域、准备制定或实质调整方案，且逐步理解专业依据会有帮助时，显示可点击的领域引导按钮。用 reason 简述当前任务适用的原因。仅提供选择，立即返回，继续原任务；已启用、已拒绝或明确的小修改不再邀请。",
    parameters: { type: "object", properties: { reason: { type: "string", maxLength: 180 } }, required: ["reason"] },
    async execute(_id: string, params: Record<string, unknown>) {
      const owner = resolveParentSessionId(sessionId);
      const cache = readCache(owner);
      let text = "当前无需再次显示领域引导选项，继续原任务。";
      if (!offered && !cache?.guidanceDeclined && !cache?.collaborationModeIds?.includes(DOMAIN_GUIDANCE_MODE_ID)) {
        const reason = typeof params.reason === "string" ? params.reason.trim().slice(0, 180) : "";
        if (!reason) throw new Error("请说明此任务适合领域引导的原因");
        offered = true;
        broadcast("agent:guidance-offer", { sessionId: owner, reason });
        text = "已提供领域引导选项，继续当前已授权任务，不等待用户点击。";
      }
      return { content: [{ type: "text" as const, text }], details: undefined };
    },
  }) as ToolDefinition;
}
