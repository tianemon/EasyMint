import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir(), getLocale: () => "en-US" } }));

vi.mock("./native-config", () => ({ getNativeConfig: vi.fn(async () => ({})) }));
import { getNativeConfig } from "./native-config";
import { Store } from "./store";
import { applyUiLanguage, saveUiLanguage, getUiLanguageState, mainUiI18n, t } from "./ui-language";

const dirs: string[] = [];
afterEach(async () => {
  await mainUiI18n.changeLanguage("zh-CN");
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeStore(): Store {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "em-ui-language-"));
  dirs.push(dir);
  return new Store(dir);
}

describe("persisted UI language", () => {
  it("defaults existing installations to Chinese and preserves unrelated settings", () => {
    const store = makeStore();
    expect(getUiLanguageState(store)).toEqual({ preference: "zh-CN", locale: "zh-CN" });
    store.saveSettings({ ...store.getSettings(), uiLanguage: "en", contextThreshold: 70 });
    const reopened = new Store(store.getDataDir());
    expect(getUiLanguageState(reopened)).toEqual({ preference: "en", locale: "en" });
    expect(reopened.getSettings().contextThreshold).toBe(70);
    const disk = JSON.parse(fs.readFileSync(path.join(store.getDataDir(), "em-settings.json"), "utf8"));
    expect(disk.appearance.language).toBe("en");
    expect(disk.uiLanguage).toBeUndefined();
  });

  it("stores the system preference separately from the effective locale and updates native labels", async () => {
    const store = makeStore();
    store.saveSettings({ ...store.getSettings(), uiLanguage: "system" });
    const changed = vi.fn();
    mainUiI18n.on("languageChanged", changed);
    try {
      expect(await applyUiLanguage(store)).toEqual({ preference: "system", locale: "en" });
      expect(changed).toHaveBeenCalledWith("en");
      expect(t("dialogs.selectProjectDirectory")).toBe("Select project directory");
      expect(t("menu.newWindow")).toBe("New Window");
      expect(new Store(store.getDataDir()).getSettings().uiLanguage).toBe("system");
    } finally {
      mainUiI18n.off("languageChanged", changed);
    }
  });

  it("waits for startup migration before writing or changing the active language", async () => {
    const store = makeStore();
    let resume!: () => void;
    vi.mocked(getNativeConfig).mockImplementationOnce(() => new Promise(resolve => { resume = () => resolve({} as never); }));
    const saving = saveUiLanguage(store, "en");
    expect(store.getSettings().uiLanguage).toBe("zh-CN");
    expect(mainUiI18n.language).toBe("zh-CN");
    resume();
    expect(await saving).toEqual({ preference: "en", locale: "en" });
    expect(new Store(store.getDataDir()).getSettings().uiLanguage).toBe("en");
  });

  it("keeps the saved and active language unchanged when migration fails", async () => {
    const store = makeStore();
    vi.mocked(getNativeConfig).mockRejectedValueOnce(new Error("migration failed"));
    await expect(saveUiLanguage(store, "en")).rejects.toThrow("migration failed");
    expect(store.getSettings().uiLanguage).toBe("zh-CN");
    expect(mainUiI18n.language).toBe("zh-CN");
  });

  it("recovers from an unsupported stored value", () => {
    const store = makeStore();
    fs.writeFileSync(path.join(store.getDataDir(), "em-settings.json"), JSON.stringify({ appearance: { language: "fr" } }));
    expect(getUiLanguageState(store)).toEqual({ preference: "zh-CN", locale: "zh-CN" });
  });
});
