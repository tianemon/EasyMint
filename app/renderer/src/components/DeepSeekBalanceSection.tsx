import { useEffect, useState } from "react";
import { uiText, useUiLocale } from "../lib/i18n";

/** Account data stays with the mounted provider popup, independently of conversation stats. */
export function DeepSeekBalanceSection(): JSX.Element {
  useUiLocale();
  const [balances, setBalances] = useState<Array<{currency: string; total_balance: string}> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false, pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      setLoading(true);
      try {
        const data = await window.electronAPI.settings.fetchBalance();
        if (cancelled) return;
        const rows = data?.balance_infos?.filter(row => typeof row.currency === "string" && typeof row.total_balance === "string");
        if (rows?.length) { setBalances(rows); setError(false); }
        else setError(true);
      } catch (cause) {
        console.error("[DeepSeekBalance] 查询余额失败:", cause);
        if (!cancelled) setError(true);
      } finally {
        pending = false;
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const timer = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [retry]);
  const rows = balances ?? [{currency: "", total_balance: "—"}];
  return <div aria-busy={loading} className="space-y-3" data-account-balance="true">
    {rows.map((row, index) => <div key={index} className="flex items-baseline justify-between gap-3 text-sm text-text-primary">
      <span>{uiText("ui.ProviderAccount.balance")}</span>
      <span className="tabular-nums">{row.currency ? `${row.currency} ${row.total_balance}` : "—"}</span>
    </div>)}
    {error && <div role="status" className="flex items-center gap-2 text-[length:var(--text-2xs)] text-text-secondary">
      <span className="min-w-0 flex-1">{uiText("ui.ProviderAccount.balanceUnavailable")}</span>
      <button type="button" disabled={loading} className="shrink-0 text-text-primary em-hover-control rounded px-2 py-1" onClick={() => setRetry(value => value + 1)}>{uiText("ui.PlanUsage.retry")}</button>
    </div>}
  </div>;
}
