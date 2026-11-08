import { appText, uiText, useUiLocale } from "../../lib/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

type Status = Awaited<ReturnType<typeof window.electronAPI.mobileWeb.getStatus>>;
type Device = Awaited<ReturnType<typeof window.electronAPI.mobileTerminal.listDevices>>[number];
type Pending = Awaited<ReturnType<typeof window.electronAPI.mobileTerminal.listPending>>[number];

interface QrPair {
  appQr: string;
  webQr: string;
  webUrl: string;
  expiresAt: number;
  port: number;
  host: string;
}

type QrKind = "web" | "app";

function relativeTime(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp);
  if (diff < 60_000) return uiText("ui.DevicePanel.justNow");
  if (diff < 3_600_000) return uiText("ui.DevicePanel.minutesAgo", { v0: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return uiText("ui.DevicePanel.hoursAgo", { v0: Math.floor(diff / 3_600_000) });
  return uiText("ui.DevicePanel.daysAgo", { v0: Math.floor(diff / 86_400_000) });
}

function Toggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-8 h-4 rounded-full transition-colors overflow-hidden shrink-0 ${checked ? "bg-accent" : "bg-surface-hover"}`}
      role="switch"
      aria-checked={checked}
      aria-label={uiText("ui.MobileWebTab.enableLabel")}
    >
      <span className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-surface-elevated shadow transition-all ${checked ? "left-[calc(100%-14px)]" : "left-0.5"}`} />
    </button>
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

/**
 * 工具箱「连接手机」面板：手机 App 与浏览器两条连接方式合一。
 * - App 二维码始终可生成（保持原有能力，不依赖 HTTP 开关）。
 * - 浏览器二维码需开启 HTTP 服务；默认展示它，避免手机相机扫到 easymint:// 自定义 scheme 无反应。
 * - 两张码各用一份独立 offer（服务端 token 一次性消费），一次只显示一张 220px 大图提高可扫性。
 */
