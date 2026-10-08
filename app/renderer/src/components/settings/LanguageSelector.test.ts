import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uiI18n } from "../../lib/i18n";

const state = vi.hoisted(() => ({
  uiLanguage: "zh-CN",
  setUiLanguage: vi.fn(async () => {}),
  defaultProjectDir: "/projects",
  contextThreshold: 75,
  setDefaultProjectDir: vi.fn(),
  setContextThreshold: vi.fn(),
}));
vi.mock("../../stores/settings-store", () => ({
  useSettingsStore: (selector?: (value: typeof state) => unknown) => selector ? selector(state) : state,
}));
vi.mock("../../stores/theme-store", () => ({ useThemeStore: (selector: (s: { effective: string }) => unknown) => selector({ effective: "light" }) }));
vi.stubGlobal("window", { electronAPI: { platform: "darwin" } });

const { LanguageSelector } = await import("./LanguageSelector");
const { GeneralTab } = await import("./GeneralTab");
const { AboutTab } = await import("./AboutTab");

afterEach(async () => { state.uiLanguage = "zh-CN"; await uiI18n.changeLanguage("zh-CN"); });

describe("localized settings rendering", () => {
  it("renders a discoverable selector in both languages with stable stored values", async () => {
    for (const [locale, label] of [["zh-CN", "界面语言"], ["en", "Interface language"]] as const) {
      await uiI18n.changeLanguage(locale);
      for (const [value, text] of [["system", locale === "en" ? "Follow system" : "跟随系统"], ["zh-CN", "简体中文"], ["en", "English"]] as const) {
        state.uiLanguage = value;
        const html = renderToStaticMarkup(createElement(LanguageSelector));
        expect(html).toContain(label);
        expect(html).toContain(text);
        expect(html).toContain('class="em-select-trigger');
        expect(html).toContain('aria-haspopup="listbox"');
        expect(html).not.toContain("<select");
      }
    }
    expect(state.setUiLanguage).not.toHaveBeenCalled();
  });

  it("renders translated General and About entry points without changing project data", async () => {
    const zh = renderToStaticMarkup(createElement(GeneralTab));
    expect(zh).toContain("默认项目路径");
    await uiI18n.changeLanguage("en");
    const general = renderToStaticMarkup(createElement(GeneralTab));
    expect(general).toContain("Default project directory");
    expect(general).toContain("Context compaction threshold");
    expect(general).toContain('value="/projects"');
    const about = renderToStaticMarkup(createElement(AboutTab));
    expect(about).toContain("Source repository");
    expect(about).toContain("Run setup again");
  });
});
