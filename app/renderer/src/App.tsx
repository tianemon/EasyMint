import { useState, useEffect } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { ProjectPage } from "./pages/ProjectPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MigrationIncomingModal } from "./components/device/MigrationIncomingModal";
import { PairRequestModal } from "./components/device/PairRequestModal";
import { useSettingsStore } from "./stores/settings-store";
import { useTabStore } from "./stores/tab-store";

export function App(): JSX.Element {
  const [setupComplete, setSetupComplete] = useState(
    localStorage.getItem("easymint_setup_complete") === "true"
  );
  // 接收端迁移弹窗(全局监听,不依赖具体项目页)
  const [incomingTransfer, setIncomingTransfer] = useState<{ transferId: string; fromName: string; projectName: string; fileCount: number; totalSize: number } | null>(null);
  // 发送端迁移回执提示(接收端恢复完成/失败)
  const [receipt, setReceipt] = useState<{ ok: boolean; text: string } | null>(null);

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

  // 发送端迁移回执订阅(接收端恢复完成 → 提示)
  useEffect(() => {
    const unsubReceipt = window.electronAPI.migration.onReceipt((d) => {
      setReceipt({
        ok: d.ok,
        text: d.ok
          ? `迁移完成: 已在目标设备恢复「${d.projectName ?? ""}」(${d.projectPath ?? ""})`
          : `迁移失败: ${(d.failures?.length ?? 0) > 0 ? `${d.failures!.length} 个文件校验未通过` : "接收端恢复失败"}`,
      });
      setTimeout(() => setReceipt(null), 5000);
    });
    return () => { unsubReceipt(); };
  }, []);

  // Windows 防火墙放行提示(设备互联,一次性,可关闭)
  const [firewallHint, setFirewallHint] = useState<number | null>(null);
  useEffect(() => {
    return window.electronAPI.onFirewallHint(({ port }) => setFirewallHint(port));
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
        {/* 配对请求弹窗(全局,接收端确认) */}
        <PairRequestModal />
        {/* 迁移回执提示(发送端,3-5s 自动消失) */}
        {receipt && (
          <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] px-4 py-2.5 rounded-lg border shadow-lg text-sm modal-card ${receipt.ok ? "bg-surface-alt border-border text-text-primary" : "bg-surface-alt border-danger/50 text-danger"}`}>
            {receipt.text}
          </div>
        )}
        {/* Windows 防火墙放行提示(设备互联端口,一次性) */}
        {firewallHint !== null && (
          <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-3 px-4 py-2.5 rounded-lg bg-surface-alt border border-border shadow-lg text-xs text-text-primary">
            <span>设备互联需要 Windows 防火墙放行端口 {firewallHint}——首次弹窗时请勾选「专用网络」并允许访问</span>
            <button className="text-text-secondary hover:text-text-primary shrink-0" onClick={() => setFirewallHint(null)}>✕</button>
          </div>
        )}
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
