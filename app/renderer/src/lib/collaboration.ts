import { BUILTIN_MODE_KEYS, type CollaborationMode } from "@shared/collaboration";
import { uiText } from "./i18n";

export function modeDisplay(mode: Pick<CollaborationMode, "name" | "scenario"> & Partial<CollaborationMode>, field: "name" | "scenario"): string {
  const baseline = mode.id ? BUILTIN_MODE_KEYS[mode.id] : undefined;
  return mode.builtin && baseline && !mode.customizedFields?.includes(field) ? uiText(baseline[field]) : mode[field];
}
