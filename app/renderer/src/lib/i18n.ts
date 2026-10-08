import { initReactI18next } from "react-i18next";
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
