import { useEffect, useState, useCallback } from "react";
import { useSettingsStore } from "../stores/settings-store";
import { readVersion, markRead } from "../lib/update-notice";
import { GeneralTab } from "./settings/GeneralTab";
import { AppearanceTab } from "./settings/AppearanceTab";
import { PluginsTab } from "./settings/PluginsTab";
import { AgentTab } from "./settings/AgentTab";
import { ProvidersTab } from "./settings/ProvidersTab";
import { AboutTab } from "./settings/AboutTab";

export type SettingsTab = "general" | "appearance" | "plugins" | "providers" | "agent" | "about";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
}

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "通用" },
  { id: "appearance", label: "界面" },
  { id: "providers", label: "模型" },
  { id: "plugins", label: "插件" },
  { id: "agent", label: "Agent" },
  { id: "about", label: "关于" },
];

export function SettingsDialog({ open, onClose, initialTab }: SettingsDialogProps): JSX.Element | null {
  const { loadFromElectron } = useSettingsStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab || "general");
  // 可更新版本(订阅广播):「关于」标题红点,进入关于页即已读
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);

  // 外部指定 initialTab 时同步（如点「有新版本」→ 跳到关于页）
  useEffect(() => { if (initialTab) setActiveTab(initialTab); }, [initialTab]);

  // 订阅更新状态:available/downloading/downloaded 记录版本(红点);no-update/error 清除
  useEffect(() => {
    const off = window.electronAPI?.app?.onUpdateStatus?.((data: { status: string; version?: string }) => {
      if (data.status === "available" || data.status === "downloading" || data.status === "downloaded") {
        setUpdateVersion(data.version ?? null);
      } else if (data.status === "no-update" || data.status === "error") {
        setUpdateVersion(null);
      }
    });
    return () => { off?.(); };
  }, []);

  // 进入「关于」页 → 标题红点已读
  useEffect(() => {
    if (activeTab === "about" && updateVersion) markRead("tab", updateVersion);
  }, [activeTab, updateVersion]);

  const aboutDot = updateVersion != null && updateVersion !== readVersion("tab");

  useEffect(() => {
    if (!open) return;
    loadFromElectron();
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, loadFromElectron, onClose]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div className={`settings-overlay-v3 ${open ? "open" : ""}`}>
      <div className="settings-panel-v3 flex flex-col" style={{ width: 760, height: 600 }}>
        {/* Header */}
        <div className="settings-header">
          <div className="settings-header-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`settings-header-tab ${activeTab === t.id ? "active" : ""}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
                {t.id === "about" && aboutDot && <span className="tab-update-dot" />}
              </button>
            ))}
          </div>
          <button className="settings-close" onClick={handleClose}>✕
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 flex-1 overflow-y-auto">
          {activeTab === "general" ? (
            <GeneralTab />
          ) : activeTab === "appearance" ? (
            <AppearanceTab />
          ) : activeTab === "plugins" ? (
            <PluginsTab />
          ) : activeTab === "agent" ? (
            <AgentTab />
          ) : activeTab === "providers" ? (
            <ProvidersTab />
          ) : activeTab === "about" ? (
            <AboutTab />
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-2 border-t border-border bg-surface-alt">
          <button
            className="px-5 py-1.5 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors text-sm"
            onClick={handleClose}
          >
            取消
          </button>
          <button
            className="px-5 py-1.5 rounded-lg btn-accent text-sm font-medium"
            onClick={handleClose}
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
