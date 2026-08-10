import { useState, useEffect } from "react";

interface SessionStats {
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  totalMessages: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  contextUsage?: { percent: number; tokens: number; contextWindow: number };
  /** 当前模型(判断 cost 币种:DeepSeek=¥, 其他=$) */
  model?: string;
}

export function SessionStatsPopup({ sessionId, projectPath, onClose }: { sessionId: string; projectPath: string; onClose: () => void }) {
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

  const fmtTokens = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  // Pi 的 usage.cost 统一为美元(模型定价 $/M token × tokens)——不再按模型名猜币种。
  // 汇率:USD→CNY 央行中间价(2026-08-10 为 6.7884),显示层统一换算为 ¥。
  const USD_CNY_RATE = 6.7884;
  const fmtCost = (c: number) => {
    if (c <= 0) return "—";
    return `¥${(c * USD_CNY_RATE).toFixed(4)}`;
  };
  const fmtPct = (p: number) => p > 0 ? `${p.toFixed(2)}%` : "<0.01%";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl p-5 max-w-sm w-full shadow-2xl mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-medium text-text-primary">会话统计</span>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><path d="M3 3l8 8M11 3L3 11"/></svg>
          </button>
        </div>

        {loading ? (
          <div className="text-xs text-text-secondary py-4 text-center">加载中...</div>
        ) : stats ? (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-surface-alt rounded-lg p-2.5">
                <div className="text-text-secondary mb-0.5">用户消息</div>
                <div className="text-text-primary font-medium">{stats.userMessages}</div>
              </div>
              <div className="bg-surface-alt rounded-lg p-2.5">
                <div className="text-text-secondary mb-0.5">AI 回复</div>
                <div className="text-text-primary font-medium">{stats.assistantMessages}</div>
              </div>
              <div className="bg-surface-alt rounded-lg p-2.5">
                <div className="text-text-secondary mb-0.5">工具调用</div>
                <div className="text-text-primary font-medium">{stats.toolCalls}</div>
              </div>
              <div className="bg-surface-alt rounded-lg p-2.5">
                <div className="text-text-secondary mb-0.5">消息总数</div>
                <div className="text-text-primary font-medium">{stats.totalMessages}</div>
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <div className="text-text-secondary mb-2">Token 消耗</div>
              <div className="space-y-1">
                <div className="flex justify-between"><span className="text-text-secondary">输入</span><span className="text-text-primary tabular-nums">{fmtTokens(stats.tokens.input)}</span></div>
                <div className="flex justify-between"><span className="text-text-secondary">输出</span><span className="text-text-primary tabular-nums">{fmtTokens(stats.tokens.output)}</span></div>
                {stats.tokens.cacheRead > 0 && (
                  <div className="flex justify-between"><span className="text-text-secondary">缓存读</span><span className="text-text-primary tabular-nums">{fmtTokens(stats.tokens.cacheRead)}</span></div>
                )}
                {stats.tokens.cacheWrite > 0 && (
                  <div className="flex justify-between"><span className="text-text-secondary">缓存写</span><span className="text-text-primary tabular-nums">{fmtTokens(stats.tokens.cacheWrite)}</span></div>
                )}
                <div className="flex justify-between border-t border-border/50 pt-1 mt-1">
                  <span className="text-text-secondary">合计</span>
                  <span className="text-text-primary font-medium tabular-nums">{fmtTokens(stats.tokens.total)}</span>
                </div>
              </div>
            </div>

            {stats.contextUsage && (
              <div className="border-t border-border pt-3 space-y-1">
                <div className="text-text-secondary mb-1">上下文用量</div>
                <div className="flex justify-between"><span className="text-text-secondary">占比</span><span className="text-text-primary tabular-nums">{fmtPct(stats.contextUsage.percent)}</span></div>
                <div className="flex justify-between"><span className="text-text-secondary">已用</span><span className="text-text-primary tabular-nums">{fmtTokens(stats.contextUsage.tokens)}</span></div>
                <div className="flex justify-between"><span className="text-text-secondary">上限</span><span className="text-text-primary tabular-nums">{fmtTokens(stats.contextUsage.contextWindow)}</span></div>
              </div>
            )}

            <div className="border-t border-border pt-3 flex justify-between items-center">
              <span className="text-text-secondary">估算费用</span>
              <span className="text-accent font-medium text-sm tabular-nums">{fmtCost(stats.cost)}</span>
            </div>

            {balance !== null && (
              <div className="border-t border-border pt-3 flex justify-between items-center">
                <span className="text-text-secondary">账户余额</span>
                <span className="text-text-primary font-medium text-sm tabular-nums">{balance}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-text-secondary py-4 text-center">暂无数据</div>
        )}
      </div>
    </div>
  );
}