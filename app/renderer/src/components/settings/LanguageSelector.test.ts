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

afterEach(async () => { await uiI18n.changeLanguage("zh-CN"); });

describe("localized settings rendering", () => {
  it("renders a discoverable selector in both languages with stable stored values", async () => {
    const zh = renderToStaticMarkup(createElement(LanguageSelector));
    expect(zh).toContain("界面语言");
    expect(zh).toContain("跟随系统");
    await uiI18n.changeLanguage("en");
    const en = renderToStaticMarkup(createElement(LanguageSelector));
    expect(en).toContain("Interface language");
    expect(en).toContain("Follow system");
    expect(en).toContain('value="zh-CN"');
    expect(en).toContain('value="system"');
    expect(en).toContain("简体中文");
    expect(en).toContain("English");
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
