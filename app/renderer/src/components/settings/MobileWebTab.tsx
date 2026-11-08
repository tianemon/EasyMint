import { appText, uiText, useUiLocale } from "../../lib/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

type Status = Awaited<ReturnType<typeof window.electronAPI.mobileWeb.getStatus>>;
type Device = Awaited<ReturnType<typeof window.electronAPI.mobileTerminal.listDevices>>[number];
type Pending = Awaited<ReturnType<typeof window.electronAPI.mobileTerminal.listPending>>[number];

interface QrPair {
  appQr: string;
  webQr: string;
  expiresAt: number;
  /** 生成这两个二维码时所用的 HTTP 端口：端口变更后旧码失效。 */
  port: number;
}

/** 与 PluginsTab 一致的开关形态，本 tab 内自用，不改动既有组件。 */
function Toggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-8 h-4 rounded-full transition-colors overflow-hidden shrink-0 ml-2 ${checked ? "bg-accent" : "bg-surface-hover"}`}
      role="switch"
      aria-checked={checked}
    >
      <span
        className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-surface-elevated shadow transition-all ${checked ? "left-[calc(100%-14px)]" : "left-0.5"}`}
      />
    </button>
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

export function MobileWebTab(): JSX.Element {
  useUiLocale();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [portInput, setPortInput] = useState("");
  const [portError, setPortError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pairs, setPairs] = useState<QrPair | null>(null);
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState<Pending[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [portChanged, setPortChanged] = useState(false);
  const creatingRef = useRef(false);
  const prevPortRef = useRef<number | null>(null);

  const applyStatus = useCallback((s: Status) => {
    setStatus(s);
    setPortInput(String(s.port));
    if (prevPortRef.current !== null && prevPortRef.current !== s.port) setPortChanged(true);
    prevPortRef.current = s.port;
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      const [nextDevices, nextPending] = await Promise.all([
        window.electronAPI.mobileTerminal.listDevices(),
        window.electronAPI.mobileTerminal.listPending(),
      ]);
      setDevices(nextDevices);
      setPending(nextPending);
    } catch { /* 保留上一次结果 */ }
  }, []);

  // 两个二维码各用一份独立 offer：remote-terminal-service 的 token 是一次性的（mobile-pair-init 即删），
  // 原生 App 与浏览器必须分别调用 createPairingOffer()，否则第二个设备扫到的是已消费的 offer。
  const refreshOffers = useCallback(async (s: Status) => {
    if (creatingRef.current) return;
    if (!s.enabled || !s.running || s.lanAddresses.length === 0) { setPairs(null); return; }
    creatingRef.current = true;
    setCreating(true);
    setError("");
    try {
      const appOffer = await window.electronAPI.mobileTerminal.createOffer();
      const webOffer = await window.electronAPI.mobileTerminal.createOffer();
      const appQr = await QRCode.toDataURL(appOffer.uri, { width: 176, margin: 1, errorCorrectionLevel: "M" });
      const payload = webOffer.uri.includes("?payload=") ? webOffer.uri.split("?payload=")[1] : "";
      const host = s.lanAddresses[0];
      const webUrl = `http://${host}:${s.port}/#pair=${payload}`;
      const webQr = await QRCode.toDataURL(webUrl, { width: 176, margin: 1, errorCorrectionLevel: "M" });
      setPairs({
        appQr,
        webQr,
        expiresAt: Math.min(appOffer.expiresAt, webOffer.expiresAt),
        port: s.port,
      });
      setNow(Date.now());
    } catch (e) {
      setError(message(e));
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const s = await window.electronAPI.mobileWeb.getStatus();
      applyStatus(s);
      await refreshOffers(s);
    } catch (e) {
      setError(message(e));
    }
  }, [applyStatus, refreshOffers]);

  useEffect(() => {
    void loadStatus();
    void loadDevices();
    const offStatus = window.electronAPI.mobileWeb.onStatusChanged((s) => {
      applyStatus(s);
      if (s.enabled) void refreshOffers(s);
      else setPairs(null);
    });
    const offChanged = window.electronAPI.mobileTerminal.onChanged(() => void loadDevices());
    const offPair = window.electronAPI.mobileTerminal.onPairRequest(() => void loadDevices());
    const offError = window.electronAPI.mobileTerminal.onError(({ message: msg }) => setError(msg));
    return () => { offStatus(); offChanged(); offPair(); offError(); };
  }, [loadStatus, loadDevices, applyStatus, refreshOffers]);

  useEffect(() => {
    if (!pairs) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [pairs]);

  const secondsLeft = useMemo(
    () => pairs ? Math.max(0, Math.ceil((pairs.expiresAt - now) / 1_000)) : 0,
    [pairs, now],
  );

  const toggleEnabled = async () => {
    if (!status) return;
    setError("");
    try {
      const next = await window.electronAPI.mobileWeb.setEnabled(!status.enabled);
      applyStatus(next);
      if (!next.enabled) setPairs(null);
    } catch (e) {
      setError(message(e));
      void loadStatus();
    }
  };

  const applyPort = async () => {
    const port = Number(portInput);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) { setPortError(true); return; }
    setPortError(false);
    setError("");
    try {
      // 端口变更的 status-changed 广播会刷新状态与二维码，并置「需重新扫码」提示。
      await window.electronAPI.mobileWeb.setPort(port);
    } catch (e) {
      setError(message(e));
      void loadStatus();
    }
  };

  const refreshNow = () => {
    if (!status) return;
    setPortChanged(false);
    void refreshOffers(status);
  };

  const finishPair = async (requestId: string, accept: boolean) => {
    const result = accept
      ? await window.electronAPI.mobileTerminal.acceptPair(requestId)
      : await window.electronAPI.mobileTerminal.rejectPair(requestId);
    if (!result.ok) setError(uiText("ui.MobileWebTab.expired"));
    await loadDevices();
  };

  const revokeAllWeb = async () => {
    const webDevices = devices.filter((d) => d.id.startsWith("web-"));
    if (webDevices.length === 0) return;
    if (!window.confirm(uiText("ui.MobileWebTab.revokeConfirm", { v0: webDevices.length }))) return;
    try {
      for (const d of webDevices) await window.electronAPI.mobileTerminal.revoke(d.id);
      await loadDevices();
    } catch (e) {
      setError(message(e));
    }
  };

  const qrStale = portChanged || (pairs !== null && status !== null && pairs.port !== status.port);
  const qrMessage = !status ? uiText("ui.MobileWebTab.loading")
    : !status.enabled ? uiText("ui.MobileWebTab.needEnable")
    : !status.running ? uiText("ui.MobileWebTab.notRunning")
    : status.lanAddresses.length === 0 ? uiText("ui.MobileWebTab.noLan")
    : "";

  return (
    <div className="space-y-4">
      {/* 标题 + 开关 */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-medium text-text-primary">{uiText("ui.MobileWebTab.title")}</h3>
          <p className="text-[length:var(--text-2xs)] text-text-muted mt-0.5">{uiText("ui.MobileWebTab.subtitle")}</p>
        </div>
        <div className="flex items-center shrink-0">
          <span className="text-xs text-text-secondary">{uiText("ui.MobileWebTab.enableLabel")}</span>
          <Toggle checked={status?.enabled ?? false} onChange={() => void toggleEnabled()} disabled={!status} />
        </div>
      </div>
      <p className="text-[length:var(--text-2xs)] text-text-muted -mt-2">{uiText("ui.MobileWebTab.enableHint")}</p>

      {!status ? (
        <div className="text-xs text-text-muted">{uiText("ui.MobileWebTab.loading")}</div>
      ) : (
        <>
          {/* 运行状态 / 端口 / LAN 地址 / 在线浏览器设备 */}
          <div className="rounded-[var(--radius-lg)] border border-border bg-surface-alt px-4 py-3 space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              <span className={`w-2 h-2 rounded-full ${status.running ? "bg-success" : "bg-text-muted/40"}`} />
              <span className="text-text-secondary">{uiText("ui.MobileWebTab.statusLabel")}</span>
              <span className="text-text-primary">{status.running ? uiText("ui.MobileWebTab.running") : uiText("ui.MobileWebTab.stopped")}</span>
              <span className="text-text-muted">·</span>
              <span className="text-text-muted">{uiText("ui.MobileWebTab.portLabel")} {status.port}</span>
            </div>
            <div className="text-[length:var(--text-2xs)] text-text-secondary">
              {uiText("ui.MobileWebTab.lanLabel")}: {status.lanAddresses.length > 0 ? status.lanAddresses.join(", ") : uiText("ui.MobileWebTab.noLan")}
            </div>
            <div className="text-[length:var(--text-2xs)] text-text-secondary">
              {uiText("ui.MobileWebTab.onlineWeb", { v0: status.onlineWebDevices })}
            </div>
          </div>

          {/* 端口输入 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary shrink-0">{uiText("ui.MobileWebTab.portLabel")}</span>
            <input
              className="em-input w-28 px-2 py-1 text-text-primary text-sm"
              inputMode="numeric"
              value={portInput}
              onChange={(e) => { setPortInput(e.target.value); setPortError(false); }}
            />
            <button type="button" className="px-3 py-1 text-xs btn-accent rounded-[var(--radius-lg)]" onClick={() => void applyPort()}>
              {uiText("ui.MobileWebTab.portApply")}
            </button>
            <span className="text-[length:var(--text-2xs)] text-text-muted flex-1">{uiText("ui.MobileWebTab.portHint")}</span>
          </div>
          {portError && <div className="text-[length:var(--text-11)] text-danger -mt-2">{uiText("ui.MobileWebTab.portInvalid")}</div>}

          {/* 端口变更提示 */}
          {qrStale && (
            <div className="rounded-[var(--radius-lg)] border border-accent/40 bg-accent-soft px-3 py-2 text-[length:var(--text-11)] text-text-secondary">
              {uiText("ui.MobileWebTab.portChangedHint")}
            </div>
          )}

          {/* 二维码区 */}
          {qrMessage === "" ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs text-text-secondary">
                  {pairs && secondsLeft > 0 ? uiText("ui.MobileWebTab.expiresIn", { v0: secondsLeft }) : ""}
                </span>
                <button
                  type="button"
                  className="text-[length:var(--text-2xs)] px-2.5 py-1 rounded-[var(--radius-lg)] btn-accent shrink-0"
                  disabled={creating}
                  onClick={refreshNow}
                >
                  {creating ? uiText("ui.MobileWebTab.refreshing") : uiText("ui.MobileWebTab.refresh")}
                </button>
              </div>
              {pairs && secondsLeft > 0 ? (
                <div className="flex gap-3">
                  <div className="flex-1 rounded-[var(--radius-lg)] border border-border bg-surface px-3 py-3 flex flex-col items-center">
                    <div className="text-xs font-medium text-text-primary mb-2">{uiText("ui.MobileWebTab.appQrTitle")}</div>
                    <img src={pairs.appQr} alt={uiText("ui.MobileWebTab.qrAltApp")} className="w-[176px] h-[176px] rounded-md" />
                    <div className="text-[length:var(--text-2xs)] text-text-muted mt-2 text-center">{uiText("ui.MobileWebTab.appQrHint")}</div>
                  </div>
                  <div className="flex-1 rounded-[var(--radius-lg)] border border-border bg-surface px-3 py-3 flex flex-col items-center">
                    <div className="text-xs font-medium text-text-primary mb-2">{uiText("ui.MobileWebTab.webQrTitle")}</div>
                    <img src={pairs.webQr} alt={uiText("ui.MobileWebTab.qrAltWeb")} className="w-[176px] h-[176px] rounded-md" />
                    <div className="text-[length:var(--text-2xs)] text-text-muted mt-2 text-center">{uiText("ui.MobileWebTab.webQrHint")}</div>
                  </div>
                </div>
              ) : creating && !pairs ? (
                <div className="rounded-[var(--radius-lg)] border border-border bg-surface px-3 py-3 text-[length:var(--text-11)] text-text-muted">
                  {uiText("ui.MobileWebTab.refreshing")}
                </div>
              ) : (
                <div className="rounded-[var(--radius-lg)] border border-border bg-surface px-3 py-3 text-[length:var(--text-11)] text-text-muted">
                  {uiText("ui.MobileWebTab.expired")}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-[var(--radius-lg)] border border-border bg-surface px-3 py-3 text-[length:var(--text-11)] text-text-muted">
              {qrMessage}
            </div>
          )}

          {/* 6 位码确认卡片 */}
          {pending.length > 0 && (
            <div className="text-xs font-medium text-text-secondary px-1">{uiText("ui.MobileWebTab.pendingTitle")}</div>
          )}
          {pending.map((request) => (
            <div key={request.requestId} className="rounded-[var(--radius-lg)] border border-accent/40 bg-accent-soft px-3 py-3">
              <div className="text-xs font-medium text-text-primary">
                {request.deviceName} {uiText("ui.MobileWebTab.wantsToConnect")}
              </div>
              <div className="text-[length:var(--text-2xs)] text-text-secondary mt-1">{uiText("ui.MobileWebTab.pendingHint")}</div>
              <div className="font-mono text-xl tracking-[0.25em] text-accent text-center my-2">{request.verificationCode}</div>
              <div className="flex justify-end gap-2">
                <button type="button" className="px-3 py-1 text-xs text-text-secondary" onClick={() => void finishPair(request.requestId, false)}>
                  {uiText("ui.MobileWebTab.reject")}
                </button>
                <button type="button" className="px-3 py-1 text-xs btn-accent rounded-[var(--radius-lg)]" onClick={() => void finishPair(request.requestId, true)}>
                  {uiText("ui.MobileWebTab.confirm")}
                </button>
              </div>
            </div>
          ))}

          {/* 设备列表 + 一键撤销浏览器设备 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-medium text-text-secondary">{uiText("ui.MobileWebTab.devicesTitle")}</span>
              {devices.some((d) => d.id.startsWith("web-")) && (
                <button type="button" className="text-[length:var(--text-2xs)] text-text-secondary hover:text-danger" onClick={() => void revokeAllWeb()}>
                  {uiText("ui.MobileWebTab.revokeAll")}
                </button>
              )}
            </div>
            {devices.length === 0 && (
              <div className="text-[length:var(--text-2xs)] text-text-muted px-1">{uiText("ui.MobileWebTab.noDevices")}</div>
            )}
            {devices.map((device) => (
              <div key={device.id} className="flex items-center gap-2.5 rounded-[var(--radius-lg)] border border-border bg-surface px-3 py-2">
                <span className={`w-2 h-2 rounded-full ${device.online ? "bg-success" : "bg-text-muted/40"}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-text-primary truncate">
                    {device.name}
                    <span className="text-[length:var(--text-2xs)] text-text-muted ml-2">
                      {device.id.startsWith("web-") ? uiText("ui.MobileWebTab.deviceBrowser") : uiText("ui.MobileWebTab.deviceApp")}
                    </span>
                  </div>
                  <div className="text-[length:var(--text-2xs)] text-text-muted">
                    {device.online ? uiText("ui.MobileWebTab.online") : uiText("ui.MobileWebTab.offline")}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-[length:var(--text-2xs)] text-text-secondary hover:text-danger shrink-0"
                  onClick={() => void window.electronAPI.mobileTerminal.revoke(device.id).then(() => loadDevices())}
                >
                  {uiText("ui.MobileWebTab.revoke")}
                </button>
              </div>
            ))}
          </div>

          {error && (
            <div className="text-[length:var(--text-11)] text-danger px-1">
              {uiText("ui.MobileWebTab.actionFailed")}{appText(error)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
