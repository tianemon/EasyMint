import { create } from "zustand";

interface SettingsState {
  evaluateMode: boolean;
  tddMode: boolean;
  screenshotVerification: boolean;
  claudePath: string;
  claudeVersion: string;
  apiBaseUrl: string;
  apiKey: string;
  setEvaluateMode: (enabled: boolean) => void;
  setTddMode: (enabled: boolean) => void;
  setScreenshotVerification: (enabled: boolean) => void;
  setApiBaseUrl: (url: string) => void;
  setApiKey: (key: string) => void;
  loadFromElectron: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  evaluateMode: false,
  tddMode: false,
  screenshotVerification: false,
  claudePath: "",
  claudeVersion: "",
  apiBaseUrl: "",
  apiKey: "",

  setEvaluateMode: (enabled) => {
    set({ evaluateMode: enabled });
    window.electronAPI?.settings?.set?.("evaluateMode", enabled);
    if (window.electronAPI?.evaluator?.setEnabled) {
      window.electronAPI.evaluator.setEnabled(enabled);
    }
  },
  setTddMode: (enabled) => {
    set({ tddMode: enabled });
    window.electronAPI?.settings?.set?.("tddMode", enabled);
  },
  setScreenshotVerification: (enabled) => {
    set({ screenshotVerification: enabled });
    window.electronAPI?.settings?.set?.("screenshotVerification", enabled);
  },
  setApiBaseUrl: (url) => {
    set({ apiBaseUrl: url });
    window.electronAPI?.settings?.set?.("apiBaseUrl", url);
  },
  setApiKey: (key) => {
    set({ apiKey: key });
    window.electronAPI?.settings?.set?.("apiKey", key);
  },

  loadFromElectron: async () => {
    try {
      if (window.electronAPI?.settings?.get) {
        const settings = await window.electronAPI.settings.get();
        set({
          evaluateMode: settings.evaluateMode ?? false,
          tddMode: settings.tddMode ?? false,
          screenshotVerification: settings.screenshotVerification ?? false,
          apiBaseUrl: settings.apiBaseUrl ?? "",
          apiKey: settings.apiKey ?? "",
        });
      }
    } catch { /* mock-ipc fallback */ }
    try {
      if (window.electronAPI?.claude?.detect) {
        const result = await window.electronAPI.claude.detect();
        if (result.found) {
          set({ claudePath: result.path ?? "", claudeVersion: result.version ?? "" });
        }
      }
    } catch { /* best-effort */ }
  },
}));
