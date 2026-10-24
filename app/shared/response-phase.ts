export type ResponsePhase = "commentary" | "final_answer";

/** Pi stores the provider's response phase inside its versioned text signature. */
export function responsePhase(signature: unknown): ResponsePhase | undefined {
  if (typeof signature !== "string" || !signature.startsWith("{")) return undefined;
  try {
    const value = JSON.parse(signature);
    return value?.v === 1 && (value.phase === "commentary" || value.phase === "final_answer") ? value.phase : undefined;
  } catch { return undefined; }
}
