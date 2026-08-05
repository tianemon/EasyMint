/**
 * Pi SDK 环境初始化 — 全量使用 Pi 内置 provider。
 * API key 通过 setRuntimeApiKey 注入，模型、定价、API 格式全部来自 Pi。
 */

import { Store } from "./store";
import { broadcast } from "./ipc-broadcast";
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
  const activeCfg = providers.configs?.[providers.current];
  if (!activeCfg?.presetId) return null;
  const runtime = await getModelRuntime(store);

  // 候选模型列表(按优先级:当前激活供应商的 模型(默认) → 兜底模型)。
  // 默认/兜底由每条供应商配置自己的 model/fallbackModel 定义(需求 1)。
  // 自定义供应商(presetId="custom")的 provider 注册 id = config.id(非 "custom")。
  const activeProvider = activeCfg.presetId === "custom" ? providers.current : activeCfg.presetId;
  const candidates: Array<{ provider: string; modelId: string }> = [];
  if (activeCfg.model) {
    candidates.push({ provider: activeProvider, modelId: activeCfg.model.replace(/\[1M\]$/, "") });
  }
  if (activeCfg.fallbackModel) {
    candidates.push({ provider: activeProvider, modelId: activeCfg.fallbackModel.replace(/\[1M\]$/, "") });
  }

  for (const c of candidates) {
    const model = runtime.getModel(c.provider, c.modelId);
    if (!model) continue;
    // 该 provider 未配置凭据(无 API key)→ 跳过,尝试兜底
    const auth = runtime.getProviderAuthStatus(c.provider);
    if (auth && !auth.configured) continue;
    if (c !== candidates[0]) {
      console.log(`[pi-init] 使用兜底模型: ${c.provider}/${c.modelId}`);
      // 前端状态栏提示(需求 1:兜底触发时告知用户,8s 自动消失)
      broadcast("agent:fallback-used", { provider: c.provider, modelId: c.modelId });
    }
    _activeModel = model as any;
    return model as any;
  }
  return null;
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
    // 内置 provider 只需 setRuntimeApiKey
    if (config.presetId && config.presetId !== "custom" && config.apiKey) {
      await _modelRuntime.setRuntimeApiKey(config.presetId, config.apiKey);
    }
    // 用户自定义 provider:调 registerProvider 动态注册
    if (config.presetId === "custom" && config.apiKey && config.baseUrl) {
      try {
        // 用户配置的模型列表(em-settings 中的 models 字段)
        _modelRuntime.registerProvider(config.id, {
          name: config.name,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          api: (config as any).apiType || "anthropic-messages",
          models: (config.models || []).map((m: string) => {
            const id = typeof m === "string" ? m : (m as any).id || String(m);
            return { id, name: id, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 4096 };
          }),
        } as any);
        if (config.apiKey) {
          await _modelRuntime.setRuntimeApiKey(config.id, config.apiKey);
        }
      } catch (e) {
        console.warn(`[pi-init] 自定义 provider ${config.id} 注册失败:`, (e as Error).message);
      }
    }
  }
}
