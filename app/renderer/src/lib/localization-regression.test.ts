import { afterEach, describe, expect, it, vi } from "vitest";
import { appText, appMessage, uiI18n, uiText } from "./i18n";
import { formatDate, formatNumber, formatRelativeTimestamp } from "./locale-format";
import { toolResultText } from "./tool-result-text";
import { classifyApiError } from "@shared/api-errors";
import { costFormula, formatCostCny } from "@shared/usd-cny-rate";
import { FILE_READ_HINTS } from "@shared/file-read";

vi.mock("../stores/settings-store", () => ({ useSettingsStore: { getState: () => ({ defaultProjectDir: "/projects" }) } }));
const { BUDGET_OPTIONS, TARGET_OPTIONS, UI_STYLE_OPTIONS, DEFAULT_DATA } = await import("../components/new-project/ProjectFormTypes");
afterEach(async () => { await uiI18n.changeLanguage("zh-CN"); });

describe("localization regression", () => {
  it("updates module-level display metadata without changing persisted values or default data", async () => {
    const values = BUDGET_OPTIONS.map(option => option.value);
    const targets = TARGET_OPTIONS.map(option => option.value);
    const before = structuredClone(DEFAULT_DATA);
    expect(BUDGET_OPTIONS[1].label).toBe("少量");
    await uiI18n.changeLanguage("en");
    expect(BUDGET_OPTIONS[1].label).toBe("Limited");
    expect(TARGET_OPTIONS[0].label).toBe("Web app");
    expect(UI_STYLE_OPTIONS[0].label).toBe("Minimalism");
    expect(BUDGET_OPTIONS.map(option => option.value)).toEqual(values);
    expect(TARGET_OPTIONS.map(option => option.value)).toEqual(targets);
    expect(DEFAULT_DATA).toEqual(before);
  });

  it("retranslates an existing error in both directions, preserving user-provided names", async () => {
    const original = uiText("ui.settings-store.couldNotSaveProvider", { v0: "用户供应商" });
    await uiI18n.changeLanguage("en");
    expect(appText(original)).toContain("用户供应商");
    expect(appText(original)).toContain("Could not save");
    expect(appText(FILE_READ_HINTS.missing)).toBe("File changed or deleted");
    const english = uiText("ui.AgentTemplateSettings.deleteThisTemplate");
    await uiI18n.changeLanguage("zh-CN");
    expect(appText(english)).toBe("删除此模板？");
  });

  it("retranslates explicitly marked nested errors and leaves identical user names alone", async () => {
    const value = uiText("ui.settings-store.couldNotSaveProvider", { v0: appMessage("域名解析失败（检查 Base URL）") });
    await uiI18n.changeLanguage("en");
    expect(appText(value)).toBe("Could not save provider: DNS lookup failed. Check the Base URL.");
    const name = uiText("ui.ProviderSettings.deleteAndItsApiKeyAndModel", { v0: "默认" });
    expect(name).toContain("默认");
    expect(name).not.toContain("Default");
  });

  it("can still translate long-lived errors after the bounded formatting cache evicts them", async () => {
    await uiI18n.changeLanguage("en");
    const old = uiText("ui.settings-store.couldNotSaveProvider", { v0: "用户供应商" });
    for (let index = 0; index < 600; index++) uiText("ui.ProviderSettings.modelHasNoParametersSelectItBelow", { v0: `model-${index}` });
    await uiI18n.changeLanguage("zh-CN");
    expect(appText(old)).toBe("保存供应商失败：用户供应商");
  });

  it("translates native IPC errors and prefers specific templates over generic failure text", async () => {
    await uiI18n.changeLanguage("en");
    expect(appText("Error invoking remote method 'x': Error: 目标目录已存在: /tmp/用户项目")).toBe("Target directory already exists: /tmp/用户项目");
    expect(appText("域名解析失败（检查 Base URL）")).toBe("DNS lookup failed. Check the Base URL.");
    expect(appText("This is a vendor diagnostic: E_CUSTOM_123")).toBe("This is a vendor diagnostic: E_CUSTOM_123");
  });

  it("keeps error classification independent of localized text", async () => {
    await uiI18n.changeLanguage("en");
    const classified = classifyApiError({ code: "authentication", message: "canceled" });
    expect(classified.code).toBe("authentication");
    expect(appText(classified.message)).toBe("API key invalid or expired");
    expect(classifyApiError("已停止").code).toBe("stopped");
  });

  it("formats relative dates, numbers, plurals, and CNY costs without changing currency", async () => {
    await uiI18n.changeLanguage("en");
    expect(formatDate(Date.UTC(2026, 9, 8), { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" })).toBe("October 8, 2026");
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatRelativeTimestamp(0, 60_000)).toBe("1 minute ago");
    expect(uiText("ui.DevicePanel.minutesAgo", { v0: 1 })).toBe("1 minute ago");
    expect(uiText("ui.DevicePanel.minutesAgo", { v0: 2 })).toBe("2 minutes ago");
    expect(uiText("counts.images", { count: 1 })).toBe("1 image");
    expect(uiText("counts.images", { count: 2 })).toBe("2 images");
    expect(formatCostCny(1, "en")).toBe(formatCostCny(1));
    expect(costFormula(1, "en")).toContain("central parity rate");
  });

  it("uses independent count labels for mixed Pi import totals and accurate settings guidance", async () => {
    await uiI18n.changeLanguage("en");
    const summary = uiText("ui.PiImport.providersMcpServersSessionsProjectRecords", { v0: 1, v1: 0, v2: 1, v3: 2 });
    expect(summary).toBe("Providers: 1 · MCP servers: 0 · Sessions: 1 · Project records: 2");
    expect(uiText("ui.PiImport.duplicateSessions", { v0: 1 })).toBe("Duplicate sessions: 1");
    expect(uiText("ui.PluginsTab.configurationIsStoredInEasymintMcpJson")).toContain("~/.easymint/agent/mcp.json");
    expect(uiText("ui.ProvidersTab.initialThinkingLevelForNewChatsAnd")).toContain("preferring a lower level");
  });

  it("localizes permission chrome while preserving paths and unrelated tool output", async () => {
    await uiI18n.changeLanguage("en");
    const text = toolResultText("original", { kind: "permission_denied", rule: "standard.write_scope", mode: "standard", operation: "write", target: "/用户/代码.ts", detail: "写入工作区外文件" });
    expect(text).toContain("Mode: Standard");
    expect(text).toContain("Writing outside the workspace");
    expect(text).toContain("/用户/代码.ts");
    expect(text).not.toContain("EASYMINT_PERMISSION");
    expect(toolResultText("用户文件内容：原样保留")).toBe("用户文件内容：原样保留");
  });

  it("shows the original permission mode for historical Chinese denials", async () => {
    await uiI18n.changeLanguage("en");
    const legacy = "操作被阻止：只读限制\n模式：只读\n操作：write\n目标：/tmp/a\n规则：readonly.blocked\n阶段：执行前";
    expect(toolResultText(legacy)).toBe(legacy);
    expect(toolResultText(legacy, undefined, true)).toContain("Mode: Read-only");
    expect(toolResultText("Error: " + legacy, undefined, true)).toContain("Mode: Read-only");
  });

  it("describes Full access accurately without promising credential isolation", async () => {
    await uiI18n.changeLanguage("en");
    const text = uiText("ui.permission-confirmation.mintWillBeAbleToReadAnd");
    expect(text).toContain("may access sensitive files, including credentials");
    expect(text).toContain("best-effort preflight checks only");
  });
});
