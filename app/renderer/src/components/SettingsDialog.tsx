import { DialogCloseButton } from "./ui/DialogCloseButton";
import { MemoryTab } from "./settings/MemoryTab";
import { useTranslation } from "react-i18next";
import "../lib/i18n";
import { useEffect, useState, useCallback } from "react";
import { useSettingsStore } from "../stores/settings-store";
import { readVersion, markRead } from "../lib/update-notice";
import { GeneralTab } from "./settings/GeneralTab";
import { AppearanceTab } from "./settings/AppearanceTab";
import { PluginsTab } from "./settings/PluginsTab";
import { AgentTab } from "./settings/AgentTab";
import { ProvidersTab } from "./settings/ProvidersTab";
import { AboutTab } from "./settings/AboutTab";

export type SettingsTab = "general" | "appearance" | "plugins" | "providers" | "agent" | "memory" | "about";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
  environmentTarget?: string;
  /** 窗口内当前打开的项目路径（由 ProjectPage 传入，MCP 插件页用它查询项目级配置与状态） */
  projectPath?: string;
}

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "settings.general" },
  { id: "appearance", label: "settings.appearance" },
  { id: "providers", label: "settings.providers" },
  { id: "plugins", label: "settings.plugins" },
  { id: "agent", label: "settings.agent" },
  { id: "memory", label: "memory.title" },
  { id: "about", label: "settings.about" },
];

export function SettingsDialog({ open, onClose, initialTab, projectPath, environmentTarget }: SettingsDialogProps): JSX.Element | null {
  const { t } = useTranslation();
  const { loadFromElectron } = useSettingsStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab || "general");
  const [roleSaving,setRoleSaving]=useState(false);
  const [roleRestore, setRoleRestore] = useState<HTMLDivElement | null>(null);
  const [roleSave, setRoleSave] = useState<HTMLDivElement | null>(null);
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
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape" && !roleSaving) onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, loadFromElectron, onClose,roleSaving]);

  const handleClose = useCallback(() => {
    if(!roleSaving)onClose();
  }, [onClose,roleSaving]);

  if (!open) return null;

  return (
    <div className={`settings-overlay-v3 ${open ? "open" : ""}`}>
      <div className="settings-panel-v3 flex flex-col" style={{ width: 760, height: 600 }}>
        {/* Header */}
        <div className="settings-header">
          <div className="settings-header-tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`settings-header-tab ${activeTab === tab.id ? "active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
                disabled={roleSaving}
              >
                {t(tab.label)}
                {tab.id === "about" && aboutDot && <span className="tab-update-dot" />}
              </button>
            ))}
          </div>
          <DialogCloseButton disabled={roleSaving} onClick={handleClose} />
        </div>

        {/* Body(作用域类:无边框拼色设计语言只作用于此,见 index.css .settings-body) */}
        <div className="settings-body px-6 py-5 flex-1 overflow-y-auto">
          {activeTab === "general" ? (
            <GeneralTab environmentTarget={environmentTarget} />
          ) : activeTab === "appearance" ? (
            <AppearanceTab />
          ) : activeTab === "plugins" ? (
            <PluginsTab projectPath={projectPath} />
          ) : activeTab === "agent" ? (
            <AgentTab onSavingChange={setRoleSaving} roleFooter={{ restore: roleRestore, save: roleSave }} />
          ) : activeTab === "memory" ? (
            <MemoryTab />
          ) : activeTab === "providers" ? (
            <ProvidersTab />
          ) : activeTab === "about" ? (
            <AboutTab />
          ) : null}
        </div>

        {/* Footer：与顶部一致——不设色块分区（不加 bg-surface-alt），整窗一个面色；
            操作区与内容区的分隔靠内边距，底部在滚动区之外不会与内容重叠 */}
        <div className="settings-footer flex shrink-0 items-center justify-end gap-2 px-6 py-2">
          <div ref={setRoleRestore} className="contents" />
          <button
            className="settings-footer-close px-5 py-1.5 rounded-[var(--radius-lg)] btn-accent text-sm font-medium"
            onClick={handleClose}
            disabled={roleSaving}
          >
            {t("common.close")}
          </button>
          <div ref={setRoleSave} className="agent-role-actions contents" />
        </div>
      </div>
    </div>
  );
}
