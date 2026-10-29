import { useCallback, useEffect, useRef, useState } from "react";
import { uiText, useUiLocale } from "../lib/i18n";
import type { CodexQuotaView, CodexResetCredit } from "@shared/codex-quota";
import { toast } from "./ui/Toast";
import { confirmDialog } from "./ui/ConfirmDialog";

/**
 * Codex（ChatGPT 订阅）额度块：5 小时 / 7 天两个窗口 + 可用的「手动重置」次数。
 *
 * 数据来自 ChatGPT 后端给官方客户端用的内部端点（无公开文档，见 `services/codex-usage.ts`），
 * 查询失败在独立套餐弹窗里显示重试入口。
 *
 * 「使用一次重置」是**不可逆**操作（会立即清空当前两个窗口的已用额度），因此：
 * 必须经 confirmDialog 二次确认（danger 样式、默认取消），并把将被清空的窗口与剩余次数
 * 写在确认文案里，而不是一句"确定吗"。
 */

function formatClock(at?: number, locale?: string): string {
  if (!at) return "";
  const date = new Date(at * 1000);
  const sameDay = new Date().toDateString() === date.toDateString();
  return new Intl.DateTimeFormat(locale, sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

/** 后端只给已用百分比；界面按「剩余」展示（100 - 已用，夹在 0~100，缺失显示破折号） */
function remainingPercent(usedPercent?: number): string {
  if (usedPercent === undefined || !Number.isFinite(usedPercent)) return "—";
  return `${Math.round(100 - Math.min(100, Math.max(0, usedPercent)))}%`;
}

/** 最早到期的那张凭据（提示用户先用快到期的） */
function soonestExpiry(items: CodexResetCredit[]): string | undefined {
  const times = items
    .map((item) => (item.expiresAt ? Date.parse(item.expiresAt) : Number.NaN))
    .filter((t) => Number.isFinite(t));
  if (times.length === 0) return undefined;
  return new Date(Math.min(...times)).toISOString();
}

export function CodexQuotaSection({ active, onPlan }: { active: boolean; onPlan?: (plan: string | undefined) => void }): JSX.Element | null {
  const locale = useUiLocale();
  const [quota, setQuota] = useState<CodexQuotaView | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 套餐等级要显示在弹窗标题里（父组件持有），每次渲染同步，避免为它多挂一个 effect
  const onPlanRef = useRef(onPlan);
  onPlanRef.current = onPlan;

  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const pending = useRef<Promise<void> | null>(null);

  const load = useCallback(async (force = false): Promise<void> => {
    if (!mounted.current) return;
    if (pending.current) return pending.current;
    const version = generation.current;
    setRefreshing(true);
    const request = (async () => {
      try {
        const result = await window.electronAPI.provider.codexQuota(force);
        if (!mounted.current || generation.current !== version) return;
        if (result.ok) { setQuota(result.quota); setReason(null); onPlanRef.current?.(result.quota.plan); }
        else setReason(result.reason);
      } catch (e) {
        console.error("[CodexQuota] 查询额度失败:", e);
        if (mounted.current && generation.current === version) setReason("network");
      } finally {
        if (mounted.current && generation.current === version) setRefreshing(false);
      }
    })();
    pending.current = request;
    try { await request; }
    finally { if (pending.current === request) pending.current = null; }
  }, []);

  useEffect(() => {
    mounted.current = active;
    generation.current++;
    if (!active) return;
    void load(true);
    const refresh = () => { if (document.visibilityState === "visible") void load(true); };
    // Match the main service's one-minute cache cadence; only while this popup is mounted.
    const timer = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted.current = false;
      generation.current++;
      pending.current = null;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [active, load]);

  const consume = useCallback(async () => {
    if (!quota) return;
    const windows = [
      quota.primary ? uiText("ui.CodexQuota.window5h") : null,
      quota.secondary ? uiText("ui.CodexQuota.windowWeekly") : null,
    ].filter(Boolean).join(" / ");
    const ok = await confirmDialog({
      title: uiText("ui.CodexQuota.confirmTitle"),
      message: uiText("ui.CodexQuota.confirmMessage", {
        v0: windows,
        v1: String(quota.credits.available),
      }),
      confirmText: uiText("ui.CodexQuota.usageButton"),
      // 额度重置不是「删除类」操作，不用危险红；不可逆性由确认文案承担
    });
    if (!ok) return;
    setBusy(true);
    try {
      // 优先用最早到期的那张（后端不指定时自己挑）
      const soonest = [...quota.credits.items]
        .filter((item) => item.expiresAt)
        .sort((a, b) => Date.parse(a.expiresAt!) - Date.parse(b.expiresAt!))[0];
      const result = await window.electronAPI.provider.codexConsumeReset(soonest?.id);
      const messages: Record<string, string> = {
        reset: uiText("ui.CodexQuota.resetDone", { v0: String(result.windowsReset ?? 1) }),
        nothing_to_reset: uiText("ui.CodexQuota.resetNothing"),
        no_credit: uiText("ui.CodexQuota.resetNoCredit"),
        already_redeemed: uiText("ui.CodexQuota.resetAlready"),
      };
      toast(messages[result.code] ?? uiText("ui.CodexQuota.resetFailed", { v0: result.error ?? result.code }));
      // A poll started during the confirmation must settle before the post-reset reload.
      await pending.current;
      await load(true);
    } catch (e) {
      console.error("[CodexQuota] 消耗重置失败:", e);
      toast(uiText("ui.CodexQuota.resetFailed", { v0: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }, [quota, load]);

  if (!active) return null;
  const soonest = quota ? soonestExpiry(quota.credits.items) : undefined;
  const rows = [
    { key: "primary", label: uiText("ui.CodexQuota.usage5h"), window: quota?.primary },
    { key: "secondary", label: uiText("ui.CodexQuota.usageWeekly"), window: quota?.secondary },
  ];
  const errorText = reason === "reauth" ? uiText("ui.CodexQuota.reauth")
    : reason ? uiText(quota ? "ui.CodexQuota.refreshFailed" : "ui.PlanUsage.unavailable") : "";

  return (
    <div className="space-y-4" aria-busy={refreshing} data-quota-section="true">
      {/* 每组两行：上行「额度名 + 剩余百分比」，下行小一号的重置时间——数值便于快速扫读，时间退到次要层级 */}
      {rows.map(({ key, label, window: usage }) => (
        <div key={key} data-quota-window={key} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-text-primary">{label}</span>
            <span className="shrink-0 text-sm font-medium text-text-primary tabular-nums" data-quota-value="true">
              {uiText("ui.CodexQuota.remainingAmount", { value: remainingPercent(usage?.usedPercent) })}
            </span>
          </div>
          <div className="text-xs text-text-muted tabular-nums">
            {uiText("ui.CodexQuota.resetAt", { v0: formatClock(usage?.resetAt, locale) || "—" })}
          </div>
        </div>
      ))}
      {/* 底部：次数与最早到期分两行（并排 + 按钮在 320px 内容宽里会挤到截断），按钮垂直居中 */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-sm text-text-primary tabular-nums">
            {uiText("ui.CodexQuota.creditsAvailable", { v0: quota ? String(quota.credits.available) : "—" })}
          </span>
          <span className="min-w-0 truncate text-xs text-text-muted tabular-nums">
            {uiText("ui.CodexQuota.expiresAt", { v0: soonest ? formatClock(Date.parse(soonest) / 1000, locale) : "—" })}
          </span>
        </span>
        <button type="button" disabled={busy || refreshing || !!reason || !quota?.credits.available} onClick={() => void consume()}
          className="shrink-0 h-7 px-3 rounded-[var(--radius-lg)] bg-surface-alt text-text-primary text-xs em-hover-control transition-colors disabled:opacity-40">
          {busy ? uiText("ui.CodexQuota.resetting") : uiText("ui.CodexQuota.usageButton")}
        </button>
      </div>
      {/* 无错误时整条不渲染：固定高度的空状态行曾在弹窗底部留下一条空白 */}
      {reason && (
        <div className="flex items-center gap-2 text-[length:var(--text-2xs)] text-text-secondary" role="status" aria-live="polite" data-quota-error="true">
          <span className="min-w-0 flex-1">{errorText}</span>
          <button type="button" disabled={refreshing} className="shrink-0 text-text-primary em-hover-control rounded px-2 py-1" onClick={() => void load(true)}>{uiText("ui.PlanUsage.retry")}</button>
        </div>
      )}
    </div>
  );
}
