import { appText } from "../../lib/i18n";
import { formatRelativeTimestamp } from "../../lib/locale-format";
import { uiText, useUiLocale } from "../../lib/i18n";
import { useEffect, useRef, useState } from "react";
import { useDeviceStore, type PairedDevice, type DiscoveredDevice } from "../../stores/device-store";
import { TransferModal } from "./TransferModal";

/**
 * 项目迁移悬浮浮层(内嵌 absolute 覆盖主界面):电脑↔电脑迁移项目。
 * - 可被发现开关(配对模式,5 分钟自动退出)
 * - 已配对设备列表(在线绿点/离线灰点 + 最后连接时间)
 * - 可用设备列表(发现 + 配对)
 * 交互对齐蓝牙:配对期高频,配对后零广播,离线低频探测(主进程负责)。
 * 手机连接是另一条链路,已独立为「连接手机」浮层(MobileTerminalPanel)。
 */

interface DevicePanelProps {
  open: boolean;
  onClose: () => void;
}

const formatLastSeen = formatRelativeTimestamp;

function PairedRow({ device, onUnpair, onSend, onConnect }: { device: PairedDevice; onUnpair: (id: string) => void; onSend: (id: string) => void; onConnect: (id: string) => void }): JSX.Element {
  useUiLocale();
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-[var(--radius-lg)] border border-border bg-surface">
      <span className={`w-2 h-2 rounded-full shrink-0 ${device.online ? "bg-success" : "bg-text-muted/40"}`} />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-text-primary truncate">{device.name}</div>
        <div className="text-[length:var(--text-2xs)] text-text-muted">
          {device.online ? uiText("ui.DevicePanel.onlineConnected") : uiText("ui.DevicePanel.offline", { v0: formatLastSeen(device.lastSeen) })}
        </div>
      </div>
      {!device.online && (
        <button
          type="button"
          className="text-[length:var(--text-2xs)] px-2 py-1 rounded-[var(--radius-lg)] bg-accent-soft text-accent hover:bg-accent hover:text-text-inverse transition-colors shrink-0"
          onClick={() => onConnect(device.id)}
         
        >
          {uiText("ui.DevicePanel.connect")}</button>
      )}
      {device.online && (
        <button
          type="button"
          className="text-[length:var(--text-2xs)] px-2 py-1 rounded-[var(--radius-lg)] bg-accent-soft text-accent hover:bg-accent hover:text-text-inverse transition-colors shrink-0"
          onClick={() => onSend(device.id)}
         
        >
          {uiText("ui.DevicePanel.transfer")}</button>
      )}
      <button
        type="button"
        className="text-[length:var(--text-2xs)] px-2 py-1 rounded-[var(--radius-lg)] border border-border text-text-secondary hover:text-danger hover:border-danger-border transition-colors shrink-0"
        onClick={() => onUnpair(device.id)}
      >
        {uiText("ui.DevicePanel.unpair")}</button>
    </div>
  );
}

function DiscoveredRow({ device, onPair }: { device: DiscoveredDevice; onPair: (d: DiscoveredDevice) => void }): JSX.Element {
  useUiLocale();
  const [sending, setSending] = useState(false);
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-[var(--radius-lg)] border border-border bg-surface">
      <span className="w-7 h-7 rounded-[var(--radius-lg)] bg-accent-soft text-accent flex items-center justify-center shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-text-primary truncate">{device.name}</div>
        <div className="text-[length:var(--text-2xs)] text-text-muted">{uiText("ui.DevicePanel.discoveredOnLocalNetwork")}{device.address}:{device.port}</div>
      </div>
      <button
        type="button"
        className="text-xs px-3 py-1 rounded-[var(--radius-lg)] btn-accent shrink-0"
        disabled={sending}
        onClick={async () => { setSending(true); await onPair(device); setSending(false); }}
      >
        {sending ? uiText("ui.DevicePanel.requesting") : uiText("ui.DevicePanel.pair")}
      </button>
    </div>
  );
}

