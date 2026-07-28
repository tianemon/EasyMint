/**
 * Pi SDK 环境初始化
 *
 * 通过 pi-sdk.ts wrapper 懒加载 Pi SDK（ESM-only → CJS dynamic import）
 */

import { Store } from "./store";
import { PLATFORM_PRESETS } from "../../shared/platform-presets";
import type { PlatformPreset } from "../../shared/platform-presets";
import {
  getModelRuntimeClass,
  getSettingsManagerClass,
} from "./pi-sdk";
import type { Model } from "@earendil-works/pi-ai";

// ── 单例 ────────────────────────────────────────────

let _modelRuntime: Awaited<ReturnType<typeof getModelRuntimeClass>>["prototype"] | null = null;
let _settingsManager: Awaited<ReturnType<typeof getSettingsManagerClass>>["prototype"] | null = null;
let _activeModel: Model<any> | null = null;

/** 获取或懒初始化 ModelRuntime */
export async function getModelRuntime(store: Store) {
  if (_modelRuntime) return _modelRuntime;
  const MR = await getModelRuntimeClass();
  _modelRuntime = await createModelRuntime(store, MR);
  return _modelRuntime;
}

/** 获取或懒初始化 SettingsManager */
export async function getSettingsManager() {
  if (!_settingsManager) {
    const SM = await getSettingsManagerClass();
    _settingsManager = SM.inMemory({
      compaction: { enabled: true },
    });
  }
  return _settingsManager;
}

/** 清除缓存（provider 配置变更后调用） */
export function resetModelRuntime(): void {
  _modelRuntime = null;
  _activeModel = null;
}

/** 获取当前激活的 model */
export async function getActiveModel(store: Store) {
  if (_activeModel) return _activeModel;

  const settings = store.getSettings();
  const providers = settings.apiProviders;
  if (!providers?.current) return null;

  const config = providers.configs?.[providers.current];
  if (!config) return null;

  const runtime = await getModelRuntime(store);
  const providerName = makeProviderName(config.id);
  const model = runtime.getModel(providerName, strip1M(config.model));
  if (model) _activeModel = model;
  return model;
}

// ── 内部实现 ────────────────────────────────────────

function makeProviderName(configId: string): string {
  return `easymint-${configId}`;
}

function strip1M(model: string): string {
  return model.endsWith("[1M]") ? model.slice(0, -4) : model;
}

function inferApiType(preset: PlatformPreset): string {
  return preset.apiType || "anthropic-messages";
}

function getPresetBaseUrl(preset: PlatformPreset): string | undefined {
  return preset.env.ANTHROPIC_BASE_URL;
}

function getDefaultModelId(preset: PlatformPreset): string {
  return preset.env.ANTHROPIC_MODEL || preset.models[0] || "default";
}

interface ModelDefaults {
  contextWindow: number;
  maxTokens: number;
}

function resolveModelDefaults(_modelId: string, preset: PlatformPreset): ModelDefaults {
  if (preset.id === "deepseek") {
    return { contextWindow: 200000, maxTokens: 32000 };
  }
  if (preset.id === "anthropic") {
    return { contextWindow: 200000, maxTokens: 32000 };
  }
  return { contextWindow: 128000, maxTokens: 16000 };
}

async function createModelRuntime(
  store: Store,
  MR: Awaited<ReturnType<typeof getModelRuntimeClass>>,
) {
  const runtime = await MR.create({ allowModelNetwork: false });
  const settings = store.getSettings();
  const providers = settings.apiProviders;
  if (!providers) return runtime;

  for (const [configId, config] of Object.entries(providers.configs ?? {})) {
    const preset = PLATFORM_PRESETS.find((p) => p.id === config.presetId);
    if (!preset) continue;

    const providerName = makeProviderName(configId);
    const baseUrl = config.baseUrl || getPresetBaseUrl(preset);
    if (!baseUrl) continue;

    const modelId = strip1M(config.model || getDefaultModelId(preset));
    const api = inferApiType(preset);
    const defaults = resolveModelDefaults(modelId, preset);
    const is1M = config.context1M === true;
    const contextWindow = is1M ? 1_000_000 : defaults.contextWindow;

    runtime.registerProvider(providerName, {
      name: config.name || preset.name,
      apiKey: config.apiKey || "",
      api: api as any,
      baseUrl,
      models: [
        {
          id: modelId,
          name: modelId,
          reasoning: true,
          api: api as any,
          baseUrl,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow,
          maxTokens: defaults.maxTokens,
          input: ["text" as const, "image" as const],
          compat: { supportsDeveloperRole: false },
        },
      ],
    });
  }

  return runtime;
}
