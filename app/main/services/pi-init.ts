/**
 * Pi SDK 环境初始化 — 全量使用 Pi 内置 provider。
 * API key 通过 setRuntimeApiKey 注入，模型、定价、API 格式全部来自 Pi。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtraModelCapability, ModelParams } from "../../shared/platform-presets";
import { Store } from "./store";
import { getProviderStaticModels } from "./pi-init-static";
import {
  getModelRuntimeClass,
  getSettingsManagerClass,
} from "./pi-sdk";
import type { Model } from "@earendil-works/pi-ai";

let _modelRuntime: Awaited<ReturnType<typeof getModelRuntimeClass>>["prototype"] | null = null;
let _activeModel: Model<any> | null = null;

export async function getModelRuntime(store: Store) {
  if (_modelRuntime) return _modelRuntime;
  // 手动添加模型先落盘(运行时 create 时读取),再构建——保证本次构建即包含
  syncExtraModelsFile(store);
  const MR = await getModelRuntimeClass();
  _modelRuntime = await MR.create({ allowModelNetwork: false });
  await syncProviders(store);
  return _modelRuntime;
}

/** 协议与定价层字段(api / baseUrl / compat / headers / cost):按该供应商官方模型继承——
 *  这不是「模型能力」推断,而是「怎么跟这个供应商说话」与定价兜底。
 *  能力参数(reasoning / input / thinkingLevelMap)一律取 extraModels 声明,不再按 id 反查推断。 */
function pickProtocolFields(spec: Record<string, any> | undefined): Record<string, unknown> {
  if (!spec) return {};
  const out: Record<string, unknown> = {};
  for (const k of ["api", "baseUrl", "compat", "cost", "headers"] as const) {
    if (spec[k] !== undefined) out[k] = spec[k];
  }
  return out;
}

/** models.json 里一个 provider 条目的形态(SDK ModelDefinition / ModelOverride 的子集) */
interface ProviderModelsJson {
  models?: Array<Record<string, any>>;
  modelOverrides?: Record<string, ModelParams>;
}

/**
 * 内置供应商手动添加的模型(extraModels)与官方模型参数覆盖(modelOverrides)同步到 agentDir/models.json。
 *
 * Pi runtime 的模型注册表来自 SDK 静态数据,手动添加的模型 ID(如新上线的
 * deepseek-v4-flash-vision-exp)不在其中 → runtime.getModel 查不到 →
 * 会话创建/热切都回落默认模型(实测"切了模型还是旧的"的根因之一)。
 *
 * models.json 是 Pi 原生的用户模型扩展层(默认路径 <agentDir>/models.json):
 *   - providers[<pid>].models[]          官方目录外的模型(SDK 同 id 整体替换)
 *   - providers[<pid>].modelOverrides{}  官方目录模型的参数覆盖(逐字段覆盖,最高优先级)
 * 组装时对同 provider 按 id upsert——新增 append、内置模型保留,运行时重建即生效。
 * 注意:对应 provider 的 models 字段由 EM 按 extraModels 全量重建(删除过的
 * extra 模型同步移除);用户手写的同 provider 条目会被覆盖——本文件归 EM 管理。
 */