export function MobileTerminalSection(): JSX.Element {
  useUiLocale();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [portInput, setPortInput] = useState("");
  const [portError, setPortError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pairs, setPairs] = useState<QrPair | null>(null);
  const [qrKind, setQrKind] = useState<QrKind>("web");
  const [host, setHost] = useState("");
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState<Pending[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [portChanged, setPortChanged] = useState(false);
  const creatingRef = useRef(false);
  const prevPortRef = useRef<number | null>(null);
  const hostRef = useRef("");
  const copiedTimer = useRef<number | null>(null);

  const applyStatus = useCallback((s: Status) => {
    setStatus(s);
    setPortInput(String(s.port));
    if (prevPortRef.current !== null && prevPortRef.current !== s.port) setPortChanged(true);
    prevPortRef.current = s.port;
    const nextHost = s.lanAddresses.includes(hostRef.current) ? hostRef.current : (s.lanAddresses[0] ?? "");
    hostRef.current = nextHost;
    setHost(nextHost);
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

  const refreshOffers = useCallback(async (s: Status, targetHost: string) => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setError("");
    try {
      const opts = { width: 220, margin: 1, errorCorrectionLevel: "L" } as const;
      const appOffer = await window.electronAPI.mobileTerminal.createOffer();
      const appQr = await QRCode.toDataURL(appOffer.uri, opts);
      let expiresAt = appOffer.expiresAt;
      let webQr = "";
      let webUrl = "";
      const urlHost = targetHost || s.lanAddresses[0] || "";
      if (s.enabled && s.running && s.lanAddresses.length > 0) {
        // Web 二维码只带 10 位短码：桌面端另起一份独立 offer 登记短码表，
        // 浏览器同源 fetch('/pair/<code>.json') 取配对材料。
        const link = await window.electronAPI.mobileWeb.createPairLink();
        webUrl = `http://${urlHost}:${s.port}/#p=${link.code}`;
        webQr = await QRCode.toDataURL(webUrl, opts);
        expiresAt = Math.min(expiresAt, link.expiresAt);
      }
      setPairs({ appQr, webQr, webUrl, expiresAt, port: s.port, host: urlHost });
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
      await refreshOffers(s, hostRef.current);
    } catch (e) {
      setError(message(e));
    }
  }, [applyStatus, refreshOffers]);

  useEffect(() => {
    void loadStatus();
    void loadDevices();
    const offStatus = window.electronAPI.mobileWeb.onStatusChanged((s) => {
      applyStatus(s);
      void refreshOffers(s, hostRef.current);
    });
    const offChanged = window.electronAPI.mobileTerminal.onChanged(() => void loadDevices());
    const offPair = window.electronAPI.mobileTerminal.onPairRequest(() => void loadDevices());
    const offError = window.electronAPI.mobileTerminal.onError(({ message: msg }) => setError(msg));
    return () => {
      offStatus(); offChanged(); offPair(); offError();
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    };
  }, [loadStatus, loadDevices, applyStatus, refreshOffers]);

  useEffect(() => {
    if (!pairs) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [pairs]);

  const secondsLeft = useMemo(() => pairs ? Math.max(0, Math.ceil((pairs.expiresAt - now) / 1_000)) : 0, [pairs, now]);

  const toggleEnabled = async () => {
    if (!status) return;
    setError("");
    try {
      const next = await window.electronAPI.mobileWeb.setEnabled(!status.enabled);
      applyStatus(next);
      await refreshOffers(next, hostRef.current);
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
      await window.electronAPI.mobileWeb.setPort(port);
    } catch (e) {
      setError(message(e));
      void loadStatus();
    }
  };

  const changeHost = (next: string) => {
    hostRef.current = next;
    setHost(next);
    if (status) void refreshOffers(status, next);
  };

  const refreshNow = () => {
    if (!status) return;
    setPortChanged(false);
    void refreshOffers(status, hostRef.current);
  };

  const copyLink = async () => {
    if (!pairs?.webUrl) return;
    try {
      await navigator.clipboard.writeText(pairs.webUrl);
      setCopied(true);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2_000);
    } catch (e) {
      setError(message(e));
    }
  };

  const finishPair = async (requestId: string, accept: boolean) => {
    const result = accept
      ? await window.electronAPI.mobileTerminal.acceptPair(requestId)
      : await window.electronAPI.mobileTerminal.rejectPair(requestId);
    if (!result.ok) setError(uiText("ui.MobileWebTab.expired"));
    await loadDevices();
    if (accept && result.ok) setPairs(null);
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

  const currentQr = pairs && secondsLeft > 0 ? (qrKind === "web" ? pairs.webQr : pairs.appQr) : "";
  const blockedReason = !status ? uiText("ui.MobileWebTab.loading")
    : qrKind === "web" && !status.enabled ? uiText("ui.MobileWebTab.needEnable")
    : qrKind === "web" && !status.running ? uiText("ui.MobileWebTab.notRunning")
    : qrKind === "web" && status.lanAddresses.length === 0 ? uiText("ui.MobileWebTab.noLan")
    : "";
  const qrStale = portChanged || (pairs !== null && status !== null && (pairs.port !== status.port || pairs.host !== host));

  return (
    <section className="shrink-0 space-y-2">
      {/* 标题 + 开关 */}
      <div className="flex items-center justify-between px-1 gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-text-secondary">{uiText("ui.MobileTerminalSection.mobileTerminal")}</div>
          <div className="text-[length:var(--text-2xs)] text-text-muted mt-0.5">{uiText("ui.MobileTerminalSection.thePhoneShowsLiveDesktopDataWithout")}</div>
        </div>
        <Toggle checked={status?.enabled ?? false} onChange={() => void toggleEnabled()} disabled={!status} />
      </div>

      {status && (
        <>
          {/* 运行状态 */}
          <div className="rounded-[var(--radius-lg)] border border-border bg-surface-alt px-3 py-2 space-y-1">
            <div className="flex items-center gap-2 text-[length:var(--text-2xs)]">
              <span className={`w-2 h-2 rounded-full ${status.running ? "bg-success" : "bg-text-muted/40"}`} />
              <span className="text-text-secondary">{status.running ? uiText("ui.MobileWebTab.running") : uiText("ui.MobileWebTab.stopped")}</span>
              <span className="text-text-muted">·</span>
              <span className="text-text-muted">{uiText("ui.MobileWebTab.portLabel")} {status.port}</span>
            </div>
            <div className="text-[length:var(--text-2xs)] text-text-muted truncate">
              {uiText("ui.MobileWebTab.lanLabel")}: {status.lanAddresses.length > 0 ? status.lanAddresses.join(", ") : uiText("ui.MobileWebTab.noLan")}
            </div>
            <div className="text-[length:var(--text-2xs)] text-text-muted">
              {uiText("ui.MobileWebTab.onlineWeb", { v0: status.onlineWebDevices })}
            </div>
          </div>

          {/* 端口：输入框与按钮同行，说明文字放在下方 */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <input
                className="w-20 px-2 py-1 rounded-[var(--radius-lg)] bg-surface-alt border border-border text-text-primary text-sm shrink-0"
                inputMode="numeric"
                aria-label={uiText("ui.MobileWebTab.portLabel")}
                value={portInput}
                onChange={(e) => { setPortInput(e.target.value); setPortError(false); }}
              />
              <button type="button" className="px-3 py-1 text-xs btn-accent rounded-[var(--radius-lg)] shrink-0" onClick={() => void applyPort()}>
                {uiText("ui.MobileWebTab.portApply")}
              </button>
            </div>
            <div className="text-[length:var(--text-2xs)] text-text-muted">
              {uiText("ui.MobileWebTab.portLabel")} · {uiText("ui.MobileWebTab.portHint")}
            </div>
          </div>
          {portError && <div className="text-[length:var(--text-11)] text-danger">{uiText("ui.MobileWebTab.portInvalid")}</div>}
          {qrStale && (
            <div className="rounded-[var(--radius-lg)] border border-accent/40 bg-accent-soft px-3 py-2 text-[length:var(--text-11)] text-text-secondary">
              {uiText("ui.MobileWebTab.portChangedHint")}
            </div>
          )}

          {/* 二维码：默认浏览器，一次只显示一张 220px 大图 */}
          <div className="rounded-[var(--radius-lg)] border border-border bg-surface px-3 py-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 shrink-0">
                {(["web", "app"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={`px-2 py-1 text-[length:var(--text-2xs)] rounded-[var(--radius-lg)] transition-colors ${qrKind === kind ? "bg-accent text-text-inverse" : "bg-surface-hover text-text-secondary"}`}
                    onClick={() => setQrKind(kind)}
                  >
                    {kind === "web" ? uiText("ui.MobileWebTab.webQrTitle") : uiText("ui.MobileWebTab.appQrTitle")}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="text-[length:var(--text-2xs)] px-2 py-1 rounded-[var(--radius-lg)] btn-accent shrink-0"
                disabled={creating}
                onClick={refreshNow}
              >
                {creating ? uiText("ui.MobileWebTab.refreshing") : uiText("ui.MobileWebTab.refresh")}
              </button>
            </div>

            {status.lanAddresses.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-[length:var(--text-2xs)] text-text-muted shrink-0">{uiText("ui.MobileWebTab.lanSelect")}</span>
                <select
                  className="flex-1 min-w-0 px-2 py-1 rounded-[var(--radius-lg)] bg-surface-alt border border-border text-text-primary text-[length:var(--text-2xs)]"
                  value={host}
                  onChange={(e) => changeHost(e.target.value)}
                >
                  {status.lanAddresses.map((address) => <option key={address} value={address}>{address}</option>)}
                </select>
              </div>
            )}

            {currentQr ? (
              <>
                <div className="flex flex-col items-center">
                  <img
                    src={currentQr}
                    alt={qrKind === "web" ? uiText("ui.MobileWebTab.qrAltWeb") : uiText("ui.MobileWebTab.qrAltApp")}
                    className="w-[220px] h-[220px] rounded-md"
                  />
                  <div className="text-[length:var(--text-2xs)] text-text-secondary mt-2 text-center">
                    {qrKind === "web" ? uiText("ui.MobileWebTab.webQrHint") : uiText("ui.MobileWebTab.appQrHint")}
                  </div>
                  <div className="text-[length:var(--text-2xs)] text-text-muted mt-0.5">
                    {uiText("ui.MobileWebTab.expiresIn", { v0: secondsLeft })}
                  </div>
                </div>
                {qrKind === "web" && pairs?.webUrl && (
                  <div className="space-y-1">
                    <div className="text-[length:var(--text-2xs)] text-text-muted break-all">{pairs.webUrl}</div>
                    <button
                      type="button"
                      className="w-full px-2 py-1 text-[length:var(--text-2xs)] rounded-[var(--radius-lg)] bg-surface-hover text-text-secondary"
                      onClick={() => void copyLink()}
                    >
                      {copied ? uiText("ui.MobileWebTab.copied") : uiText("ui.MobileWebTab.copyLink")}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="text-[length:var(--text-11)] text-text-muted text-center py-6">
                {creating ? uiText("ui.MobileWebTab.refreshing") : blockedReason || uiText("ui.MobileWebTab.expired")}
              </div>
            )}
          </div>
        </>
      )}

      {/* 待确认配对 */}
      {pending.map((request) => (
        <div key={request.requestId} className="rounded-[var(--radius-lg)] border border-accent/40 bg-accent-soft px-3 py-3">
          <div className="text-xs font-medium text-text-primary">{request.deviceName} {uiText("ui.MobileWebTab.wantsToConnect")}</div>
          <div className="text-[length:var(--text-2xs)] text-text-secondary mt-1">{uiText("ui.MobileWebTab.pendingHint")}</div>
          <div className="font-mono text-xl tracking-[0.25em] text-accent text-center my-2">{request.verificationCode}</div>
          <div className="flex justify-end gap-2">
            <button type="button" className="px-3 py-1 text-xs text-text-secondary" onClick={() => void finishPair(request.requestId, false)}>{uiText("ui.MobileWebTab.reject")}</button>
            <button type="button" className="px-3 py-1 text-xs btn-accent rounded-[var(--radius-lg)]" onClick={() => void finishPair(request.requestId, true)}>{uiText("ui.MobileWebTab.confirm")}</button>
          </div>
        </div>
      ))}

      {/* 已配对设备 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-medium text-text-secondary">{uiText("ui.MobileWebTab.devicesTitle")}</span>
          {devices.some((d) => d.id.startsWith("web-")) && (
            <button type="button" className="text-[length:var(--text-2xs)] text-text-secondary hover:text-danger" onClick={() => void revokeAllWeb()}>
              {uiText("ui.MobileWebTab.revokeAll")}
            </button>
          )}
        </div>
        {devices.length === 0 && <div className="text-[length:var(--text-2xs)] text-text-muted px-1">{uiText("ui.MobileWebTab.noDevices")}</div>}
        {devices.map((device) => (
          <div key={device.id} className="flex items-center gap-2.5 rounded-[var(--radius-lg)] border border-border bg-surface px-3 py-2.5">
            <span className={`w-2 h-2 rounded-full ${device.online ? "bg-success" : "bg-text-muted/40"}`} />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-text-primary truncate">
                {device.name}
                <span className="text-[length:var(--text-2xs)] text-text-muted ml-1.5">
                  {device.id.startsWith("web-") ? uiText("ui.MobileWebTab.deviceBrowser") : uiText("ui.MobileWebTab.deviceApp")}
                </span>
              </div>
              <div className="text-[length:var(--text-2xs)] text-text-muted">
                {device.online ? uiText("ui.MobileWebTab.online") : uiText("ui.DevicePanel.offline", { v0: relativeTime(device.lastSeen) })}
              </div>
            </div>
            <button
              type="button"
              className="text-[length:var(--text-2xs)] text-text-secondary hover:text-danger shrink-0"
              onClick={() => {
                if (window.confirm(uiText("ui.MobileTerminalSection.unpair", { v0: device.name }))) {
                  void window.electronAPI.mobileTerminal.revoke(device.id).then(() => loadDevices());
                }
              }}
            >
              {uiText("ui.MobileWebTab.revoke")}
            </button>
          </div>
        ))}
      </div>

      {error && <div className="text-[length:var(--text-11)] text-danger px-1">{uiText("ui.MobileWebTab.actionFailed")}{appText(error)}</div>}
    </section>
  );
}
