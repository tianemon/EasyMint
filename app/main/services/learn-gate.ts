/**
 * learn 评估门槛判定（期3 触发控制的硬信号层）。
 *
 * 设计要点（用户反馈校准）：
 * - 单轮工具调用数是**下限信号**，只决定「够不够格被评估」，不决定「值不值得沉淀」——
 *   值得与否由模型在提示后按判定标准判断（见 agent-service 的 learn 评估指令）
 * - 双通道：踩坑修复（报错→修复）价值最高，门槛降低；纯大轮门槛高
 * - 信号口径为**单轮**（WB 标准；会话累计会过频）
 *
 * 独立成模块：无外部依赖，可单测。
 */

export interface LearnTurnSignal {
  /** 本轮（单轮）工具调用次数 */
  toolCallCount: number;
  /** 本轮是否出现过工具报错 */
  errorSeen: boolean;
  /** 报错之后是否出现过修复动作（write/edit/bash 类） */
  fixAfterError: boolean;
}

export type LearnGate = {
  /** fix = 踩坑修复通道（高价值，门槛低）；volume = 纯大轮通道 */
  channel: "fix" | "volume";
  threshold: number;
};

/** 踩坑修复通道门槛（有错误-修复对时的最低调用数） */
export const FIX_PAIR_THRESHOLD = 8;
/** 纯大轮通道门槛 */
export const VOLUME_THRESHOLD = 15;

/** 判定本轮是否达到「沉淀评估门槛」；未达门槛返回 null（不打扰模型） */
export function evaluateLearnGate(signal: LearnTurnSignal): LearnGate | null {
  const fixPair = signal.errorSeen && signal.fixAfterError;
  const threshold = fixPair ? FIX_PAIR_THRESHOLD : VOLUME_THRESHOLD;
  if (signal.toolCallCount < threshold) return null;
  return { channel: fixPair ? "fix" : "volume", threshold };
}

/** 修复类工具名（错误发生后出现这些工具 = 有修复动作） */
const FIX_TOOLS = new Set(["write", "edit", "multi_edit", "multiedit", "bash"]);

export function isFixTool(name: string): boolean {
  return FIX_TOOLS.has(name.toLowerCase());
}
