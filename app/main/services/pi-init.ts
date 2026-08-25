/**
 * Pi SDK 环境初始化 — 全量使用 Pi 内置 provider。
 * API key 通过 setRuntimeApiKey 注入，模型、定价、API 格式全部来自 Pi。
 */

import { Store } from "./store";
import { getModelSpecLookup } from "./pi-init-static";
import {
  getModelRuntimeClass,
  getSettingsManagerClass,
} from "./pi-sdk";
import type { Model } from "@earendil-works/pi-ai";

let _modelRuntime: Awaited<ReturnType<typeof getModelRuntimeClass>>["prototype"] | null = null;
let _activeModel: Model<any> | null = null;

export async function getModelRuntime(store: Store) {
  if (_modelRuntime) return _modelRuntime;
  const MR = await getModelRuntimeClass();
  _modelRuntime = await MR.create({ allowModelNetwork: false });
  await syncProviders(store);
  return _modelRuntime;
}

/**
 * 磁盘模式 SettingsManager（保持 Pi SDK 默认行为）。
 * 每会话创建（无单例）：绑定 cwd（项目设置路径 <cwd>/.pi/settings.json）+ agentDir（全局 agentDir/settings.json），
 * 多项目场景不可复用单例。
 * httpIdleTimeoutMs 保持 SDK 默认（5 分钟）——超时中断由会话状态自愈兜底（见 sendMessage/steer），不在此禁用。
 * 压缩双轨：EM 弹窗（60-80% 阈值）主导 + SDK 自动压缩兜底（触发点调高到 ~98% 极端情况）——
 * 用 applyOverrides 内存级覆盖（不落盘），SDK 只在接近满时兜底，杜绝 error 估算虚高误触发。
 */
export async function getSettingsManager(cwd: string, agentDir: string) {
  const SM = await getSettingsManagerClass();
  const mgr = await SM.create(cwd, agentDir);
  // SDK 自动压缩保留但触发点调高（reserveTokens 默认 16384→4096，触发点 ≈ 窗口-4k ≈ 98%）：
  // EM 弹窗（60-80%）先主导，SDK 仅极端兜底——error 估算虚高也够不到 98%，不会误触发
  mgr.applyOverrides({ compaction: { enabled: true, reserveTokens: 4096 } });
  return mgr;
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

  // 当前激活供应商的默认模型。模型不可用时直接返回 null,由 SDK/上层按默认行为处理(重试/报错)。
  // 自定义供应商(presetId="custom")的 provider 注册 id = config.id(非 "custom")。
  const activeProvider = activeCfg.presetId === "custom" ? providers.current : activeCfg.presetId;
  if (!activeCfg.model) return null;
  const model = runtime.getModel(activeProvider, activeCfg.model);
  if (!model) return null;
  // 该 provider 未配置凭据(无 API key)→ 返回 null
  const auth = runtime.getProviderAuthStatus(activeProvider);
  if (auth && !auth.configured) return null;
  _activeModel = model as any;
  return model as any;
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
        // contextWindow/maxTokens 从 SDK 全量 provider 数据查表(命中真实值)——
        // 硬编码 200k 会导致 1M 窗口模型(kimi-k3/deepseek-v4-flash 等)过早触发压缩
        const lookup = getModelSpecLookup();
        _modelRuntime.registerProvider(config.id, {
          name: config.name,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          api: (config as any).apiType || "anthropic-messages",
          models: (config.models || []).map((m: string) => {
            const id = typeof m === "string" ? m : (m as any).id || String(m);
            const spec = lookup.get(id);
            return {
              id, name: id, reasoning: true, input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: spec?.contextWindow ?? 200000,
              maxTokens: spec?.maxTokens ?? 4096,
            };
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
