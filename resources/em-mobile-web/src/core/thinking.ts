/** 思考等级档位（从低到高），顺序用于「当前档位不可用时挑最近档位」的推导 */
export const THINKING_ORDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export const THINKING_LABELS: Record<string, string> = {
  off: '关闭', minimal: '极低', low: '轻度', medium: '中', high: '高', xhigh: '极高', max: '最高',
};

/** 当前档位不在模型可用档位里时，优先向下取最近档位，否则向上；都没有则关闭 */
export function resolveThinkingLevel(requested: string, available: string[]): string {
  if (!available.length || available.includes(requested)) return requested;
  const requestedIndex = THINKING_ORDER.indexOf(requested as typeof THINKING_ORDER[number]);
  if (requestedIndex < 0) return requested;
  const indexes = available.map((level) => THINKING_ORDER.indexOf(level as typeof THINKING_ORDER[number])).filter((index) => index >= 0).sort((a, b) => a - b);
  const lower = indexes.filter((index) => index < requestedIndex && (requested === 'off' || index > 0));
  if (lower.length) return THINKING_ORDER[lower[lower.length - 1]];
  const higher = indexes.find((index) => index > requestedIndex);
  return higher === undefined ? 'off' : THINKING_ORDER[higher];
}
