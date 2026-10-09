export type UiLocale = "zh-CN" | "en";
export type UiLanguage = UiLocale | "system";

export interface UiLanguageState {
  preference: UiLanguage;
  locale: UiLocale;
}

export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === "zh-CN" || value === "en" || value === "system";
}

// Missing or invalid preferences follow the system; explicit choices remain unchanged.
export function normalizeUiLanguage(value: unknown): UiLanguage {
  return isUiLanguage(value) ? value : "system";
}

export function resolveUiLocale(preference: UiLanguage, systemLocale: string): UiLocale {
  if (preference !== "system") return preference;
  return /^zh(?:[-_]|$)/i.test(systemLocale) ? "zh-CN" : "en";
}
