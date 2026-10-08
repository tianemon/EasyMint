import { connectUiLanguage } from "./lib/i18n";
import { useSettingsStore } from "./stores/settings-store";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { initTheme } from "./stores/theme-store";
import "./index.css";

// Apply stored theme before first paint to avoid flash
initTheme();

// 平台标记：Windows 无红绿灯/系统标题栏，用于压缩拖拽区高度
document.documentElement.dataset.platform = window.electronAPI?.platform || "darwin";

// React StrictMode double-mount in dev can cause harmless duplicate-key warnings
const origWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (String(args[0]).includes("Encountered two children with the same key")) return;
  origWarn(...args);
};


async function mount(): Promise<void> {
  try {
    const unsubscribe = await connectUiLanguage(
      window.electronAPI.settings,
      (state) => useSettingsStore.getState().syncUiLanguage(state),
    );
    window.addEventListener("unload", unsubscribe, { once: true });
  } catch (error) {
    console.error("[i18n] Failed to load UI language; using Chinese", error);
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void mount();
