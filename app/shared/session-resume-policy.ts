export interface SessionOverrideInput {
  existingSession: boolean;
  modelOwned: boolean;
  thinkingOwned: boolean;
  model?: string;
  thinkingLevel?: string;
}

/**
 * Only explicit per-session state may override values restored by Pi from the transcript.
 *
 * 这里只管模型名：供应商自 2026-10-29 起恒为全局当前供应商（切供应商对全部会话生效），
 * 会话不再携带自己的 provider。
 */
export function sessionOverrides(input: SessionOverrideInput): {
  model?: string;
  thinkingLevel?: string;
} {
  const useModel = !input.existingSession || input.modelOwned;
  const useThinking = !input.existingSession || input.thinkingOwned;
  return {
    model: useModel ? input.model : undefined,
    thinkingLevel: useThinking ? input.thinkingLevel : undefined,
  };
}
