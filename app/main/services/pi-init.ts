/**
 * Pi SDK 环境初始化 — 全量使用 Pi 内置 provider。
 * API key 通过 setRuntimeApiKey 注入，模型、定价、API 格式全部来自 Pi。
 */

import { Store } from "./store";
import {
  getModelRuntimeClass,
  getSettingsManagerClass,
} from "./pi-sdk";
import type { Model } from "@earendil-works/pi-ai";

let _modelRuntime: Awaited<ReturnType<typeof getModelRuntimeClass>>["prototype"] | null = null;
let _settingsManager: Awaited<ReturnType<typeof getSettingsManagerClass>>["prototype"] | null = null;
let _activeModel: Model<any> | null = null;

export async function getModelRuntime(store: Store) {
  if (_modelRuntime) return _modelRuntime;
  const MR = await getModelRuntimeClass();
  _modelRuntime = await MR.create({ allowModelNetwork: false });
  await syncProviders(store);
  return _modelRuntime;
}

export async function getSettingsManager() {
  if (!_settingsManager) {
    const SM = await getSettingsManagerClass();
    _settingsManager = SM.inMemory({ compaction: { enabled: true } });
  }
  return _settingsManager;
}

export function resetModelRuntime(): void {
  _modelRuntime = null;
  _activeModel = null;
}

export async function getActiveModel(store: Store): Promise<Model<any> | null> {
  if (_activeModel) return _activeModel;
  const settings = store.getSettings();
  const providers = settings.apiProviders;
  if (!providers?.current) return null;
  const config = providers.configs?.[providers.current];
  if (!config) return null;
  const runtime = await getModelRuntime(store);
  const modelId = config.model?.replace(/\[1M\]$/, "") || "";
  const model = runtime.getModel(config.presetId, modelId);
  if (model) _activeModel = model as any;
  return (model ?? null) as Model<any> | null;
}

// Provider 和模型列表来自静态 JSON，不需要 runtime
let _staticData: Record<string, import("./pi-init-static").StaticProvider> | null = null;

async function loadStaticData() {
  if (_staticData) return _staticData;
  try {
    const { getPiProviders } = await import("./pi-init-static");
    _staticData = await getPiProviders();
  } catch (e) {
    console.error("[pi-init] loadStaticData failed:", e);
    _staticData = {};
  }
  return _staticData;
}

export async function getPiProviders(): Promise<Array<{ id: string; name: string; baseUrl?: string }>> {
  const data = await loadStaticData();
  return Object.entries(data).map(([id, info]) => ({
    id, name: info.name, baseUrl: info.baseUrl,
  }));
}

export async function getPiModels(providerId: string): Promise<readonly { id: string; name: string; contextWindow: number }[]> {
  const data = await loadStaticData();
  return data[providerId]?.models || [];
}

async function syncProviders(store: Store) {
  if (!_modelRuntime) return;
  const settings = store.getSettings();
  const providers = settings.apiProviders;
  if (!providers) return;
  for (const [, config] of Object.entries(providers.configs ?? {})) {
    if (config.apiKey) {
      await _modelRuntime.setRuntimeApiKey(config.presetId, config.apiKey);
    }
  }
}
