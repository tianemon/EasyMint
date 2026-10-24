import { emptyFeatureRows } from "./feature-recommendations";
import { isMobileTarget } from "@shared/project-targets";
import { DEFAULT_DATA, type DeployChoice, type ProjectFormData } from "./ProjectFormTypes";

export function deploymentChoices(targets: string[]): DeployChoice[] {
  if (targets.includes("wechat-miniprogram")) return ["auto", "client-only", "cloud-dev", "云端"];
  if (targets.some(isMobileTarget)) return ["auto", "client-only", "云端", "混合"];
  return ["auto", "本地", "云端", "混合"];
}

export function normalizeCreationData(data: ProjectFormData): ProjectFormData {
  const targets = [...new Set(data.targets)];
  const valid = deploymentChoices(targets).includes(data.deployPlatform);
  return { ...data, targets, uiStyle: data.uiStyle.trim() || DEFAULT_DATA.uiStyle, deployPlatform: valid ? data.deployPlatform : "auto",
    deliveryTouched: valid ? data.deliveryTouched : { ...data.deliveryTouched, deployPlatform: false } };
}

/** Apply user edits once; an incompatible prior choice becomes an explicit unresolved choice. */
export function updateCreationData(previous: ProjectFormData, patch: Partial<ProjectFormData>): ProjectFormData {
  const fields = ["completeness", "deployPlatform", "aiIntegration", "techBudget"] as const;
  return normalizeCreationData({ ...previous, ...patch,
    deliveryTouched: { ...previous.deliveryTouched,
      ...Object.fromEntries(fields.filter(key => key in patch).map(key => [key, true])) } });
}

export function freshCreationData(): ProjectFormData {
  return { ...DEFAULT_DATA, targets: [...DEFAULT_DATA.targets], features: emptyFeatureRows(), deliveryTouched: {} };
}
