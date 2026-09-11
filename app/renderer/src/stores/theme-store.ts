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

/** 上报当前生效主题给主进程（macOS 用它切换 Dock 图标）。
 *  故意和 data-theme 写在同一处：界面主题与 Dock 图标共用一个真相源，不另起状态流。 */
function reportEffectiveTheme(effective: "light" | "dark"): void {
  window.electronAPI?.appearance?.setEffective?.(effective)?.catch((err: unknown) => {
    console.error("[theme] 上报生效主题失败:", err);
  });
}

function applyDataTheme(mode: ThemeMode): void {
  const effective = resolveEffective(mode);
  document.documentElement.setAttribute("data-theme", effective);
  reportEffectiveTheme(effective);
}

// 主题切换扩散动画（View Transitions）：
//  - 切换前冻结元素自身的 transition，保证快照捕获的是纯新主题画面
//  - startViewTransition 捕获新旧快照，新画面 clip-path 从角落扩散
//  - 无 startViewTransition 支持时兜底为颜色平滑过渡
function switchTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  const apply = () => applyDataTheme(mode);
  const svt = (document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } }).startViewTransition;
  if (typeof svt === "function") {
    root.classList.add("theme-vt-freeze");
    const vt = svt.call(document, apply);
    if (vt?.finished) {
      vt.finished.then(() => root.classList.remove("theme-vt-freeze")).catch(() => root.classList.remove("theme-vt-freeze"));
    } else {
      // 无 finished promise（理论不发生），直接移除
      root.classList.remove("theme-vt-freeze");
    }
  } else {
    // 兜底：无 View Transitions 时用颜色过渡
    root.classList.add("theme-transition");
    apply();
    window.setTimeout(() => root.classList.remove("theme-transition"), 300);
  }
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
    switchTheme(m);
    set({ mode: m, effective: resolveEffective(m) });
  },
}));

/** Call once at app startup. Applies the stored theme and starts listening
 *  for system preference changes (for auto mode).
 *  首帧即通过 applyDataTheme 上报一次生效主题（不能等用户手动切主题）。 */
export function initTheme(): void {
  const stored = readStored();
  applyDataTheme(stored);

  // Listen for system theme changes — only applies when mode is "auto"
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    const s = useThemeStore.getState();
    if (s.mode === "auto") {
      switchTheme("auto");
      useThemeStore.setState({ effective: resolveEffective("auto") });
    }
  });

  // Listen for storage changes from other windows
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      const m = (e.newValue || "auto") as ThemeMode;
      switchTheme(m);
      useThemeStore.setState({ mode: m, effective: resolveEffective(m) });
    }
  });
}
