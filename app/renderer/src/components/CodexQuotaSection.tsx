import { useCallback, useEffect, useState } from "react";
import { uiText, useUiLocale } from "../lib/i18n";
import type { CodexQuotaView, CodexResetCredit } from "@shared/codex-quota";
import { toast } from "./ui/Toast";
import { confirmDialog } from "./ui/ConfirmDialog";

/**
 * Codex（ChatGPT 订阅）额度块：5 小时 / 7 天两个窗口 + 可用的「手动重置」次数。
 *
 * 数据来自 ChatGPT 后端给官方客户端用的内部端点（无公开文档，见 `services/codex-usage.ts`），
 * 所以整块按旁路处理：拿不到就**整块不渲染**，不占位、不报错。
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

/** 最早到期的那张凭据（提示用户先用快到期的） */
function soonestExpiry(items: CodexResetCredit[]): string | undefined {
  const times = items
    .map((item) => (item.expiresAt ? Date.parse(item.expiresAt) : Number.NaN))
    .filter((t) => Number.isFinite(t));
  if (times.length === 0) return undefined;
  return new Date(Math.min(...times)).toISOString();
}

function Bar({ percent, reached }: { percent: number; reached: boolean }): JSX.Element {
  return (
    <div className="h-1.5 w-full rounded-full bg-surface-hover overflow-hidden">
      <div
        className={reached ? "h-full bg-danger" : "h-full bg-accent"}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

export function CodexQuotaSection({ active }: { active: boolean }): JSX.Element | null {
  useUiLocale();
  const [quota, setQuota] = useState<CodexQuotaView | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (force = false) => {
    try {
      const result = await window.electronAPI.provider.codexQuota(force);
      if (result.ok) {
        setQuota(result.quota);
        setReason(null);
      } else {
        setQuota(null);
        setReason(result.reason);
      }
    } catch (e) {
      console.error("[CodexQuota] 查询额度失败:", e);
      setQuota(null);
      setReason("network");
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
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
      danger: true,
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
      await load(true);
    } catch (e) {
      console.error("[CodexQuota] 消耗重置失败:", e);
      toast(uiText("ui.CodexQuota.resetFailed", { v0: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }, [quota, load]);

  if (!active) return null;
  if (!quota) {
    // 拿不到就不占地方（只有"登录失效"值得说一句，否则用户会以为功能没做）
    if (reason !== "reauth") return null;
    return (
      <div className="border-t border-border pt-3">
        <div className="text-[length:var(--text-2xs)] text-danger">{uiText("ui.CodexQuota.reauth")}</div>
      </div>
    );
  }

  const soonest = soonestExpiry(quota.credits.items);
  const rows = [
    quota.primary ? { label: uiText("ui.CodexQuota.window5h"), w: quota.primary } : null,
    quota.secondary ? { label: uiText("ui.CodexQuota.windowWeekly"), w: quota.secondary } : null,
  ].filter((row): row is { label: string; w: NonNullable<CodexQuotaView["primary"]> } => row !== null);

  return (
    <div className="border-t border-border pt-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-text-secondary">{uiText("ui.CodexQuota.title")}</span>
        <span className="text-[length:var(--text-2xs)] text-text-muted tabular-nums">
          {quota.credits.available > 0
            ? uiText("ui.CodexQuota.creditsAvailable", { v0: String(quota.credits.available) })
            : uiText("ui.CodexQuota.noCredits")}
        </span>
      </div>

      {rows.map(({ label, w }) => (
        <div key={label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[length:var(--text-2xs)] text-text-secondary">{label}</span>
            <span className={`text-[length:var(--text-2xs)] tabular-nums ${w.reached ? "text-danger" : "text-text-primary"}`}>
              {Math.round(w.usedPercent)}%
            </span>
          </div>
          <Bar percent={w.usedPercent} reached={w.reached} />
          {w.resetAt !== undefined && (
            <div className="text-[length:var(--text-3xs)] text-text-muted tabular-nums">
              {uiText("ui.CodexQuota.resetAt", { v0: formatClock(w.resetAt) })}
            </div>
          )}
        </div>
      ))}

      {quota.credits.available > 0 && (
        <div className="flex items-center justify-between gap-2">
          {soonest && (
            <span className="text-[length:var(--text-3xs)] text-text-muted tabular-nums">
              {uiText("ui.CodexQuota.expiresAt", { v0: formatClock(Date.parse(soonest) / 1000) })}
            </span>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void consume()}
            className="ml-auto h-7 px-3 rounded-[var(--radius-lg)] text-[length:var(--text-2xs)] text-danger hover:bg-surface-hover transition-colors disabled:opacity-40"
          >{busy ? uiText("ui.CodexQuota.resetting") : uiText("ui.CodexQuota.usageButton")}</button>
        </div>
      )}
    </div>
  );
}
