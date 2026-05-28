import { create } from "zustand";

interface SettingsState {
  evaluateMode: boolean;
  tddMode: boolean;
  screenshotVerification: boolean;
  claudePath: string;
  claudeVersion: string;
  setEvaluateMode: (enabled: boolean) => void;
  setTddMode: (enabled: boolean) => void;
  setScreenshotVerification: (enabled: boolean) => void;
  loadFromElectron: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  evaluateMode: false,
  tddMode: false,
  screenshotVerification: false,
  claudePath: "",
  claudeVersion: "",

  setEvaluateMode: (enabled) => {
    set({ evaluateMode: enabled });
    if (window.electronAPI?.settings?.set) {
      window.electronAPI.settings.set("evaluateMode", enabled);
    }
    if (window.electronAPI?.evaluator?.setEnabled) {
      window.electronAPI.evaluator.setEnabled(enabled);
    }
  },

  setTddMode: (enabled) => {
    set({ tddMode: enabled });
    if (window.electronAPI?.settings?.set) {
      window.electronAPI.settings.set("tddMode", enabled);
    }
  },

  setScreenshotVerification: (enabled) => {
    set({ screenshotVerification: enabled });
    if (window.electronAPI?.settings?.set) {
      window.electronAPI.settings.set("screenshotVerification", enabled);
    }
  },

  loadFromElectron: async () => {
    try {
      if (window.electronAPI?.settings?.get) {
        const settings = await window.electronAPI.settings.get();
        set({
          evaluateMode: settings.evaluateMode ?? false,
          tddMode: settings.tddMode ?? false,
          screenshotVerification: settings.screenshotVerification ?? false,
        });
      }
    } catch {
      // mock-ipc fallback — use defaults
    }
    try {
      if (window.electronAPI?.claude?.detect) {
        const result = await window.electronAPI.claude.detect();
        if (result.found) {
          set({ claudePath: result.path ?? "", claudeVersion: result.version ?? "" });
        }
      }
    } catch {
      // Claude detection is best-effort
    }
  },
}));
