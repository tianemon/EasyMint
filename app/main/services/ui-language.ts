import { app } from "electron";
import { createUiI18n } from "../../shared/i18n";
import { normalizeUiLanguage, resolveUiLocale, type UiLanguageState } from "../../shared/i18n/locale";
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
