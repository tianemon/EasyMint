import { BUILTIN_MODE_DISPLAY, type CollaborationMode } from "@shared/collaboration";
import { uiText } from "./i18n";

export function modeDisplay(mode: Pick<CollaborationMode, "name" | "scenario"> & Partial<CollaborationMode>, field: "name" | "scenario"): string {
  const baseline = mode.id ? BUILTIN_MODE_DISPLAY[mode.id] : undefined;
  return mode.builtin && baseline && mode[field] === baseline[field] ? uiText(baseline[`${field}Key`]) : mode[field];
}
