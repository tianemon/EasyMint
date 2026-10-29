import { useChatStore } from "../stores/chat-store";
import { formatNumber } from "../lib/locale-format";
import { uiText, useUiLocale } from "../lib/i18n";
import { useState, useEffect, useMemo } from "react";
import { Modal } from "./ui/Modal";
import { formatTokenWindow } from "../lib/token-format";

/**
 * 会话统计弹窗。
 *
 * 两条硬约束（用户 2026-10-29）：
 * 1. **空会话也要有完整骨架**：没有数字就只显示数据项名称，不写 0、也不退化成「暂无数据」；
 * 2. **余额不依赖会话**：它是账号级信息；套餐额度由输入卡片的独立入口展示。
 *
 * 费用估算已移除（那个数字既不是实付、也与账单对不上，摆在这里只会误导）。
 */

interface SessionStats {
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  totalMessages: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  contextUsage?: { percent: number; tokens: number; contextWindow: number };
}

/** 一行「名称 —— 数值」：没有值就只留名称（空会话的形态） */
function Row({ label, value, title }: { label: string; value?: string; title?: string }): JSX.Element {
  return (
    <div className="flex justify-between" title={value ? title : undefined}>
      <span className="text-text-secondary">{label}</span>
      {value ? <span className="text-text-primary tabular-nums">{value}</span> : null}
    </div>
  );
}

export function SessionStatsPopup({ sessionId, projectPath, onClose, onCompress }: { sessionId: string; projectPath: string; onClose: () => void; onCompress?: () => void }) {
  useUiLocale();
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const sessionMessages = useChatStore(state => state.messagesBySession[sessionId]);
  // Keep the original main-session metric: cache reads / all input, including cold starts.
  const cacheRate = useMemo(() => {
    let read = 0, input = 0, write = 0;
    for (const message of sessionMessages ?? []) {
      const usage = message.usage;
      read += usage?.cacheReadTokens ?? 0;
      input += usage?.inputTokens ?? 0;
      write += usage?.cacheWriteTokens ?? 0;
    }
    const total = read + input + write;
    return total > 0 ? ((read / total) * 100).toFixed(2) : null;
  }, [sessionMessages]);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.agent.sessionStats(sessionId, projectPath).then((data) => {
      if (cancelled || !data) return;
      setStats(data as unknown as SessionStats);
    }).catch(() => {});
    // 账户余额（与统计并行获取，失败静默隐藏）
    window.electronAPI.settings.fetchBalance().then((data) => {
      if (cancelled) return;
      if (data?.balance_infos?.length) setBalance(data.balance_infos[0]!.total_balance);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [sessionId, projectPath]);

  const fmtTokens = (n: number) => formatNumber(n, { notation: "compact", maximumFractionDigits: 1 });
  const fmtPct = (p: number) => p > 0 ? `${p.toFixed(2)}%` : "<0.01%";
  // 0 与「还没数据」在这里是同一种表达：留空，不写 0
  const count = (n: number | undefined) => (n ? formatNumber(n) : undefined);
  const tokens = (n: number | undefined) => (n ? fmtTokens(n) : undefined);

  return (
    <Modal overlayClassName="bg-black/40" onClose={onClose}>
      <div className="bg-[var(--modal-fill)] rounded-[var(--radius-lg)] p-5 max-w-sm w-full shadow-2xl mx-4">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-medium text-text-primary">{uiText("ui.SessionStatsPopup.sessionStatistics")}</span>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><path d="M3 3l8 8M11 3L3 11"/></svg>
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: uiText("ui.SessionStatsPopup.userMessages"), value: count(stats?.userMessages) },
              { label: uiText("ui.SessionStatsPopup.aiResponses"), value: count(stats?.assistantMessages) },
              { label: uiText("ui.SessionStatsPopup.toolCalls"), value: count(stats?.toolCalls) },
              { label: uiText("ui.SessionStatsPopup.totalMessages"), value: count(stats?.totalMessages) },
            ].map(({ label, value }) => (
              <div key={label} className="bg-surface-alt rounded-[var(--radius-lg)] p-2.5">
                <div className="text-text-secondary mb-0.5">{label}</div>
                {value ? <div className="text-text-primary font-medium">{value}</div> : null}
              </div>
            ))}
          </div>

          <div className="border-t border-border pt-3">
            <div className="text-text-secondary mb-2">{uiText("ui.SessionStatsPopup.tokenUsage")}</div>
            <div className="space-y-1">
              <Row label={uiText("ui.SessionStatsPopup.input")} value={tokens(stats?.tokens.input)} />
              <Row label={uiText("ui.ChatPanel.output")} value={tokens(stats?.tokens.output)} />
              {!!stats?.tokens.cacheRead && <Row label={uiText("ui.SessionStatsPopup.cacheRead")} value={tokens(stats.tokens.cacheRead)} />}
              {!!stats?.tokens.cacheWrite && <Row label={uiText("ui.SessionStatsPopup.cacheWrite")} value={tokens(stats.tokens.cacheWrite)} />}
              {/* 子分割线：比段落分割线更淡，表示「这是上面这一组的合计」 */}
              <div className="flex justify-between border-t border-border/50 pt-1 mt-1">
                <span className="text-text-secondary">{uiText("ui.SessionStatsPopup.total")}</span>
                {stats?.tokens.total ? (
                  <span className="text-text-primary font-medium tabular-nums">{fmtTokens(stats.tokens.total)}</span>
                ) : null}
              </div>
            </div>
          </div>

          {stats?.contextUsage && (
            <div className="border-t border-border pt-3 space-y-1">
              <div className="text-text-secondary mb-1">{uiText("ui.SessionStatsPopup.contextUsage")}</div>
              <Row label={uiText("ui.SessionStatsPopup.share")} value={fmtPct(stats.contextUsage.percent)} />
              <Row label={uiText("ui.SessionStatsPopup.used")} value={tokens(stats.contextUsage.tokens)} />
              <Row label={uiText("ui.SessionStatsPopup.limit")} value={formatTokenWindow(stats.contextUsage.contextWindow)} />
            </div>
          )}

          <div className="border-t border-border pt-3">
            <Row
              label={uiText("ui.ChatInput.averageCacheHitRate").trim()}
              value={cacheRate !== null ? `${cacheRate}%` : undefined}
              title={uiText("ui.ChatInput.includesColdStartTurnsProviderCachesMay")}
            />
          </div>

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
      </div>
    </Modal>
  );
}
