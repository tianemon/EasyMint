import { formatNumber } from "../lib/locale-format";
import { uiText, useUiLocale, uiI18n } from "../lib/i18n";
import { useState, useEffect } from "react";
import { Modal } from "./ui/Modal";
import { formatTokenWindow } from "../lib/token-format";
import { costFormula, formatCostCny } from "@shared/usd-cny-rate";

interface SessionStats {
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  totalMessages: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  /** 未折算的高峰价合计（仅当发生了空闲时段折算时给出） */
  costPeak?: number;
  /** 费用口径：分时段计价的会话（DeepSeek）才有值，供界面标注 */
  costBasis?: "deepseek-offpeak" | "deepseek-peak";
  /** 费用里属于委派子 Agent 的部分（同样已按时段折算） */
  costSubagents?: number;
  contextUsage?: { percent: number; tokens: number; contextWindow: number };
}

export function SessionStatsPopup({ sessionId, projectPath, onClose, onCompress }: { sessionId: string; projectPath: string; onClose: () => void; onCompress?: () => void }) {
  useUiLocale();
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.agent.sessionStats(sessionId, projectPath).then((data) => {
      if (cancelled) return;
      if (data) {
        setStats(data as unknown as SessionStats);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
    // 账户余额（与统计并行获取，失败静默隐藏）
    window.electronAPI.settings.fetchBalance().then((data) => {
      if (cancelled) return;
      if (data?.balance_infos?.length) setBalance(data.balance_infos[0]!.total_balance);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [sessionId, projectPath]);

  const fmtTokens = (n: number) => formatNumber(n, { notation: "compact", maximumFractionDigits: 1 });
  // 费用显示（两位小数 + ≈）与 USD→CNY 估算换算统一在 @shared/usd-cny-rate——那里写了来源、报价日
  // 与更新策略；这里不再自己拿汇率
  const fmtCost = (cost: number) => formatCostCny(cost, uiI18n.resolvedLanguage);
  const fmtPct = (p: number) => p > 0 ? `${p.toFixed(2)}%` : "<0.01%";
  // 费用口径说明：DeepSeek 分时段计价（法定节假日取国务院公告的放假日期）
  const costBasisTitle = stats?.costBasis
    ? `${stats.costBasis === "deepseek-offpeak" && stats.costPeak ? uiText("ui.extra.costBeforeDiscount", { cost: fmtCost(stats.costPeak) }) : ""}`
      + uiText("ui.SessionStatsPopup.deepseekPeakHoursAreWeekdays0900")
    : "";

  return (
    <Modal overlayClassName="bg-black/40" onClose={onClose}>
      <div className="bg-[var(--modal-fill)] rounded-[var(--radius-lg)] p-5 max-w-sm w-full shadow-2xl mx-4">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-medium text-text-primary">{uiText("ui.SessionStatsPopup.sessionStatistics")}</span>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><path d="M3 3l8 8M11 3L3 11"/></svg>
          </button>
        </div>

        {loading ? (
          <div className="text-xs text-text-secondary py-4 text-center">{uiText("ui.AgentTemplateSettings.loading")}</div>
        ) : stats ? (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-surface-alt rounded-[var(--radius-lg)] p-2.5">
                <div className="text-text-secondary mb-0.5">{uiText("ui.SessionStatsPopup.userMessages")}</div>
                <div className="text-text-primary font-medium">{formatNumber(stats.userMessages)}</div>
              </div>
              <div className="bg-surface-alt rounded-[var(--radius-lg)] p-2.5">
                <div className="text-text-secondary mb-0.5">{uiText("ui.SessionStatsPopup.aiResponses")}</div>
                <div className="text-text-primary font-medium">{formatNumber(stats.assistantMessages)}</div>
              </div>
              <div className="bg-surface-alt rounded-[var(--radius-lg)] p-2.5">
                <div className="text-text-secondary mb-0.5">{uiText("ui.SessionStatsPopup.toolCalls")}</div>
                <div className="text-text-primary font-medium">{formatNumber(stats.toolCalls)}</div>
              </div>
              <div className="bg-surface-alt rounded-[var(--radius-lg)] p-2.5">
                <div className="text-text-secondary mb-0.5">{uiText("ui.SessionStatsPopup.totalMessages")}</div>
                <div className="text-text-primary font-medium">{formatNumber(stats.totalMessages)}</div>
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <div className="text-text-secondary mb-2">{uiText("ui.SessionStatsPopup.tokenUsage")}</div>
              <div className="space-y-1">
                <div className="flex justify-between"><span className="text-text-secondary">{uiText("ui.SessionStatsPopup.input")}</span><span className="text-text-primary tabular-nums">{fmtTokens(stats.tokens.input)}</span></div>
                <div className="flex justify-between"><span className="text-text-secondary">{uiText("ui.ChatPanel.output")}</span><span className="text-text-primary tabular-nums">{fmtTokens(stats.tokens.output)}</span></div>
                {stats.tokens.cacheRead > 0 && (
                  <div className="flex justify-between"><span className="text-text-secondary">{uiText("ui.SessionStatsPopup.cacheRead")}</span><span className="text-text-primary tabular-nums">{fmtTokens(stats.tokens.cacheRead)}</span></div>
                )}
                {stats.tokens.cacheWrite > 0 && (
                  <div className="flex justify-between"><span className="text-text-secondary">{uiText("ui.SessionStatsPopup.cacheWrite")}</span><span className="text-text-primary tabular-nums">{fmtTokens(stats.tokens.cacheWrite)}</span></div>
                )}
                <div className="flex justify-between border-t border-border/50 pt-1 mt-1">
                  <span className="text-text-secondary">{uiText("ui.SessionStatsPopup.total")}</span>
                  <span className="text-text-primary font-medium tabular-nums">{fmtTokens(stats.tokens.total)}</span>
                </div>
              </div>
            </div>

            {stats.contextUsage && (
              <div className="border-t border-border pt-3 space-y-1">
                <div className="text-text-secondary mb-1">{uiText("ui.SessionStatsPopup.contextUsage")}</div>
                <div className="flex justify-between"><span className="text-text-secondary">{uiText("ui.SessionStatsPopup.share")}</span><span className="text-text-primary tabular-nums">{fmtPct(stats.contextUsage.percent)}</span></div>
                <div className="flex justify-between"><span className="text-text-secondary">{uiText("ui.SessionStatsPopup.used")}</span><span className="text-text-primary tabular-nums">{fmtTokens(stats.contextUsage.tokens)}</span></div>
                <div className="flex justify-between"><span className="text-text-secondary">{uiText("ui.SessionStatsPopup.limit")}</span><span className="text-text-primary tabular-nums">{formatTokenWindow(stats.contextUsage.contextWindow)}</span></div>
              </div>
            )}

            <div className="border-t border-border pt-3 flex justify-between items-center">
              <span className="text-text-secondary">{uiText("ui.SessionStatsPopup.estimatedCost")}</span>
              <span className="text-accent font-medium text-sm tabular-nums" title={costFormula(stats.cost, uiI18n.resolvedLanguage)}>{fmtCost(stats.cost)}</span>
            </div>

            {stats.costSubagents && stats.costSubagents > 0 ? (
              <div className="mt-1 text-right text-[length:var(--text-2xs)] text-text-muted">
                {uiText("ui.SessionStatsPopup.delegatedSubagents")}{fmtCost(stats.costSubagents)}
              </div>
            ) : null}

            {stats.costBasis && (
              <div className="mt-1 text-right text-[length:var(--text-2xs)] text-text-muted" title={costBasisTitle}>
                {stats.costBasis === "deepseek-offpeak" ? uiText("ui.SessionStatsPopup.adjustedForDeepseekOffPeakHours") : uiText("ui.SessionStatsPopup.estimatedAtDeepseekPeakPricing")}
              </div>
            )}

            {balance !== null && (
              <div className="border-t border-border pt-3 flex justify-between items-center">
                <span className="text-text-secondary">{uiText("ui.SessionStatsPopup.accountBalance")}</span>
                <span className="text-text-primary font-medium text-sm tabular-nums">{balance}</span>
              </div>
            )}

            {onCompress && (
              <div className="border-t border-border pt-3 flex justify-end">
                <button
                  type="button"
                  onClick={onCompress}
                  className="update-install-btn"
                >
                  {uiText("ui.SessionStatsPopup.compactSession")}</button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-text-secondary py-4 text-center">{uiText("ui.SessionStatsPopup.noData")}</div>
        )}
      </div>
    </Modal>
  );
}