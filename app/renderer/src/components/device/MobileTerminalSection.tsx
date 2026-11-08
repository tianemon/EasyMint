import { appText, uiText, useUiLocale } from "../../lib/i18n";
import { confirmDialog } from "../ui/ConfirmDialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

type Status = Awaited<ReturnType<typeof window.electronAPI.mobileWeb.getStatus>>;
type AppStatus = Awaited<ReturnType<typeof window.electronAPI.mobileTerminal.getStatus>>;
type Device = Awaited<ReturnType<typeof window.electronAPI.mobileTerminal.listDevices>>[number];

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
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null);
  // 事件回调里要读最新值（status-changed 订阅是挂载时建的），用 ref 避开闭包快照
  const appStatusRef = useRef<AppStatus | null>(null);
  const applyAppStatus = useCallback((next: AppStatus) => {
    appStatusRef.current = next;
    setAppStatus(next);
    setAppPortInput(String(next.port));
  }, []);
  const [error, setError] = useState("");
  // 端口跟各自的开关放在一起，两条通道互不影响（改端口后已配对的设备都要重连，见提示）
  const [appPortInput, setAppPortInput] = useState("");
  const [webPortInput, setWebPortInput] = useState("");
  const [appPortError, setAppPortError] = useState(false);
  const [webPortError, setWebPortError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pairs, setPairs] = useState<QrPair | null>(null);
  const [qrKind, setQrKind] = useState<QrKind>("web");
  const [host, setHost] = useState("");
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [devices, setDevices] = useState<Device[]>([]);
  const [portChanged, setPortChanged] = useState(false);
  const creatingRef = useRef(false);
  const hostRef = useRef("");
  const copiedTimer = useRef<number | null>(null);

  const applyStatus = useCallback((s: Status) => {
    setStatus(s);
    setWebPortInput(String(s.port));
    const nextHost = s.lanAddresses.includes(hostRef.current) ? hostRef.current : (s.lanAddresses[0] ?? "");
    hostRef.current = nextHost;
    setHost(nextHost);
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      // 待确认请求由窗口级弹窗自己订阅（面板关着也要能弹），这里只管已配对设备
      setDevices(await window.electronAPI.mobileTerminal.listDevices());
    } catch { /* 保留上一次结果 */ }
  }, []);

  const refreshOffers = useCallback(async (s: Status, targetHost: string, appEnabled: boolean) => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setError("");
    try {
      const opts = { width: 220, margin: 1, errorCorrectionLevel: "L" } as const;
      // 通道关着就不生成对应二维码：createPairingOffer 会顺带 ensureStarted()，
      // 关掉开关却因为「刷新二维码」把 47778 又听起来，等于开关没生效。
      const appQr = appEnabled
        ? await window.electronAPI.mobileTerminal.createOffer(hostRef.current || undefined).then((offer) =>
            QRCode.toDataURL(offer.uri, opts).then((qr) => ({ qr, expiresAt: offer.expiresAt })))
        : null;
      let expiresAt = appQr?.expiresAt ?? 0;
      let webQr = "";
      let webUrl = "";
      const urlHost = targetHost || s.lanAddresses[0] || "";
      if (s.enabled && s.running && s.bridgeReady && s.lanAddresses.length > 0) {
        // Web 二维码只带 10 位短码：桌面端另起一份独立 offer 登记短码表，
        // 浏览器同源 fetch('/pair/<code>.json') 取配对材料。
        const link = await window.electronAPI.mobileWeb.createPairLink();
        webUrl = `http://${urlHost}:${s.port}/#p=${link.code}`;
        webQr = await QRCode.toDataURL(webUrl, opts);
        expiresAt = expiresAt ? Math.min(expiresAt, link.expiresAt) : link.expiresAt;
      }
      setPairs(expiresAt
        ? { appQr: appQr?.qr ?? "", webQr, webUrl, expiresAt, port: s.port, host: urlHost }
        : null);
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
      const [s, app] = await Promise.all([
        window.electronAPI.mobileWeb.getStatus(),
        window.electronAPI.mobileTerminal.getStatus(),
      ]);
      applyStatus(s);
      applyAppStatus(app);
      await refreshOffers(s, hostRef.current, app.enabled);
    } catch (e) {
      setError(message(e));
    }
  }, [applyStatus, refreshOffers]);

  useEffect(() => {
    void loadStatus();
    void loadDevices();
    const offStatus = window.electronAPI.mobileWeb.onStatusChanged((s) => {
      applyStatus(s);
      void refreshOffers(s, hostRef.current, appStatusRef.current?.enabled ?? false);
    });
    const offChanged = window.electronAPI.mobileTerminal.onChanged(() => {
      void loadDevices();
      void window.electronAPI.mobileTerminal.getStatus().then(applyAppStatus).catch(() => undefined);
    });
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

  // 首帧默认展示「当前开着的那条通道」的二维码：浏览器通道关着时不该先给一张空码
  const defaultedQrKind = useRef(false);
  useEffect(() => {
    if (defaultedQrKind.current || !status || !appStatus) return;
    defaultedQrKind.current = true;
    if (!status.enabled && appStatus.enabled) setQrKind("app");
  }, [status, appStatus]);

  const secondsLeft = useMemo(() => pairs ? Math.max(0, Math.ceil((pairs.expiresAt - now) / 1_000)) : 0, [pairs, now]);

  const toggleEnabled = async () => {
    if (!status) return;
    setError("");
    try {
      const next = await window.electronAPI.mobileWeb.setEnabled(!status.enabled);
      applyStatus(next);
      await refreshOffers(next, hostRef.current, appStatusRef.current?.enabled ?? false);
      if (!next.enabled && qrKind === "web" && appStatusRef.current?.enabled) setQrKind("app");
    } catch (e) {
      setError(message(e));
      void loadStatus();
    }
  };

  const toggleAppEnabled = async () => {
    if (!appStatus) return;
    setError("");
    try {
      const next = await window.electronAPI.mobileTerminal.setEnabled(!appStatus.enabled);
      applyAppStatus(next);
      const web = status ?? await window.electronAPI.mobileWeb.getStatus();
      await refreshOffers(web, hostRef.current, next.enabled);
      // 正在展示的那条被关掉时切到另一条，避免停在「已关闭」的空二维码上
      if (!next.enabled && qrKind === "app" && web.enabled) setQrKind("web");
      if (next.enabled && qrKind === "web" && !web.enabled) setQrKind("app");
    } catch (e) {
      setError(message(e));
      void window.electronAPI.mobileTerminal.getStatus().then(applyAppStatus).catch(() => undefined);
    }
  };

  /** 端口提交：Enter 或失焦都走这里；非法值只标红、不打断当前监听。 */
  const applyPort = async (channel: "app" | "web"): Promise<void> => {
    const raw = channel === "app" ? appPortInput : webPortInput;
    const current = channel === "app" ? appStatus?.port : status?.port;
    const port = Number(raw);
    const invalid = !Number.isInteger(port) || port < 1024 || port > 65535;
    if (channel === "app") setAppPortError(invalid); else setWebPortError(invalid);
    if (invalid || port === current) return;
    setError("");
    try {
      if (channel === "app") {
        applyAppStatus(await window.electronAPI.mobileTerminal.setPort(port));
        // 端口变了，二维码里的 p= 也失效：立刻按新端口重建，别等用户手点刷新
        if (status) await refreshOffers(status, hostRef.current, true);
      } else {
        await window.electronAPI.mobileWeb.setPort(port);
      }
      setPortChanged(true);
    } catch (e) {
      setError(message(e));
      void loadStatus();
    }
  };

  const changeHost = (next: string) => {
    hostRef.current = next;
    setHost(next);
    if (status) void refreshOffers(status, next, appStatusRef.current?.enabled ?? false);
  };

  const refreshNow = () => {
    if (!status) return;
    setPortChanged(false);
    void refreshOffers(status, hostRef.current, appStatusRef.current?.enabled ?? false);
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

  const revokeAllWeb = async () => {
    const webDevices = devices.filter((d) => d.id.startsWith("web-"));
    if (webDevices.length === 0) return;
    const ok = await confirmDialog({
      title: uiText("ui.MobileWebTab.revokeAllTitle"),
      message: uiText("ui.MobileWebTab.revokeConfirm", { v0: webDevices.length }),
      confirmText: uiText("ui.MobileWebTab.revoke"),
      danger: true,
    });
    if (!ok) return;
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
    : qrKind === "web" && !status.bridgeReady ? uiText("ui.MobileWebTab.needEnableApp")
    : qrKind === "app" && !appStatus?.enabled ? uiText("ui.MobileWebTab.needEnableApp")
    : "";
  const qrStale = portChanged || (pairs !== null && status !== null && (pairs.port !== status.port || pairs.host !== host));

  return (
    <section className="shrink-0 space-y-2">
      {/* 两条通道：端口与开关放在一起，各管各的（关掉即释放端口） */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-surface-alt px-3 py-2 space-y-2">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-text-primary">{uiText("ui.MobileTerminalSection.appChannel")}</div>
            <div className="text-[length:var(--text-2xs)] text-text-muted mt-0.5 truncate">
              {!appStatus
                ? uiText("ui.MobileWebTab.loading")
                : !appStatus.enabled
                  ? uiText("ui.MobileTerminalSection.channelOff")
                  : appStatus.running
                    ? `${uiText("ui.MobileWebTab.running")} · ${uiText("ui.MobileTerminalSection.devicesOnline", { v0: appStatus.online })}`
                    : uiText("ui.MobileWebTab.stopped")}
            </div>
          </div>
          <input
            className={`w-[64px] px-1.5 py-1 rounded-[var(--radius-lg)] bg-surface border text-center text-[length:var(--text-2xs)] tabular-nums shrink-0 ${appPortError ? "border-danger text-danger" : "border-border text-text-primary"}`}
            inputMode="numeric"
            aria-label={`${uiText("ui.MobileTerminalSection.appChannel")} ${uiText("ui.MobileWebTab.portLabel")}`}
            value={appPortInput}
            onChange={(e) => { setAppPortInput(e.target.value); setAppPortError(false); }}
            onBlur={() => void applyPort("app")}
            onKeyDown={(e) => { if (e.key === "Enter") void applyPort("app"); }}
          />
          <Toggle checked={appStatus?.enabled ?? false} onChange={() => void toggleAppEnabled()} disabled={!appStatus} />
        </div>

        <div className="h-px bg-divider" />

        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-text-primary">{uiText("ui.MobileTerminalSection.webChannel")}</div>
            <div className="text-[length:var(--text-2xs)] text-text-muted mt-0.5 truncate">
              {!status
                ? uiText("ui.MobileWebTab.loading")
                : !status.enabled
                  ? uiText("ui.MobileTerminalSection.channelOff")
                  : !status.running
                    ? uiText("ui.MobileWebTab.stopped")
                    : status.bridgeReady
                      ? `${uiText("ui.MobileWebTab.running")} · ${uiText("ui.MobileWebTab.onlineWeb", { v0: status.onlineWebDevices })}`
                      : uiText("ui.MobileWebTab.needEnableApp")}
            </div>
          </div>
          <input
            className={`w-[64px] px-1.5 py-1 rounded-[var(--radius-lg)] bg-surface border text-center text-[length:var(--text-2xs)] tabular-nums shrink-0 ${webPortError ? "border-danger text-danger" : "border-border text-text-primary"}`}
            inputMode="numeric"
            aria-label={`${uiText("ui.MobileTerminalSection.webChannel")} ${uiText("ui.MobileWebTab.portLabel")}`}
            value={webPortInput}
            onChange={(e) => { setWebPortInput(e.target.value); setWebPortError(false); }}
            onBlur={() => void applyPort("web")}
            onKeyDown={(e) => { if (e.key === "Enter") void applyPort("web"); }}
          />
          <Toggle checked={status?.enabled ?? false} onChange={() => void toggleEnabled()} disabled={!status} />
        </div>
      </div>

      {(appPortError || webPortError) && (
        <div className="text-[length:var(--text-11)] text-danger px-1">{uiText("ui.MobileWebTab.portInvalid")}</div>
      )}

      {status && (
        <>
          {qrStale && (
            <div className="rounded-[var(--radius-lg)] border border-accent/40 bg-accent-soft px-3 py-2 text-[length:var(--text-11)] text-text-secondary">
              {qrKind === "app" ? uiText("ui.MobileTerminalSection.appPortChanged") : uiText("ui.MobileWebTab.portChangedHint")}
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
                void (async () => {
                  const ok = await confirmDialog({
                    title: uiText("ui.MobileWebTab.revokeTitle"),
                    message: uiText("ui.MobileTerminalSection.unpair", { v0: device.name }),
                    confirmText: uiText("ui.MobileWebTab.revoke"),
                    danger: true,
                  });
                  if (!ok) return;
                  await window.electronAPI.mobileTerminal.revoke(device.id);
                  await loadDevices();
                })();
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
