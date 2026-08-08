import { useState, useEffect } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { ProjectPage } from "./pages/ProjectPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MigrationIncomingModal } from "./components/device/MigrationIncomingModal";
import { useSettingsStore } from "./stores/settings-store";
import { useTabStore } from "./stores/tab-store";

export function App(): JSX.Element {
  const [setupComplete, setSetupComplete] = useState(
    localStorage.getItem("easymint_setup_complete") === "true"
  );
  // 接收端迁移弹窗(全局监听,不依赖具体项目页)
  const [incomingTransfer, setIncomingTransfer] = useState<{ transferId: string; fromName: string; projectName: string; fileCount: number; totalSize: number } | null>(null);

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

  // 接收端迁移弹窗事件订阅
  useEffect(() => {
    const unsubIncoming = window.electronAPI.migration.onIncoming((d) => {
      setIncomingTransfer(d);
    });
    return () => { unsubIncoming(); };
  }, []);

  return (
    <ErrorBoundary>
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
        {/* 接收端迁移确认弹窗(全应用层) */}
        <MigrationIncomingModal
          incoming={incomingTransfer}
          onClose={() => setIncomingTransfer(null)}
          onAccept={async (transferId, targetPath) => {
            const r = await window.electronAPI.migration.accept(transferId, targetPath);
            return r;
          }}
          onReject={async (transferId) => {
            await window.electronAPI.migration.reject(transferId);
            setIncomingTransfer(null);
          }}
        />
      </div>
    </ErrorBoundary>
  );
}
