import { DELIVERY_FIELDS } from "./project-requirements";
import { BRAND_REFERENCES } from "../../../../shared/visual-design/spec";
import { DEFAULT_DATA, type ProjectFormData } from "./ProjectFormTypes";

import { STYLE_PALETTES, STYLE_EFFECTS } from "./style-appearance";

export const PROJECT_DRAFT_KEY = "easymint_project_draft_v1";

/** Restore editable fields only, never runtime project/session identifiers. */
export function parseProjectDraft(raw: string | null): { data: ProjectFormData; step: number } | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("data" in parsed) || !parsed.data || typeof parsed.data !== "object") return null;
    const values = parsed.data as Record<string, unknown>;
    const data: ProjectFormData = { ...DEFAULT_DATA, targets: [...DEFAULT_DATA.targets], features: [] };
    for (const key of ["name", "description", "dir", "uiStyle"] as const) {
      if (typeof values[key] === "string") data[key] = values[key];
    }
    if (typeof values.uiBrand === "string" && BRAND_REFERENCES.some(brand => brand.id === values.uiBrand && brand.quality !== "reference")) data.uiBrand = values.uiBrand;
    if (["dashboard","landing","form","detail"].includes(String(values.uiLayout))) data.uiLayout = values.uiLayout as ProjectFormData["uiLayout"];
    if (STYLE_PALETTES.some((value) => value === values.uiPalette)) data.uiPalette = values.uiPalette as ProjectFormData["uiPalette"];
    if (STYLE_EFFECTS.some((value) => value === values.uiEffect)) data.uiEffect = values.uiEffect as ProjectFormData["uiEffect"];
    if (Array.isArray(values.targets) && values.targets.length && values.targets.every((value) => typeof value === "string")) data.targets = values.targets;
    if (Array.isArray(values.features)) data.features = values.features.filter((value): value is { name: string } => !!value && typeof value === "object" && typeof value.name === "string").map(({ name }) => ({ name }));
    if (["practical", "commercial", "validation", "interest", "learning", "experiment", "unknown"].includes(String(values.scene))) data.scene = values.scene as ProjectFormData["scene"];
    if (["full", "mvp", "demo"].includes(String(values.completeness))) data.completeness = values.completeness as ProjectFormData["completeness"];
    if (["none", "assistant", "agent", "multi-agent"].includes(String(values.aiIntegration))) data.aiIntegration = values.aiIntegration as ProjectFormData["aiIntegration"];
    if (["本地", "云端", "混合"].includes(String(values.deployPlatform))) data.deployPlatform = values.deployPlatform as ProjectFormData["deployPlatform"];
    if (["充足", "少量", "免费"].includes(String(values.techBudget))) data.techBudget = values.techBudget as ProjectFormData["techBudget"];
    const touched = values.deliveryTouched as Record<string, unknown> | undefined;
    data.deliveryTouched = Object.fromEntries(DELIVERY_FIELDS.filter(key => touched?.[key] === true || data[key] !== DEFAULT_DATA[key]).map(key => [key, true]));
    const step = "step" in parsed && typeof parsed.step === "number" && Number.isInteger(parsed.step) ? Math.max(0, Math.min(3, parsed.step)) : 0;
    return { data, step: data.name.trim() && data.dir.trim() ? step : 0 };
  } catch (error) {
    console.error("[project-draft] Could not restore draft", error);
    return null;
  }
}
