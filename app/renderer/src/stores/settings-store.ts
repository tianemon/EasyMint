import { create } from "zustand";

interface SettingsState {
  evaluateMode: boolean;
  claudePath: string;
  claudeVersion: string;
  setEvaluateMode: (enabled: boolean) => void;
  loadFromElectron: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  evaluateMode: false,
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

  loadFromElectron: async () => {
    try {
      if (window.electronAPI?.settings?.get) {
        const settings = await window.electronAPI.settings.get();
        set({
          evaluateMode: settings.evaluateMode ?? false,
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
