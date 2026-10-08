import { createElement, createRef, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uiI18n } from "../lib/i18n";

vi.mock("../stores/theme-store", () => ({ useThemeStore: (select: (state: { effective: string; mode: string }) => unknown) => select({ effective: "light", mode: "light" }) }));
// Activity panels import Monaco; the actual input and Select remain real in this Node render.
vi.mock("./AgentBar", () => ({ AgentBar: () => null }));
vi.mock("./ShellBar", () => ({ ShellBar: () => null }));
vi.stubGlobal("window", { electronAPI: { platform: "darwin" } });
const { ChatInput } = await import("./ChatInput");
const { ProvidersTab } = await import("./settings/ProvidersTab");

function props(level: string): ComponentProps<typeof ChatInput> {
  return {
    projectPath: "/project", sessionId: "test-session", busy: false,
    attaches: [], setAttaches: vi.fn(), onSend: vi.fn(), onStop: vi.fn(), onPaste: vi.fn(),
    imgInputRef: createRef<HTMLInputElement>(), docInputRef: createRef<HTMLInputElement>(),
    onImgChange: vi.fn(), onDocChange: vi.fn(), permissionMode: "standard",
    onPermissionModeChange: vi.fn(), chatModel: "", onModelChange: vi.fn(),
    thinkingLevel: level, onThinkingLevelChange: vi.fn(), onStatsClick: vi.fn(),
  };
}

afterEach(async () => { await uiI18n.changeLanguage("zh-CN"); });

describe("thinking level labels in the real chat input", () => {
  it("renders the selected level in English instead of the shared Chinese label", async () => {
    await uiI18n.changeLanguage("en");
    const html = renderToStaticMarkup(createElement(ChatInput, props("high")));
    expect(html.match(/>(?:High|高)<\/span>/)?.[0]).toBe(">High</span>");
    expect(html).not.toContain(">高</span>");
  });

  it("renders every selected level in both languages without changing the level value", async () => {
    const levels = [
      ["off", "Off", "关闭"], ["minimal", "Minimal", "极低"], ["low", "Low", "轻度"],
      ["medium", "Medium", "中"], ["high", "High", "高"], ["xhigh", "Very high", "极高"], ["max", "Maximum", "最高"],
    ] as const;
    for (const language of ["en", "zh-CN", "en"] as const) {
      await uiI18n.changeLanguage(language);
      for (const [value, en, zh] of levels) {
        const input = props(value);
        const html = renderToStaticMarkup(createElement(ChatInput, input));
        expect(html.includes(`>${language === "en" ? en : zh}</span>`), `${language}: ${value}`).toBe(true);
        expect(input.thinkingLevel).toBe(value);
        expect(input.onThinkingLevelChange).not.toHaveBeenCalled();
      }
    }
  });

  it("uses the same translated label in global thinking settings", async () => {
    await uiI18n.changeLanguage("en");
    const html = renderToStaticMarkup(createElement(ProvidersTab));
    expect(html).toContain(">Medium</span>");
    expect(html).not.toContain(">中</span>");
  });

});
