import { create } from "zustand";

interface SettingsState {
  theme: "dark" | "light";
  terminalFontSize: number;
  setTheme: (theme: "dark" | "light") => void;
  toggleTheme: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: "dark",
  terminalFontSize: 14,
  setTheme: (theme) => {
    document.documentElement.classList.toggle("light", theme === "light");
    set({ theme });
  },
  toggleTheme: () =>
    set((s) => {
      const next = s.theme === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("light", next === "light");
      return { theme: next };
    }),
}));
