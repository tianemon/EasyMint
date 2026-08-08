import { useEffect, useRef, useState } from "react";
import { useDeviceStore, type PairedDevice, type DiscoveredDevice } from "../../stores/device-store";
import { TransferModal } from "./TransferModal";

/**
 * 设备互联悬浮浮层(内嵌 absolute 覆盖主界面):
 * - 可被发现开关(配对模式,5 分钟自动退出)
 * - 已配对设备列表(在线绿点/离线灰点 + 最后连接时间)
 * - 可用设备列表(发现 + 配对)
 * 交互对齐蓝牙:配对期高频,配对后零广播,离线低频探测(主进程负责)。
 */

interface DevicePanelProps {
  open: boolean;
  onClose: () => void;
}

function formatLastSeen(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${Math.floor(diff / 86400_000)} 天前`;
}

function PairedRow({ device, onUnpair, onSend }: { device: PairedDevice; onUnpair: (id: string) => void; onSend: (id: string) => void }): JSX.Element {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border bg-surface">
      <span className={`w-2 h-2 rounded-full shrink-0 ${device.online ? "bg-success" : "bg-text-muted/40"}`} />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-text-primary truncate">{device.name}</div>
        <div className="text-[10px] text-text-muted">
          {device.online ? "在线 · 已连接" : `离线 · ${formatLastSeen(device.lastSeen)}`}
        </div>
      </div>
      {device.online && (
        <button
          type="button"
          className="text-[10px] px-2 py-1 rounded bg-accent-soft text-accent hover:bg-accent hover:text-text-inverse transition-colors shrink-0"
          onClick={() => onSend(device.id)}
          title="向该设备发送迁移"
        >
          发送
        </button>
      )}
      <button
        type="button"
        className="text-[10px] px-2 py-1 rounded border border-border text-text-secondary hover:text-danger hover:border-danger/40 transition-colors shrink-0"
        onClick={() => onUnpair(device.id)}
      >
        解除配对
      </button>
    </div>
  );
}

function DiscoveredRow({ device, onPair }: { device: DiscoveredDevice; onPair: (d: DiscoveredDevice) => void }): JSX.Element {
  const [sending, setSending] = useState(false);
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border bg-surface">
      <span className="w-7 h-7 rounded-md bg-accent-soft text-accent flex items-center justify-center shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-text-primary truncate">{device.name}</div>
        <div className="text-[10px] text-text-muted">通过局域网发现 · {device.address}:{device.port}</div>
      </div>
      <button
        type="button"
        className="text-xs px-3 py-1 rounded-md bg-accent text-text-inverse hover:bg-accent-hover transition-colors shrink-0 disabled:opacity-50"
        disabled={sending}
        onClick={async () => { setSending(true); await onPair(device); setSending(false); }}
      >
        {sending ? "请求中" : "配对"}
      </button>
    </div>
  );
}

export function DevicePanel({ open, onClose }: DevicePanelProps): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  const {
    self, paired, discovered, pairMode,
    load, startPair, stopPair, manualScan, requestPair, unpair,
  } = useDeviceStore();
  const [pairError, setPairError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  // 迁移对话框(目标设备)
  const [transferTarget, setTransferTarget] = useState<{ id: string; name: string } | null>(null);
  // 手动扫描中(3s 收集窗口,与主进程一致)
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (open) { load(); setPairError(null); }
  }, [open, load]);

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
    if (!r.ok) setPairError(r.error ?? "配对失败");
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-end bg-black/20" onMouseDown={onClose}>
      <div
        ref={ref}
        className="w-[340px] h-full bg-surface-alt border-l border-border shadow-xl flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-medium text-text-primary">设备互联</span>
          <button type="button" className="text-text-secondary hover:text-text-primary transition-colors text-sm px-1" onClick={onClose}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* 本机信息 + 可被发现开关 */}
          <div className="bg-surface rounded-lg border border-border px-3.5 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-medium text-text-primary truncate">{self.name}</div>
                <div className="text-[10px] text-text-muted mt-0.5">本机 · {self.id.slice(0, 8)}</div>
              </div>
              <button
                type="button"
                onClick={() => { editingName ? (self.name !== nameDraft.trim() && useDeviceStore.getState().setName(nameDraft.trim()), setEditingName(false)) : (setNameDraft(self.name), setEditingName(true)); }}
                className="text-[10px] text-text-secondary hover:text-text-primary shrink-0"
              >
                {editingName ? "保存" : "改名"}
              </button>
            </div>
            {editingName && (
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { self.name !== nameDraft.trim() && useDeviceStore.getState().setName(nameDraft.trim()); setEditingName(false); } }}
                className="mt-2 w-full px-2 py-1.5 rounded bg-surface-alt border border-border text-xs text-text-primary outline-none focus:border-accent"
              />
            )}
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-text-secondary">可被发现</span>
              <button
                type="button"
                onClick={() => (pairMode ? stopPair() : startPair())}
                className={`w-9 h-5 rounded-full transition-colors relative ${pairMode ? "bg-accent" : "bg-border"}`}
                title={pairMode ? "关闭可被发现" : "开启可被发现(1 分钟后自动关闭)"}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${pairMode ? "left-4" : "left-0.5"}`} />
              </button>
            </div>
            {pairMode && pairCountdown !== null && (
              <div className="mt-2 text-[10px] text-text-secondary">广播中 · {pairCountdown}s 后自动停止</div>
            )}
          </div>

          {/* 已配对设备 */}
          <div>
            <div className="text-xs font-medium text-text-secondary mb-1.5 px-1">已配对设备</div>
            {paired.length === 0 ? (
              <div className="text-[11px] text-text-muted px-1">尚未配对任何设备。开启可被发现，或等待其他设备开启后在此配对。</div>
            ) : (
              <div className="space-y-1.5">
                {paired.map((d) => (
                  <PairedRow
                    key={d.id}
                    device={d}
                    onUnpair={unpair}
                    onSend={(id) => { const dev = paired.find((p) => p.id === id); if (dev) setTransferTarget({ id: dev.id, name: dev.name }); }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 可用设备(仅手动扫描,3s 收集窗口) */}
          <div>
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
                可用设备
                {/* 手动扫描中指示 */}
                {scanning && (
                  <svg className="w-3 h-3 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                    <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                )}
              </span>
              <button
                type="button"
                className="text-[10px] text-text-secondary hover:text-accent transition-colors disabled:opacity-50"
                disabled={scanning}
                onClick={() => {
                  setScanning(true);
                  void manualScan().finally(() => setTimeout(() => setScanning(false), 3000));
                }}
              >
                {scanning ? "扫描中…" : "扫描"}
              </button>
            </div>
            {discovered.length === 0 ? (
              <div className="text-[11px] text-text-muted px-1">
                {scanning ? "正在发现附近的设备…" : "点击「扫描」发现附近的设备（对方需开启「可被发现」）。"}
              </div>
            ) : (
              <div className="space-y-1.5">
                {discovered.map((d) => <DiscoveredRow key={d.id} device={d} onPair={handlePair} />)}
              </div>
            )}
          </div>

          {pairError && (
            <div className="text-[11px] text-danger px-1">{pairError}</div>
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
