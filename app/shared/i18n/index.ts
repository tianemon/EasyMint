import { createInstance, type Module } from "i18next";
import zhCN from "./locales/zh-CN.json";
import en from "./locales/en.json";

export const uiResources = {
  "zh-CN": { translation: zhCN },
  en: { translation: en },
};

export function createUiI18n(plugins: Module[] = []) {
  const instance = createInstance();
  for (const plugin of plugins) instance.use(plugin);
  // All resources are bundled: initAsync=false initializes before the first render.
  // https://www.i18next.com/overview/configuration-options
  void instance.init({
    resources: structuredClone(uiResources),
    lng: "zh-CN",
    supportedLngs: ["zh-CN", "en"],
    fallbackLng: "zh-CN",
    load: "currentOnly",
    keySeparator: false,
    initAsync: false,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instance;
}
