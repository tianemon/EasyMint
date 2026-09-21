export interface SessionOverrideInput {
  existingSession: boolean;
  modelOwned: boolean;
  thinkingOwned: boolean;
  model?: string;
  provider?: string;
  thinkingLevel?: string;
}

/** Only explicit per-session state may override values restored by Pi from the transcript. */
export function sessionOverrides(input: SessionOverrideInput): {
  model?: string;
  provider?: string;
  thinkingLevel?: string;
} {
  const useModel = !input.existingSession || input.modelOwned;
  const useThinking = !input.existingSession || input.thinkingOwned;
  return {
    model: useModel ? input.model : undefined,
    provider: useModel ? input.provider : undefined,
    thinkingLevel: useThinking ? input.thinkingLevel : undefined,
  };
}