function syncExtraModelsFile(store: Store): void {
  try {
    const providers = store.getSettings().apiProviders;
    if (!providers) return;
    const filePath = path.join(os.homedir(), ".easymint", "agent", "models.json");
    // 顶层结构固定为 { providers: { <providerId>: {...} } }——
    // 写成平铺(providers 缺失)会被 SDK 判为非法 schema 整份丢弃(踩过)
    let json: { providers: Record<string, ProviderModelsJson> } = { providers: {} };
    if (existsSync(filePath)) {
      try {
        const raw = JSON.parse(readFileSync(filePath, "utf-8"));
        if (raw && typeof raw === "object" && raw.providers && typeof raw.providers === "object") {
          json = raw;
        } else if (raw && typeof raw === "object") {
          // 旧/平铺格式 → 迁移到 providers 层级
          json = { providers: raw as Record<string, ProviderModelsJson> };
        }
      } catch { /* 坏档 → 按需重建 */ }
    }
    const providersJson = json.providers;
    let changed = false;
    // 按 presetId 聚合后只写一次：同一 presetId 可存在多份供应商配置（它们共用同一个 SDK
    // provider）。逐份写入时，后一份（extraModels 为空）会把前一份写好的 models 覆盖成
    // 空数组——而 models: [] 被 SDK 的 applyModelsJson 判为非法配置直接抛错，凭据同步
    // 随之失败（表现为「没有有效的 API Key」，改 key / 重建运行时都救不回来，重启后靠
    // 遍历顺序侥幸避开）。教训：2026-09-09 用户配置里同时存在 DeepSeek 与 DeepSeek22。
    type ExtraEntry = { id: string; alias?: string } & Record<string, any>;
    const byPreset = new Map<string, {
      extras: Map<string, ExtraEntry>;
      overrides: Map<string, ModelParams>;
      fallbackModel?: string;
    }>();
    for (const [, config] of Object.entries(providers.configs ?? {})) {
      if (!config.presetId || config.presetId === "custom") continue;
      const siblings = getProviderStaticModels(config.presetId);
      const bucket = byPreset.get(config.presetId)
        ?? { extras: new Map<string, ExtraEntry>(), overrides: new Map<string, ModelParams>() };
      // 别名映射：SDK 的 Model.id 是发给供应商的请求标识(alias ?? 名称)，Model.name 仅用于展示
      for (const e of config.extraModels ?? []) {
        const entry = (typeof e === "string" ? { id: e } : e) as ExtraEntry;
        const sdkId = entry?.alias || entry?.id;
        if (!sdkId) continue;
        // 已被 SDK 内置的 id 不再声明:models.json 的 models[] 按 id 整体替换内置条目,
        // 升级后 SDK 自带同名模型时我们的条目会遮蔽官方 spec。这类模型改由 modelOverrides
        // 管理(逐字段覆盖,未改字段仍跟随官方),以静态数据(SDK 内置模型表)为准。
        if (siblings.has(sdkId) || bucket.extras.has(sdkId)) continue;
        bucket.extras.set(sdkId, entry);
      }
      // 官方模型参数覆盖:只写非空条目(空对象 = 参数全跟随官方,写进去无意义)
      for (const [modelId, params] of Object.entries(config.modelOverrides ?? {})) {
        if (!params || !Object.values(params).some((v) => v !== undefined)) continue;
        if (!bucket.overrides.has(modelId)) bucket.overrides.set(modelId, params);
      }
      // 协议/定价层兜底基准:优先该配置的默认模型(命中内置时),否则用第一个内置模型
      if (!bucket.fallbackModel && config.model && siblings.has(config.model)) bucket.fallbackModel = config.model;
      byPreset.set(config.presetId, bucket);
    }
    for (const [presetId, bucket] of byPreset) {
      const existing = providersJson[presetId] ?? {};
      const siblings = getProviderStaticModels(presetId);
      const byId = new Map((existing.models ?? []).map((m) => [m.id as string, m]));
      // 协议/定价层兜底:该供应商的代表模型(默认模型命中官方时优先,否则首个内置模型)
      const sibling = (bucket.fallbackModel ? siblings.get(bucket.fallbackModel) : undefined) ?? [...siblings.values()][0];
      const protocol = pickProtocolFields(sibling);
      const models = [...bucket.extras.entries()].map(([sdkId, entry]) => {
        const { id: displayName, alias: _alias, ...declared } = entry;
        // 保留既有条目上的手写字段(如 samplingParams);窗口/输出只认声明值——
        // 取消近似匹配后不再反查官方同族模型,存量值已由启动迁移显式化
        const handWritten = byId.get(sdkId) ?? {};
        return {
          ...protocol,
          ...handWritten,
          ...declared,
          id: sdkId,
          name: displayName,
          contextWindow: declared.contextWindow ?? 200000,
          // 思考 token 计入 max_tokens 预算，4k 级默认会让思考未完成即截断（实测 stopReason: length）
          maxTokens: declared.maxTokens ?? 32768,
        };
      });
      const next: ProviderModelsJson = { ...existing };
      if (models.length > 0) next.models = models;
      else delete next.models;
      if (bucket.overrides.size > 0) next.modelOverrides = Object.fromEntries(bucket.overrides);
      else delete next.modelOverrides;
      if (Object.keys(next).length === 0) {
        // 无手动模型也无参数覆盖:整条移除,让 SDK 回落内置定义
        if (providersJson[presetId]) { delete providersJson[presetId]; changed = true; }
        continue;
      }
      if (JSON.stringify(existing) !== JSON.stringify(next)) {
        providersJson[presetId] = next;
        changed = true;
      }
    }
    if (changed) {
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(json, null, 2), "utf-8");
    }
  } catch (e) {
    console.warn("[pi-init] 同步手动添加模型到 models.json 失败:", (e as Error).message);
  }
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

