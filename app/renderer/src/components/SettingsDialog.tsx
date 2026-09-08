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
  /** 窗口内当前打开的项目路径（由 ProjectPage 传入，MCP 插件页用它查询项目级配置与状态） */
  projectPath?: string;
}

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "通用" },
  { id: "appearance", label: "界面" },
  { id: "providers", label: "模型" },
  { id: "plugins", label: "插件" },
  { id: "agent", label: "Agent" },
  { id: "about", label: "关于" },
];

export function SettingsDialog({ open, onClose, initialTab, projectPath }: SettingsDialogProps): JSX.Element | null {
  const { loadFromElectron } = useSettingsStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab || "general");
  // 供应商编辑/新增中:隐藏底部 Footer(「完成」会关闭弹窗丢掉未保存的编辑)
  const [providerEditing, setProviderEditing] = useState(false);
  // 可更新版本(订阅广播):「关于」标题红点,进入关于页即已读
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);

  // 外部指定 initialTab 时同步（如点「有新版本」→ 跳到关于页）
  useEffect(() => { if (initialTab) setActiveTab(initialTab); }, [initialTab]);

  // 切 tab 时重置供应商编辑态(编辑中切走,ProvidersTab 卸载,Footer 恢复显示)
  useEffect(() => { setProviderEditing(false); }, [activeTab]);

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

        {/* Body:供应商编辑中底部不设 padding——滚动容器底缘 = Footer 上缘,
            表单的 sticky 保存条(贴 bottom-0)即可无缝靠住 Footer,不悬空 */}
        <div className={`px-6 pt-4 flex-1 overflow-y-auto ${providerEditing ? "pb-0" : "pb-4"}`}>
          {activeTab === "general" ? (
            <GeneralTab />
          ) : activeTab === "appearance" ? (
            <AppearanceTab />
          ) : activeTab === "plugins" ? (
            <PluginsTab projectPath={projectPath} />
          ) : activeTab === "agent" ? (
            <AgentTab />
          ) : activeTab === "providers" ? (
            <ProvidersTab onProviderEditingChange={setProviderEditing} />
          ) : activeTab === "about" ? (
            <AboutTab />
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-2 bg-surface-alt">
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
