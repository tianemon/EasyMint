import { getNativeConfig } from "./native-config";
import { app } from "electron";
import { createUiI18n } from "../../shared/i18n";
import { normalizeUiLanguage, resolveUiLocale, type UiLanguageState, type UiLanguage } from "../../shared/i18n/locale";
import type { Store } from "./store";

export const mainUiI18n = createUiI18n();
export const t = mainUiI18n.t.bind(mainUiI18n);

export function getUiLanguageState(store: Store): UiLanguageState {
  const preference = normalizeUiLanguage(store.getSettings().uiLanguage);
  return { preference, locale: resolveUiLocale(preference, app.getLocale()) };
}

export async function applyUiLanguage(store: Store): Promise<UiLanguageState> {
  const state = getUiLanguageState(store);
  await mainUiI18n.changeLanguage(state.locale);
  return state;
}

export async function saveUiLanguage(store: Store, preference: UiLanguage): Promise<UiLanguageState> {
  // Native startup migration may own an em-settings.json transaction. Waiting here
  // prevents a language write from invalidating its snapshot and aborting startup.
  await getNativeConfig(store);
  const settings = store.getSettings();
  settings.uiLanguage = preference;
  store.saveSettings(settings);
  return applyUiLanguage(store);
}