/**
 * 取一个只用于读写「全局设置」的 SettingsManager。
 * 每次新建（不缓存）——会话里的 manager 也会写同一份全局文件，缓存实例会拿旧快照覆盖。
 * 注意：save() 只落盘 global 域，不会在项目目录产生 .pi 文件。
 */
export async function getGlobalSettingsManager() {
  const SM = await getSettingsManagerClass();
  return SM.create(os.homedir(), path.join(os.homedir(), ".easymint", "agent"));
}

/**
 * 把 SDK 内置模型合进各内置供应商的缓存模型列表(config.models)。
 *
 * 聊天页下拉用的是缓存列表,而它只在"打开供应商配置页并保存"时才刷新——
 * SDK 升级新增的模型(如 0.84.4 内置的 deepseek-v4-flash-vision-exp)不打开设置
 * 就永远不出现。启动时合并一次,新增模型自动可选;已有顺序与默认模型保持不变。
 * 返回是否有变更(有变更时调用方需要让 UI 重新读取设置)。
 */
export function syncNativeModels(store: Store): boolean {
  try {
    const settings = store.getSettings();
    const providers = settings.apiProviders;
    if (!providers?.configs) return false;
    let changed = false;
    for (const [, cfg] of Object.entries(providers.configs)) {
      if (!cfg.presetId || cfg.presetId === "custom") continue;
      const nativeIds = [...getProviderStaticModels(cfg.presetId).keys()];
      if (nativeIds.length === 0) continue;
      const cached = new Set(cfg.models ?? []);
      const added = nativeIds.filter((id) => !cached.has(id));
      if (added.length === 0) continue;
      cfg.models = [...(cfg.models ?? []), ...added];
      changed = true;
    }
    if (changed) store.saveSettings(settings);
    return changed;
  } catch (e) {
    console.warn("[pi-init] 同步内置模型列表失败:", (e as Error).message);
    return false;
  }
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
        // 模型声明(参数由用户显式指定,不再按 id 反查官方同族模型推断):
        // key = 别名 ?? 名称——SDK 的 Model.id 是发给供应商的请求标识,Model.name 仅用于展示。
        // 旧数据里 extraModels 可能是纯字符串 id(无参数声明),此时按保守默认值回落。
        type DeclaredModel = Partial<ExtraModelCapability> & { id: string };
        const declared: DeclaredModel[] = (config.extraModels ?? [])
          .map((e) => (typeof e === "string" ? { id: e } : e));
        const bySdkId = new Map<string, DeclaredModel>();
        for (const d of declared) {
          bySdkId.set(d.alias || d.id, d);
          bySdkId.set(d.id, d);
        }
        // 模型清单 = 缓存列表(config.models) ∪ 声明的请求 id(任一来源都能注册)
        const sdkIds = [...new Set([...(config.models ?? []), ...declared.map((d) => d.alias || d.id)])];
        _modelRuntime.registerProvider(config.id, {
          name: config.name,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          api: (config as any).apiType || "anthropic-messages",
          models: sdkIds.map((sdkId) => {
            const d = bySdkId.get(sdkId);
            return {
              id: sdkId,
              name: d?.id ?? sdkId,
              // 未声明时保守默认(与旧版行为一致:推理默认开、纯文本输入)
              reasoning: d?.reasoning ?? true,
              input: d?.input ?? ["text"],
              ...(d?.thinkingLevelMap ? { thinkingLevelMap: d.thinkingLevelMap } : {}),
              // 第三方网关的上游(DeepSeek/Kimi/GLM 官方 API)不认 OpenAI 的 developer
              // 角色,pi 默认按 OpenAI 官方发 developer → 网关 400 且被 SDK 当正常
              // 回合结束(前端表现为"发消息无响应")。system 角色 OpenAI 官方也接受
              compat: { supportsDeveloperRole: false },
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: d?.contextWindow ?? 200000,
              maxTokens: d?.maxTokens ?? 32768,
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
