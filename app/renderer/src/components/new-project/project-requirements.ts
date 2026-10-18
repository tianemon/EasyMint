import { composeProfile, detectProfile, type ProjectDimensions } from "../../../../shared/prompts";
import { DEFAULT_DATA, type ProjectFormData } from "./ProjectFormTypes";

export const DELIVERY_FIELDS = ["completeness", "deployPlatform", "aiIntegration", "techBudget"] as const;
/** Direct creation preserves explicit choices without treating untouched defaults as requirements. */
export function deliveryContext(data: ProjectFormData, explicitOnly = false): string[] {
  const ai = { none: "无", assistant: "AI 辅助", agent: "Agent 自主决策", "multi-agent": "多 Agent 协作" };
  const values = {
    completeness: `完成度「${data.completeness}」`, deployPlatform: `部署「${data.deployPlatform}」`,
    aiIntegration: `AI 集成「${ai[data.aiIntegration]}」`, techBudget: `预算「${data.techBudget}」`,
  };
  return DELIVERY_FIELDS.filter(key => !explicitOnly || data.deliveryTouched?.[key] || data[key] !== DEFAULT_DATA[key]).map(key => values[key]);
}

export function projectProfile(data: ProjectFormData) {
  const dimensions: ProjectDimensions = {
    product: detectProfile(data.targets).id as ProjectDimensions["product"],
    deploy: data.deployPlatform === "云端" ? "cloud" : data.deployPlatform === "混合" ? "hybrid" : "local",
    ai: data.aiIntegration, storage: data.deployPlatform === "云端" ? "postgres" : "sqlite",
    productUsesAI: data.aiIntegration !== "none", needsAuth: data.deployPlatform === "云端", needsPayment: false,
  };
  return composeProfile(dimensions);
}
