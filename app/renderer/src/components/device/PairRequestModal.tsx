import { useState } from "react";
import { useDeviceStore } from "../../stores/device-store";

/**
 * 配对请求弹窗(接收端):对方设备发起配对 → 弹窗确认(蓝牙式双向确认)。
 * 接受 → 交换密钥并建立连接;拒绝 → 忽略。
 */

export function PairRequestModal(): JSX.Element | null {
  const pairRequest = useDeviceStore((s) => s.pairRequest);
  const acceptPair = useDeviceStore((s) => s.acceptPair);
  const rejectPair = useDeviceStore((s) => s.rejectPair);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!pairRequest) return null;

  const handleAccept = async () => {
    setBusy(true);
    setError(null);
    const r = await acceptPair(pairRequest);
    setBusy(false);
    if (!r.ok) setError(r.error ?? "配对失败");
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] modal-overlay">
      <div className="bg-surface-alt rounded-xl border border-border shadow-2xl modal-card" style={{ width: 380 }}>
        <div className="px-6 pt-5 pb-2">
          <h2 className="text-base font-semibold text-text-primary">连接请求</h2>
        </div>
        <div className="px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-lg bg-accent-soft text-accent flex items-center justify-center shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            </span>
            <div>
              <div className="text-sm font-medium text-text-primary">{pairRequest.name}</div>
              <div className="text-xs text-text-secondary mt-0.5">请求与这台设备配对连接</div>
              <div className="text-[length:var(--text-2xs)] text-text-muted mt-0.5">{pairRequest.address}:{pairRequest.port}</div>
            </div>
          </div>
          {error && <div className="text-[length:var(--text-11)] text-danger mt-3">{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
          <button
            className="px-4 py-1.5 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors text-sm"
            onClick={rejectPair}
            disabled={busy}
          >
            拒绝
          </button>
          <button
            className="px-5 py-1.5 rounded-lg bg-accent text-text-inverse hover:bg-accent-hover transition-colors text-sm font-medium disabled:opacity-50"
            onClick={handleAccept}
            disabled={busy}
          >
            {busy ? "配对中…" : "接受"}
          </button>
        </div>
      </div>
    </div>
  );
}
