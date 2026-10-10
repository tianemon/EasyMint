export interface ModelReference { provider: string; model: string }
export interface NativeAiSettings {
  imageModel?: ModelReference;
  autoRouting?: { planning: ModelReference; execution: ModelReference };
}

export const AUTO_MODEL_ID = "easymint-auto";

export function parseNativeAiSettings(value: unknown): NativeAiSettings {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid native AI settings");
  const ref = (input: unknown): ModelReference => {
    const v = input as Partial<ModelReference> | undefined;
    if (!v || typeof v.provider !== "string" || !v.provider.trim() || typeof v.model !== "string" || !v.model.trim()) {
      throw new Error("Select a provider and model");
    }
    if (v.model === AUTO_MODEL_ID) throw new Error("Select a physical model");
    return { provider: v.provider, model: v.model };
  };
  const v = value as { imageModel?: unknown; autoRouting?: { planning?: unknown; execution?: unknown } };
  return {
    ...(v.imageModel ? { imageModel: ref(v.imageModel) } : {}),
    ...(v.autoRouting ? { autoRouting: { planning: ref(v.autoRouting.planning), execution: ref(v.autoRouting.execution) } } : {}),
  };
}
