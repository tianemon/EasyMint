import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "auto";

const STORAGE_KEY = "easymint_theme";

function readStored(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch { /* localStorage blocked */ }
  return "auto";
}

function resolveEffective(mode: ThemeMode): "light" | "dark" {
  if (mode === "auto") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}

function applyDataTheme(mode: ThemeMode): void {
  document.documentElement.setAttribute("data-theme", resolveEffective(mode));
}

interface ThemeState {
  mode: ThemeMode;
  effective: "light" | "dark";
  toggle: () => void;
  setMode: (m: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: readStored(),
  effective: resolveEffective(readStored()),

  toggle: () => {
    const order: ThemeMode[] = ["light", "dark", "auto"];
    const idx = order.indexOf(get().mode);
    const next = order[(idx + 1) % order.length]!;
    get().setMode(next);
  },

  setMode: (m: ThemeMode) => {
    try { localStorage.setItem(STORAGE_KEY, m); } catch { /* */ }
    applyDataTheme(m);
    set({ mode: m, effective: resolveEffective(m) });
  },
}));

/** Call once at app startup. Applies the stored theme and starts listening
 *  for system preference changes (for auto mode). */
export function initTheme(): void {
  const stored = readStored();
  applyDataTheme(stored);

  // Listen for system theme changes — only applies when mode is "auto"
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    const s = useThemeStore.getState();
    if (s.mode === "auto") {
      applyDataTheme("auto");
      useThemeStore.setState({ effective: resolveEffective("auto") });
    }
  });

  // Listen for storage changes from other windows
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      const m = (e.newValue || "auto") as ThemeMode;
      applyDataTheme(m);
      useThemeStore.setState({ mode: m, effective: resolveEffective(m) });
    }
  });
}
