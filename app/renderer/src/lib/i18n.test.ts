import { describe, expect, it, vi } from "vitest";
import type { UiLanguageState } from "@shared/i18n/locale";
import { connectUiLanguage } from "./i18n";

const en: UiLanguageState = { preference: "en", locale: "en" };
const zh: UiLanguageState = { preference: "zh-CN", locale: "zh-CN" };

function languageApi(getUiLanguage: () => Promise<UiLanguageState>) {
  let listener: (state: UiLanguageState) => void = () => {};
  const unsubscribe = vi.fn();
  return {
    getUiLanguage,
    onUiLanguageChanged: vi.fn((callback: typeof listener) => {
      listener = callback;
      return unsubscribe;
    }),
    emit: (state: UiLanguageState) => listener(state),
    unsubscribe,
  };
}

describe("window language synchronization", () => {
  it("loads the initial state and synchronizes later broadcasts without remounting", async () => {
    const api = languageApi(async () => en);
    const sync = vi.fn(async () => {});
    const off = await connectUiLanguage(api, sync);
    expect(sync).toHaveBeenCalledWith(en);
    api.emit(zh);
    expect(sync).toHaveBeenLastCalledWith(zh);
    off();
    expect(api.unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not overwrite a newer broadcast with a stale startup snapshot", async () => {
    let resolve!: (state: UiLanguageState) => void;
    const api = languageApi(() => new Promise((done) => { resolve = done; }));
    const sync = vi.fn(async () => {});
    const connecting = connectUiLanguage(api, sync);
    api.emit(en);
    resolve(zh);
    await connecting;
    expect(sync).toHaveBeenCalledExactlyOnceWith(en);
  });

  it("keeps listening after an initial read failure so settings can recover", async () => {
    const api = languageApi(async () => { throw new Error("read failed"); });
    const sync = vi.fn(async () => {});
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const off = await connectUiLanguage(api, sync);
      expect(log).toHaveBeenCalled();
      expect(api.unsubscribe).not.toHaveBeenCalled();
      api.emit(en);
      expect(sync).toHaveBeenCalledWith(en);
      off();
    } finally {
      log.mockRestore();
    }
  });
});