export function DevicePanel({ open, onClose }: DevicePanelProps): JSX.Element | null {
  useUiLocale();
  const ref = useRef<HTMLDivElement>(null);
  const {
    self, paired, discovered, pairMode,
    load, startPair, stopPair, manualScan, requestPair, unpair, connect,
  } = useDeviceStore();
  const [pairError, setPairError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  // 迁移对话框(目标设备)
  const [transferTarget, setTransferTarget] = useState<{ id: string; name: string } | null>(null);
  // 手动扫描中(3s 收集窗口,与主进程一致)
  const [scanning, setScanning] = useState(false);
  // 迁移忽略项(全局配置,类似 .gitignore——原始文本编辑,换行即一项,含注释)
  const [ignoreText, setIgnoreText] = useState("");
  const [ignoreSaved, setIgnoreSaved] = useState(false);
  const [ignoreDirty, setIgnoreDirty] = useState(false);

  useEffect(() => {
    if (open) { load(); setPairError(null); }
  }, [open, load]);

  // 迁移忽略项:打开面板时加载(全局配置,不依赖项目)
  useEffect(() => {
    if (!open) return;
    window.electronAPI.migration.getIgnore().then((content) => {
      setIgnoreText(content);
      setIgnoreSaved(false);
      setIgnoreDirty(false);
    }).catch(() => {});
  }, [open]);

  // 点击遮罩/Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 可被发现 1 分钟倒计时(主进程到时自动停广播,前端只展示)
  const [pairCountdown, setPairCountdown] = useState<number | null>(null);
  useEffect(() => {
    if (!pairMode) { setPairCountdown(null); return; }
    const end = Date.now() + 60_000;
    const t = setInterval(() => {
      const left = Math.max(0, end - Date.now());
      setPairCountdown(Math.ceil(left / 1000));
      if (left <= 0) setPairCountdown(null);
    }, 1000);
    return () => clearInterval(t);
  }, [pairMode]);

  if (!open) return null;

  const handlePair = async (d: DiscoveredDevice) => {
    setPairError(null);
    const r = await requestPair(d);
    if (!r.ok) setPairError(r.error ?? uiText("ui.DevicePanel.pairingFailed"));
  };

  const saveIgnore = async (): Promise<void> => {
    await window.electronAPI.migration.saveIgnore(ignoreText);
    setIgnoreSaved(true);
    setIgnoreDirty(false);
  };

  const resetIgnore = async (): Promise<void> => {
    // 恢复默认模板:保存空内容会触发主进程重建默认文件——直接保存默认模板更稳,
    // 由主进程 migration:resetIgnore 返回默认内容
    const content = await window.electronAPI.migration.resetIgnore();
    setIgnoreText(content);
    setIgnoreSaved(true);
    setIgnoreDirty(false);
  };

  return (
    // 层级用 z-dialog(与历史输入抽屉同级):z-float 时聊天页的历史输入按钮会盖在抽屉上方
    <div className="no-drag fixed inset-0 z-dialog flex items-start justify-end bg-black/40" onMouseDown={onClose}>
      <div
        ref={ref}
        className="em-glass w-[340px] h-full flex flex-col rounded-l-[var(--radius-lg)] shadow-2xl animate-[drawer-in_200ms_ease-out] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <span className="text-sm font-medium text-text-primary">{uiText("ui.DevicePanel.projectTransfer")}</span>
          <button type="button" className="text-text-secondary hover:text-text-primary transition-colors text-sm px-1" onClick={onClose}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pt-1 pb-6 space-y-4 flex flex-col">
          {/* 本机信息 + 可被发现开关 */}
          <div className="bg-surface rounded-[var(--radius-lg)] border border-border px-3.5 py-3 shrink-0">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-medium text-text-primary truncate">{self.name}</div>
                <div className="text-[length:var(--text-2xs)] text-text-muted mt-0.5">{uiText("ui.DevicePanel.thisComputer")}{self.id.slice(0, 8)}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (editingName) {
                    if (self.name !== nameDraft.trim()) useDeviceStore.getState().setName(nameDraft.trim());
                    setEditingName(false);
                  } else {
                    setNameDraft(self.name);
                    setEditingName(true);
                  }
                }}
                className="text-[length:var(--text-2xs)] text-text-secondary hover:text-text-primary shrink-0"
              >
                {editingName ? uiText("ui.AgentTemplateSettings.save") : uiText("ui.SessionHistory.rename")}
              </button>
            </div>
            {editingName && (
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { self.name !== nameDraft.trim() && useDeviceStore.getState().setName(nameDraft.trim()); setEditingName(false); } }}
                className="em-input mt-2 w-full px-2 py-1.5 text-xs text-text-primary"
              />
            )}
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-text-secondary">{uiText("ui.DevicePanel.discoverable")}</span>
              <button
                type="button"
                onClick={() => (pairMode ? stopPair() : startPair())}
                className={`w-9 h-5 rounded-full transition-colors relative ${pairMode ? "bg-accent" : "bg-border"}`}
                
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${pairMode ? "left-4" : "left-0.5"}`} />
              </button>
            </div>
            {pairMode && pairCountdown !== null && (
              <div className="mt-2 text-[length:var(--text-2xs)] text-text-secondary">{uiText("ui.DevicePanel.broadcasting")}{pairCountdown}{uiText("ui.DevicePanel.sUntilAutomaticStop")}</div>
            )}
          </div>

          {/* 已配对设备 */}
          <div className="shrink-0">
            <div className="text-xs font-medium text-text-secondary mb-1.5 px-1">{uiText("ui.DevicePanel.pairedDevices")}</div>
            {paired.length === 0 ? (
              <div className="text-[length:var(--text-11)] text-text-muted px-1">{uiText("ui.DevicePanel.noPairedDevicesEnableDiscoverabilityHereOr")}</div>
            ) : (
              <div className="space-y-1.5">
                {paired.map((d) => (
                  <PairedRow
                    key={d.id}
                    device={d}
                    onUnpair={unpair}
                    onConnect={(id) => {
                      void connect(id).then((r) => { if (!r.ok) setPairError(r.error ?? uiText("ui.DevicePanel.connectionFailed")); });
                    }}
                    onSend={(id) => { const dev = paired.find((p) => p.id === id); if (dev) setTransferTarget({ id: dev.id, name: dev.name }); }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 可用设备(仅手动扫描,3s 收集窗口) */}
          <div className="shrink-0">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
                {uiText("ui.DevicePanel.availableDevices")}{/* 手动扫描中指示 */}
                {scanning && (
                  <svg className="w-3 h-3 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                    <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                )}
              </span>
              <button
                type="button"
                className="text-[length:var(--text-2xs)] text-text-secondary hover:text-accent transition-colors disabled:opacity-50"
                disabled={scanning}
                onClick={() => {
                  setScanning(true);
                  void manualScan().finally(() => setTimeout(() => setScanning(false), 3000));
                }}
              >
                {scanning ? uiText("ui.DevicePanel.scanning") : uiText("ui.DevicePanel.scan")}
              </button>
            </div>
            {discovered.length === 0 ? (
              <div className="text-[length:var(--text-11)] text-text-muted px-1">
                {scanning ? uiText("ui.DevicePanel.discoveringNearbyDevices") : uiText("ui.DevicePanel.selectScanToDiscoverNearbyDevicesThe")}
              </div>
            ) : (
              <div className="space-y-1.5">
                {discovered.map((d) => <DiscoveredRow key={d.id} device={d} onPair={handlePair} />)}
              </div>
            )}
          </div>

          {/* 迁移忽略项:全局配置(类似 .gitignore,文本编辑,换行即一项) */}
          <div className="flex flex-col flex-1 min-h-[9rem]">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-xs font-medium text-text-secondary">{uiText("ui.DevicePanel.transferIgnoreRules")}</span>
            </div>
            <div className="bg-surface rounded-[var(--radius-lg)] border border-border py-2 space-y-2 flex flex-col flex-1 overflow-hidden">
              {/* 输入框无边框、宽度与卡片同宽(去掉卡片横向内边距)——视觉上与卡片融为一体 */}
              <textarea
                value={ignoreText}
                onChange={(e) => { setIgnoreText(e.target.value); setIgnoreDirty(true); setIgnoreSaved(false); }}
                spellCheck={false}
                placeholder={uiText("ui.DevicePanel.oneFileOrFolderPathPerLine")}
                className="flex-1 resize-none w-full px-3 py-2 bg-transparent border-none outline-none text-[length:var(--text-2xs)] font-mono leading-relaxed text-text-primary"
              />
              <div className="flex items-center justify-between px-3">
                <span className="text-[length:var(--text-2xs)] text-text-muted">
                  {ignoreSaved ? uiText("ui.DevicePanel.savedAppliesToTheNextScan") : ignoreDirty ? uiText("ui.DevicePanel.unsavedChanges") : ""}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="text-[length:var(--text-2xs)] text-text-secondary hover:text-accent transition-colors"
                    onClick={() => void resetIgnore()}
                  >
                    {uiText("ui.DevicePanel.restoreDefaults")}</button>
                  <button
                    type="button"
                    className="text-[length:var(--text-2xs)] px-2.5 py-1 rounded-[var(--radius-lg)] btn-accent"
                    disabled={!ignoreDirty}
                    onClick={() => void saveIgnore()}
                  >
                    {uiText("ui.AgentTemplateSettings.save")}</button>
                </div>
              </div>
            </div>
          </div>

          {pairError && (
            <div className="text-[length:var(--text-11)] text-danger px-1">{appText(pairError)}</div>
          )}
        </div>
      </div>
      {/* 迁移对话框(发送端手动入口) */}
      <TransferModal
        open={transferTarget !== null}
        deviceId={transferTarget?.id ?? ""}
        deviceName={transferTarget?.name ?? ""}
        onClose={() => setTransferTarget(null)}
        onSent={() => { /* 发送完成,留在设备面板 */ }}
      />
    </div>
  );
}
