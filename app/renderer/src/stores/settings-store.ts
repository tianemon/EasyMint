import { create } from "zustand";

interface SettingsState {
  theme: "dark" | "light";
  evaluateMode: boolean;
  claudePath: string;
  claudeVersion: string;
  setTheme: (theme: "dark" | "light") => void;
  toggleTheme: () => void;
  setEvaluateMode: (enabled: boolean) => void;
  loadFromElectron: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: "dark",
  evaluateMode: false,
  claudePath: "",
  claudeVersion: "",

  setTheme: (theme) => {
    document.documentElement.classList.toggle("light", theme === "light");
    set({ theme });
    if (window.electronAPI?.settings?.set) {
      window.electronAPI.settings.set("theme", theme);
    }
  },

  toggleTheme: () =>
    set((s) => {
      const next = s.theme === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("light", next === "light");
      if (window.electronAPI?.settings?.set) {
        window.electronAPI.settings.set("theme", next);
      }
      return { theme: next };
    }),

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
          theme: settings.theme || "dark",
          evaluateMode: settings.evaluateMode ?? false,
        });
        document.documentElement.classList.toggle(
          "light",
          settings.theme === "light"
        );
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
