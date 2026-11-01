import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ProviderConfig } from "@shared/platform-presets";
import { accountUsageLabels, type AccountUsageResult, type AccountUsageRow } from "@shared/provider-usage";
import { formatPlanLabel } from "@shared/codex-quota";
import { uiText, useUiLocale } from "../../lib/i18n";
import { formatDate, formatNumber } from "../../lib/locale-format";
import { registerOverlay } from "../../lib/overlay-stack";
import { formatUsageValue } from "../ProviderUsageSection";

type Snapshot = Extract<AccountUsageResult, {ok:true}>;
type Failure = Extract<AccountUsageResult, {ok:false}>["reason"];

/** Mount per credential/configuration identity so a replacement never inherits the old view. */
export function ProviderUsagePreview({ config }: { config: ProviderConfig }): JSX.Element | null {
  if (!accountUsageLabels(config)) return null;
  return <UsagePreview key={JSON.stringify([config.id, config.presetId, config.authType, config.apiKey, config.baseUrl])} config={config} />;
}

function remaining(row: AccountUsageRow): number | undefined {
  if (row.value === undefined || !Number.isFinite(Number(row.value))) return undefined;
  if (row.unit === "usedPercent") return Math.max(0, 100 - Number(row.value));
  if (row.unit === "remainingPercent") return Number(row.value);
  return undefined;
}
function valueText(row: AccountUsageRow): string {
  const value = remaining(row);
  return value === undefined ? formatUsageValue(row) : uiText("ui.AccountUsage.remainingPercent", {value:formatNumber(value, {maximumFractionDigits:1})});
}

