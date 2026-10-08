import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uiI18n } from "../lib/i18n";

vi.mock("../stores/theme-store", () => ({ useThemeStore: (selector: (value: { mode: string; effective: string }) => unknown) => selector({ mode: "light", effective: "light" }) }));
vi.stubGlobal("window", { electronAPI: { platform: "darwin", settings: { get: async () => ({}), set: async () => {} } } });

const { ProvidersTab } = await import("./settings/ProvidersTab");
const { PluginsTab } = await import("./settings/PluginsTab");
const { AppearanceTab } = await import("./settings/AppearanceTab");
const { GlowGroupManager } = await import("./settings/GlowGroupManager");
const { Step1Form, Step4Form } = await import("./new-project/StepComponents");
const { DEFAULT_DATA } = await import("./new-project/ProjectFormTypes");
const { useSettingsStore } = await import("../stores/settings-store");
const original = useSettingsStore.getState();

afterEach(async () => { useSettingsStore.setState(original); await uiI18n.changeLanguage("zh-CN"); });

describe("English interface coverage", () => {
  it("renders provider and plugin settings in English", async () => {
    await uiI18n.changeLanguage("en");
    const providers = renderToStaticMarkup(createElement(ProvidersTab));
    expect(providers).toContain("Default thinking level (chat)");
    expect(providers).toContain("Default permission mode (chat)");
    expect(providers).toContain("Web access");
    expect(providers).not.toContain("模型能力增强");
    const plugins = renderToStaticMarkup(createElement(PluginsTab));
    expect(plugins).toContain("Discover external skills");
    expect(plugins).toContain("AI-managed");
    expect(plugins).toContain("Extensions");
  });

  it("localizes untouched seeded color groups and preserves user group names", async () => {
    await uiI18n.changeLanguage("en");
    const html = renderToStaticMarkup(createElement(AppearanceTab));
    expect(html).toContain("Reading font");
    expect(html).toContain("Interface font");
    expect(html).toContain("Custom 1");
    const groups = [...original.glowGroupsLight, { id: "user-group", name: "用户组", colors: ["#ffffff"] }];
    const names = renderToStaticMarkup(createElement(GlowGroupManager, { groups, activeId: "user-group", onChangeGroups: vi.fn(), onChangeActive: vi.fn() }));
    expect(names).toContain("用户组");
    expect(names).toContain("Custom 1");
    expect(html).not.toContain("自定义 1");
  });

  it("localizes project forms without rewriting project names or deployment choices", async () => {
    const data = { ...DEFAULT_DATA, name: "用户项目" };
    const onChange = vi.fn();
    await uiI18n.changeLanguage("en");
    const basic = renderToStaticMarkup(createElement(Step1Form, { data, onChange }));
    expect(basic).toContain("Project name");
    expect(basic).toContain('value="用户项目"');
    const delivery = renderToStaticMarkup(createElement(Step4Form, { data, onChange }));
    expect(delivery).toContain("Local");
    expect(delivery).toContain("Cloud");
    expect(delivery).toContain("Development and operations budget");
    expect(data.deployPlatform).toBe("本地");
    expect(data.techBudget).toBe("少量");
    expect(onChange).not.toHaveBeenCalled();
  });
});
