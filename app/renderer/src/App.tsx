import { useState, useEffect } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { ProjectPage } from "./pages/ProjectPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { WindowControls } from "./components/WindowControls";
import { useSettingsStore } from "./stores/settings-store";
import { useTabStore } from "./stores/tab-store";

export function App(): JSX.Element {
  const [setupComplete, setSetupComplete] = useState(
    localStorage.getItem("easymint_setup_complete") === "true"
  );

  // Restore persisted settings (model list, API keys, etc.) on startup.
  // Also fall back to main-process setupComplete if localStorage was lost
  // (e.g. after Electron userData path change or cache clear).
  useEffect(() => {
    useSettingsStore.getState().loadFromElectron().then(() => {
      const fromMain = useSettingsStore.getState().setupComplete;
      if (fromMain && !setupComplete) {
        localStorage.setItem("easymint_setup_complete", "true");
        setSetupComplete(true);
      }
    });
  }, []);

  // 从主进程恢复 tab 状态（macOS 合盖 GPU 恢复时 localStorage 不可靠）
  useEffect(() => {
    const restore = async () => {
      try {
        // 新窗口不恢复旧窗口的标签页（URL 参数 fresh=1 标记）
        const hashQuery = window.location.hash.split("?")[1] || "";
        if (new URLSearchParams(hashQuery).get("fresh") === "1") return;
        const backup = await window.electronAPI?.tab?.restore?.();
        if (backup?.tabs?.length) {
          const store = useTabStore.getState();
          if (store.tabs.length === 0) {
            backup.tabs.forEach((t) => store.openTab(t as any));
            if (backup.activeTabId) store.setActiveTab(backup.activeTabId);
          }
        }
      } catch { /* ignore */ }
    };
    restore();
  }, []);

  useEffect(() => {
    const handler = () => setSetupComplete(true);
    window.addEventListener("easymint-setup-complete", handler);
    return () => window.removeEventListener("easymint-setup-complete", handler);
  }, []);

  return (
    <ErrorBoundary>
      {/* Windows 自绘窗口按钮（仅 win32 渲染，fixed 定位）——所有路由之上，任何页面均可用 */}
      <WindowControls />
      <div id="app-shell">
        <HashRouter>
          {!setupComplete ? (
            <Routes>
              <Route path="*" element={<OnboardingPage />} />
            </Routes>
          ) : (
            <Routes>
              <Route path="/" element={<ProjectPage />} />
              <Route path="/project/:projectId" element={<ProjectPage />} />
            </Routes>
          )}
        </HashRouter>
      </div>
    </ErrorBoundary>
  );
}
