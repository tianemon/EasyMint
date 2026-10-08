import { translateAppText } from "@shared/i18n/app-messages";
import { initReactI18next, useTranslation } from "react-i18next";
import { createUiI18n } from "@shared/i18n";
import type { UiLanguageState } from "@shared/i18n/locale";

export const uiI18n = createUiI18n([initReactI18next]);
export const t = uiI18n.t.bind(uiI18n);

export async function applyUiLanguage(state: UiLanguageState): Promise<void> {
  await uiI18n.changeLanguage(state.locale);
  document.documentElement.lang = state.locale;
}

interface LanguageApi {
  getUiLanguage: () => Promise<UiLanguageState>;
  onUiLanguageChanged: (callback: (state: UiLanguageState) => void) => () => void;
}

export async function connectUiLanguage(
  api: LanguageApi,
  sync: (state: UiLanguageState) => Promise<void>,
): Promise<() => void> {
  let changed = false;
  const unsubscribe = api.onUiLanguageChanged((state) => {
    changed = true;
    void sync(state);
  });
  try {
    const state = await api.getUiLanguage();
    // A broadcast received during startup is newer than the pending snapshot.
    if (!changed) await sync(state);
    return unsubscribe;
  } catch (error) {
    // Keep the subscription alive so a later successful save can recover.
    console.error("[i18n] Failed to read UI language; keeping the current language", error);
    return unsubscribe;
  }
}

// Imperative helpers and option getters read the current locale at call time.
const formattedMessages = new Map<string, { key: string; parameters?: Record<string, unknown> }>();

const APPLICATION_MESSAGE = Symbol("applicationMessage");
interface ApplicationMessageParameter { [APPLICATION_MESSAGE]: true; value: string }

// Explicitly mark application-owned nested messages. Ordinary interpolation values
// (project names, file paths, user text) must never be translated by string matching.
export function appMessage(value: string | null | undefined): ApplicationMessageParameter {
  return { [APPLICATION_MESSAGE]: true, value: value ?? "" };
}

function resolveParameters(parameters?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!parameters) return parameters;
  return Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key,
    value && typeof value === "object" && APPLICATION_MESSAGE in value
      ? appText((value as ApplicationMessageParameter).value) : value,
  ]));
}

export function uiText(key: string, parameters?: Record<string, unknown>): string {
  const options = parameters && parameters.count === undefined && parameters.v0 !== undefined
    && uiI18n.exists(`${key}_one`) && Number.isFinite(Number(parameters.v0))
    ? { ...parameters, count: Number(parameters.v0) } : parameters;
  const value = t(key, resolveParameters(options));
  if (formattedMessages.size >= 512) formattedMessages.delete(formattedMessages.keys().next().value!);
  formattedMessages.set(value, { key, parameters: options });
  return value;
}

export function appText(value: string | undefined | null): string {
  if (!value) return "";
  value = value.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
  const formatted = formattedMessages.get(value);
  return formatted ? t(formatted.key, resolveParameters(formatted.parameters)) : translateAppText(uiI18n, value);
}

export function useUiLocale(): string {
  return useTranslation().i18n.resolvedLanguage ?? "zh-CN";
}
