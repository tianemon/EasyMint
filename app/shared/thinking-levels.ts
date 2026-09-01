/**
 * 思考等级：大小关系与自适应判定（主进程与渲染层共用唯一真相源）
 *
 * 主进程用它把期望等级落到会话生效等级，渲染层用它把界面选中值落到模型支持的档位——
 * 两处必须一致，否则会出现「下拉显示英文原名」这类选中值不在选项里的问题。
 */

/** 档位顺序（关闭 < 极低 < 轻度 < 中 < 高 < 极高 < 最高） */
export const THINKING_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ThinkingLevelValue = (typeof THINKING_ORDER)[number];

/** 档位中文名（界面展示用） */
export const THINKING_LABELS: Record<string, string> = {
  off: "关闭",
  minimal: "极低",
  low: "轻度",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
};

/**
 * 把期望等级落到模型实际支持的档位（用户拍板：向下优先，保守取用）：
 *   1. 同等级：模型支持该档 → 直接用（选关闭→关闭，选最高→最高）
 *   2. 向下找：无同等级 → 低于它的可用档中「最高」的一档（最接近）；
 *      所选不是关闭时，关闭不作为候选（选了思考档 ≠ 想关闭思考，除非模型只剩关闭）
 *   3. 向上找：下面没有 → 高于它的可用档中「最低」的一档（最接近）
 *   4. 兜底：都没有 → 关闭
 *
 * 例：模型支持 [关闭/轻度/高/最高]（deepseek-v4-flash），选「中」→「轻度」；
 *     模型只支持 [极高/最高]，选「极低」→「极高」。
 * available 为空（模型能力未知）时原样返回。
 */
export function resolveThinkingLevel(requested: string, available: string[] | null | undefined): string {
  if (!available || available.length === 0) return requested;
  if (available.includes(requested)) return requested;   // 1. 同等级
  const req = THINKING_ORDER.indexOf(requested as ThinkingLevelValue);
  if (req === -1) return requested;
  const idx = available
    .map((l) => THINKING_ORDER.indexOf(l as ThinkingLevelValue))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  if (idx.length === 0) return "off";
  // 2. 向下找：低于所选、且（选非 off 时）非 off 的可用档中最高的一档
  const down = idx.filter((i) => i < req && (requested === "off" || i > 0));
  if (down.length > 0) return THINKING_ORDER[down[down.length - 1]!]!;
  // 3. 向上找：高于所选、最低的一档
  const up = idx.filter((i) => i > req);
  if (up.length > 0) return THINKING_ORDER[up[0]!]!;
  // 4. 兜底（模型只剩关闭而所选非关闭）
  return "off";
}
