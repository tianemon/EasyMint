import { describe, expect, it } from "vitest";
import { createUiI18n } from "./index";
import { isUiLanguage, normalizeUiLanguage, resolveUiLocale } from "./locale";

describe("UI language resolution", () => {
  it("defaults missing and invalid preferences to system and preserves explicit choices", () => {
    for (const value of [undefined, null, "fr", "en-US", {}, 1]) {
      expect(normalizeUiLanguage(value)).toBe("system");
      expect(isUiLanguage(value)).toBe(false);
    }
    for (const value of ["zh-CN", "en", "system"] as const) {
      expect(normalizeUiLanguage(value)).toBe(value);
    }
  });

  it("resolves system variants while explicit preferences take precedence", () => {
    for (const value of ["zh", "zh-CN", "zh-SG", "zh-TW", "zh-HK", "zh-MO", "zh-Hans", "zh-Hant", "zh-Hant-TW", "ZH_hant"]) {
      expect(resolveUiLocale("system", value)).toBe("zh-CN");
    }
    for (const value of ["en-US", "fr-FR", "", "zhong"]) {
      expect(resolveUiLocale("system", value)).toBe("en");
    }
    expect(resolveUiLocale("zh-CN", "en-US")).toBe("zh-CN");
    expect(resolveUiLocale("en", "zh-CN")).toBe("en");
  });

  it("initializes synchronously and formats complete dynamic sentences", async () => {
    const i18n = createUiI18n();
    expect(i18n.t("common.cancel")).toBe("取消");
    await i18n.changeLanguage("en");
    expect(i18n.t("dialogs.enableExtensionMessage", { name: "My Extension" })).toBe("Enable “My Extension” in EasyMint?");
    expect(i18n.t("onboarding.models", { count: 1, model: "test" })).toBe("1 model · test");
    expect(i18n.t("onboarding.models", { count: 2, model: "test" })).toBe("2 models · test");
    await i18n.changeLanguage("zh-CN");
    expect(i18n.t("onboarding.models", { count: 2, model: "test" })).toBe("模型 2 个 · test");
  });

  it("falls back to Chinese if an English resource is missing without mutating other instances", async () => {
    const i18n = createUiI18n();
    const other = createUiI18n();
    i18n.removeResourceBundle("en", "translation");
    await i18n.changeLanguage("en");
    expect(i18n.t("common.cancel")).toBe("取消");
    expect(other.getFixedT("en")("common.cancel")).toBe("Cancel");
  });
});
