import { THINKING_LABEL_KEYS, THINKING_ORDER, type ThinkingLevelValue } from "@shared/thinking-levels";
import { uiText } from "./i18n";

export function thinkingLevelLabel(level: string): string {
  return Object.hasOwn(THINKING_LABEL_KEYS, level)
    ? uiText(THINKING_LABEL_KEYS[level as ThinkingLevelValue]) : level;
}

export function thinkingLevelOptions(available?: readonly string[] | null) {
  return THINKING_ORDER
    .filter(level => !available?.length || available.includes(level))
    .map(value => ({ value, label: thinkingLevelLabel(value) }));
}