function UsagePreview({ config }: { config: ProviderConfig }): JSX.Element {
  useUiLocale();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState<Failure>();
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [authVersion, setAuthVersion] = useState(0);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({left:8, top:8, maxHeight:400});
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const suppressFocus = useRef(false);
  const dismiss = useCallback(() => {
    setOpen(false);
    if (document.activeElement !== trigger.current) { suppressFocus.current = true; trigger.current?.focus(); }
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const show = () => { clearTimeout(hideTimer.current); setOpen(true); };
  const leave = () => { clearTimeout(hideTimer.current); hideTimer.current = setTimeout(close, 180); };

  useEffect(() => () => clearTimeout(hideTimer.current), []);
  useEffect(() => window.electronAPI.provider.onAuthEvent?.(event => {
    if (event.providerId !== config.id && event.providerId !== config.presetId) return;
    if ((event.event as {kind?:string})?.kind !== "credentials_changed") return;
    setSnapshot(undefined); setAuthVersion(value => value + 1);
  }), [config.id, config.presetId]);
  useEffect(() => {
    let cancelled = false, pending = false;
    const apply = (result: AccountUsageResult) => {
      if (cancelled) return;
      if (result.ok && result.providerId === config.id) { setSnapshot(result); setError(undefined); }
      else if (!result.ok) {
        if (result.clearSnapshot || result.reason === "changed") setSnapshot(undefined);
        setError(result.reason);
      }
    };
    const load = async () => {
      if (pending) return;
      pending = true; setLoading(true);
      try {
        // Revalidate snapshot ownership on every refresh, including external login changes.
        const cached = await window.electronAPI.provider.usage(config.id, false, true);
        if (cancelled) return;
        if (cached.ok) apply(cached);
        else if (cached.clearSnapshot || cached.reason === "changed") setSnapshot(undefined);
        if (cancelled) return;
        const result = await window.electronAPI.provider.usage(config.id, attempt > 0);
        if (cancelled) return;
        // Credentials can change after the first cache read while the network request is running.
        if (!result.ok) {
          const fallback = await window.electronAPI.provider.usage(config.id, false, true);
          if (cancelled) return;
          if (fallback.ok || fallback.clearSnapshot || fallback.reason === "changed") apply(fallback);
        }
        apply(result);
      } catch { if (!cancelled) setError("unavailable"); }
      finally { pending = false; if (!cancelled) setLoading(false); }
    };
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const timer = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [config.id, attempt, authVersion]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 16);
      const height = panel.current?.getBoundingClientRect().height ?? 0;
      const below = window.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const down = height <= below || below >= above;
      const maxHeight = Math.max(0, down ? below : above);
      setPosition({left:Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top:down ? rect.bottom + 6 : Math.max(8, rect.top - Math.min(height, maxHeight) - 6), maxHeight});
    };
    place();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
    if (panel.current) observer?.observe(panel.current);
    window.addEventListener("resize", place);
    const onScroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) close(); };
    window.addEventListener("scroll", onScroll, true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); dismiss(); }
    };
    const onDown = (event: MouseEvent) => { if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(); };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    const unregister = registerOverlay(panel.current);
    return () => { observer?.disconnect(); unregister(); window.removeEventListener("resize", place); window.removeEventListener("scroll", onScroll, true); window.removeEventListener("keydown", onKey, true); document.removeEventListener("mousedown", onDown); };
  }, [open, close, dismiss]);

  const rows: AccountUsageRow[] = snapshot?.rows ?? accountUsageLabels(config)!.map(label => ({id:label, label, unit:"usedPercent" as const}));
  const stale = rows.some(row => row.resetAt && Date.parse(row.resetAt) <= Date.now());
  const compact = rows.slice(0, 2);
  const plan = formatPlanLabel(snapshot?.codex?.plan);
  const expiry = snapshot?.codex?.credits.items.map(item => Date.parse(item.expiresAt ?? "")).filter(Number.isFinite).sort((a,b) => a-b)[0];
  return <div className="mt-2" data-usage-preview={config.id}>
    <button ref={trigger} type="button" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--text-2xs)] text-text-secondary max-w-full rounded focus-visible:outline-accent"
      aria-label={uiText("ui.AccountUsage.title", {provider:config.name})} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onMouseEnter={show} onMouseLeave={leave} onFocus={() => { if (suppressFocus.current) suppressFocus.current = false; else show(); }} onBlur={event => { if (!panel.current?.contains(event.relatedTarget as Node)) leave(); }} onClick={show}>
      {compact.map(row => <span key={row.id} className="inline-flex items-center gap-1.5 min-w-0">
        <span>{uiText(`ui.AccountUsage.${row.label}`)}</span>
        {remaining(row) !== undefined && <span className="w-12 h-1 rounded-full bg-surface-hover overflow-hidden" aria-hidden="true"><span className={`block h-full rounded-full ${stale ? "bg-text-muted" : "bg-accent"}`} style={{width:`${Math.min(100, remaining(row)!)}%`}} /></span>}
        <span className="tabular-nums truncate max-w-28">{valueText(row)}</span>
      </span>)}
      {(stale || error) && <span className="text-text-muted">{uiText(snapshot ? "ui.AccountUsage.pendingRefresh" : "ui.PlanUsage.unavailable")}</span>}
    </button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label={uiText("ui.AccountUsage.title", {provider:config.name})} aria-busy={loading}
      className="no-drag fixed z-dropdown w-80 max-w-[calc(100vw-16px)] overflow-y-auto rounded-[var(--radius-lg)] border border-border bg-surface-elevated p-4 shadow-xl space-y-3 text-xs"
      style={position} onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={event => { if (!panel.current?.contains(event.relatedTarget as Node) && event.relatedTarget !== trigger.current) leave(); }}>
      <div className="flex justify-between items-center gap-2"><span className="font-medium text-sm text-text-primary truncate">{config.name} {plan}</span><button type="button" aria-label={uiText("common.close")} className="text-text-muted" onClick={dismiss}>×</button></div>
      {rows.map(row => <div key={row.id} className="space-y-1">
        <div className="flex items-baseline justify-between gap-3 text-text-primary"><span>{uiText(`ui.AccountUsage.${row.label}`)} {row.scope}</span><span className="tabular-nums">{valueText(row)}</span></div>
        {row.resetAt && <div className="text-text-muted">{uiText("ui.AccountUsage.resetAt", {time:formatDate(new Date(row.resetAt), {month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})})}</div>}
      </div>)}
      {snapshot?.codex && <div className="text-text-secondary">{uiText("ui.CodexQuota.creditsAvailable", {v0:String(snapshot.codex.credits.available)})}</div>}
      {expiry !== undefined && <div className="text-text-muted">{uiText("ui.CodexQuota.expiresAt", {v0:formatDate(expiry, {month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})})}</div>}
      {stale && <div className="text-text-muted">{uiText("ui.AccountUsage.pendingRefresh")}</div>}
      {error && <div role="status" className="text-text-secondary">{uiText(`ui.AccountUsage.error.${error}`)}</div>}
      <div className="flex items-center justify-between gap-3 pt-1 text-text-muted">
        <span>{snapshot ? uiText("ui.AccountUsage.updatedAt", {time:formatDate(snapshot.updatedAt, {month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}) : uiText("ui.AccountUsage.noSnapshot")}</span>
        <button type="button" disabled={loading} className="shrink-0 text-accent disabled:opacity-40" onClick={() => setAttempt(value => value + 1)}>{uiText(loading ? "ui.AccountUsage.refreshing" : "ui.AccountUsage.refresh")}</button>
      </div>
    </div>, document.body)}
  </div>;
}
