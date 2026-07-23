/**
 * Pi SDK 环境初始化
 *
 * 职责：
 * 1. 创建 ModelRuntime 单例（注册 API provider）
 * 2. 创建 SettingsManager 单例（含 compaction 配置）
 * 3. 从 em-settings.json 读取 API 配置并注册到 Pi
 *
 * 参考：Proma pi-model-registry.ts buildModel()
 */

import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { Api } from "@earendil-works/pi-ai";
import { Store } from "./store";
import { PLATFORM_PRESETS } from "../../shared/platform-presets";
import type { PlatformPreset } from "../../shared/platform-presets";

// ── 单例 ────────────────────────────────────────────

let _modelRuntime: ModelRuntime | null = null;
let _settingsManager: SettingsManager | null = null;

/** 获取或懒初始化 ModelRuntime */
export async function getModelRuntime(store: Store): Promise<ModelRuntime> {
  if (_modelRuntime) return _modelRuntime;
  _modelRuntime = await createModelRuntime(store);
  return _modelRuntime;
}

/** 获取或懒初始化 SettingsManager */
export function getSettingsManager(): SettingsManager {
  if (!_settingsManager) {
    _settingsManager = SettingsManager.inMemory({
      compaction: { enabled: true },
    });
  }
  return _settingsManager;
}

/** 清除缓存（provider 配置变更后调用） */
export function resetModelRuntime(): void {
  _modelRuntime = null;
}

/** 获取当前激活的 model（provider 变更后需先 reset + 重建） */
export async function getActiveModel(store: Store) {
  const settings = store.getSettings();
  const providers = settings.apiProviders;
  if (!providers?.current) return null;

  const config = providers.configs?.[providers.current];
  if (!config) return null;

  const runtime = await getModelRuntime(store);
  const providerName = makeProviderName(config.id);
  return runtime.getModel(providerName, strip1M(config.model));
}

// ── 内部实现 ────────────────────────────────────────

function makeProviderName(configId: string): string {
  return `easymint-${configId}`;
}

function strip1M(model: string): string {
  return model.endsWith("[1M]") ? model.slice(0, -4) : model;
}

type PiApiType = "anthropic-messages" | "openai-completions" | "openai-responses" | "google-generative-ai";

/** 根据 Anhropic-compatible base URL 推断 Pi Api 类型 */
function inferApiType(baseUrl: string | undefined): PiApiType {
  if (!baseUrl) return "anthropic-messages";
  // 所有 EM 预设都使用 Anthropic Messages 兼容 API
  return "anthropic-messages";
}

/** 获取预设的默认模型 ID */
function getDefaultModelId(preset: PlatformPreset): string {
  return preset.env.ANTHROPIC_MODEL || preset.models[0] || "default";
}

/** 获取预设的默认 base URL */
function getPresetBaseUrl(preset: PlatformPreset): string | undefined {
  return preset.env.ANTHROPIC_BASE_URL;
}

interface ModelDefaults {
  contextWindow: number;
  maxTokens: number;
}

function resolveModelDefaults(_modelId: string, preset: PlatformPreset): ModelDefaults {
  // EM 预设不含 cost/contextWindow 信息，使用安全默认值
  // DeepSeek V4: 200K context, 32K maxTokens
  if (preset.id === "deepseek") {
    return { contextWindow: 200000, maxTokens: 32000 };
  }
  // Kimi, MiniMax, Moonshot 等国内平台普遍 128K+
  return { contextWindow: 128000, maxTokens: 16000 };
}

async function createModelRuntime(store: Store): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({ allowModelNetwork: false });
  const settings = store.getSettings();
  const providers = settings.apiProviders;
  if (!providers) return runtime;

  // 注册所有已配置的供应商
  for (const [configId, config] of Object.entries(providers.configs ?? {})) {
    const preset = PLATFORM_PRESETS.find((p) => p.id === config.presetId);
    if (!preset) continue;

    const providerName = makeProviderName(configId);
    const baseUrl = config.baseUrl || getPresetBaseUrl(preset);
    if (!baseUrl) continue;

    const modelId = strip1M(config.model || getDefaultModelId(preset));
    const api: Api = inferApiType(baseUrl) as Api;
    const defaults = resolveModelDefaults(modelId, preset);

    runtime.registerProvider(providerName, {
      name: config.name || preset.name,
      apiKey: config.apiKey || "",
      api,
      baseUrl,
      models: [
        {
          id: modelId,
          name: modelId,
          reasoning: true, // 默认支持 reasoning
          api,
          baseUrl,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: defaults.contextWindow,
          maxTokens: defaults.maxTokens,
          input: ["text" as const, "image" as const],
          // 非 Anthropic 原生 API 通常不支持 developer role
          compat: { supportsDeveloperRole: false },
        },
      ],
    });
  }

  return runtime;
}
