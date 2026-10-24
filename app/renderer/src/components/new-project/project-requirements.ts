import { isMobileTarget } from "@shared/project-targets";
import { composeProfilesForTargets, detectProfile, type ProjectDimensions } from "../../../../shared/prompts";
import { normalizeCreationData } from "./creation-rules";
import { DEFAULT_DATA, type ProjectFormData } from "./ProjectFormTypes";

export const DELIVERY_FIELDS = ["completeness", "deployPlatform", "aiIntegration", "techBudget"] as const;
/** Direct creation preserves explicit choices without treating untouched defaults as requirements. */
export function deliveryContext(data: ProjectFormData, explicitOnly = false): string[] {
  data = normalizeCreationData(data);
  const ai = { none: "无", assistant: "AI 辅助", agent: "Agent 自主决策", "multi-agent": "多 Agent 协作" };
  const deployment = { auto: "让 Mint 推荐", "client-only": "无需后端", "cloud-dev": "微信云开发", 本地: "本地", 云端: "云端服务", 混合: "本机使用并连接在线服务" };
  const values = {
    completeness: `完成度「${data.completeness}」`, deployPlatform: `部署「${deployment[data.deployPlatform]}」`,
    aiIntegration: `AI 集成「${ai[data.aiIntegration]}」`, techBudget: `预算「${data.techBudget}」`,
  };
  return DELIVERY_FIELDS.filter(key => !explicitOnly || data.deliveryTouched?.[key] || data[key] !== DEFAULT_DATA[key]).map(key => values[key]);
}

export function projectProfile(data: ProjectFormData) {
  data = normalizeCreationData(data);
  const deploy = data.deployPlatform === "云端" ? "cloud" : data.deployPlatform === "混合" ? "hybrid" : data.deployPlatform === "本地" ? "local" : data.deployPlatform;
  const portable = data.targets.some(target => target === "wechat-miniprogram" || isMobileTarget(target));
  const dimensions: ProjectDimensions = {
    product: detectProfile(data.targets).id as ProjectDimensions["product"],
    deploy: portable && deploy === "hybrid" ? "client-hybrid" : deploy,
    ai: data.aiIntegration, storage: deploy === "cloud" ? "postgres" : (deploy === "local" || deploy === "hybrid") && !portable ? "sqlite" : "none",
    productUsesAI: data.aiIntegration !== "none", needsAuth: data.deployPlatform === "云端", needsPayment: false,
  };
  const profile = composeProfilesForTargets(data.targets, dimensions);
  if (data.targets.includes("harmony-mobile")) {
    profile.platformSpec += "\n- 目标包含鸿蒙应用：技术方案需明确鸿蒙目标版本、工具链与支持范围，不得只交付 iOS/Android 或默认视为已支持鸿蒙。";
    profile.suggestedStack = profile.suggestedStack.filter(stack => stack !== "Flutter" && stack !== "Dart");
  }
  return profile;
}
