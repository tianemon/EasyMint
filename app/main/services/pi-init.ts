/**
 * Pi SDK 环境初始化 — 全量使用 Pi 内置 provider。
 * API key 通过 setRuntimeApiKey 注入，模型、定价、API 格式全部来自 Pi。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "./store";
import { getModelSpecLookup, getProviderStaticModels, getStaticModelSpec } from "./pi-init-static";
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

/**
 * 内置供应商手动添加的模型(extraModels)同步到 agentDir/models.json。
 *
 * Pi runtime 的模型注册表来自 SDK 静态数据,手动添加的模型 ID(如新上线的
 * deepseek-v4-flash-vision-exp)不在其中 → runtime.getModel 查不到 →
 * 会话创建/热切都回落默认模型(实测"切了模型还是旧的"的根因之一)。
 *
 * models.json 是 Pi 原生的用户模型扩展层(默认路径 <agentDir>/models.json):
 * 组装时对同 provider 按 id upsert——新增 append、内置模型保留,运行时重建即生效。
 * 注意:对应 provider 的 models 字段由 EM 按 extraModels 全量重建(删除过的
 * extra 模型同步移除);用户手写的同 provider 条目会被覆盖——本文件归 EM 管理。
 */
/** 模型内在能力(与协议无关,可跨供应商继承):reasoning / input / thinkingLevelMap */
function pickModelCapability(spec: Record<string, any> | undefined): Record<string, unknown> {
  if (!spec) return {};
  const out: Record<string, unknown> = {};
  for (const k of ["reasoning", "input", "thinkingLevelMap"] as const) {
    if (spec[k] !== undefined) out[k] = spec[k];
  }
  return out;
}

/** 从内置 spec 中挑出「能力声明」字段(不含 id/name/窗口——这些按用户填写的值走) */
function pickCapabilityFields(spec: Record<string, any> | undefined): Record<string, unknown> {
  if (!spec) return {};
  const out: Record<string, unknown> = {};
  for (const k of ["api", "baseUrl", "compat", "cost", "headers"] as const) {
    if (spec[k] !== undefined) out[k] = spec[k];
  }
  return { ...out, ...pickModelCapability(spec) };
}

function syncExtraModelsFile(store: Store): void {
  try {
    const providers = store.getSettings().apiProviders;
    if (!providers) return;
    interface ModelEntry { id: string; contextWindow?: number; maxTokens?: number; input?: string[] }
    const filePath = path.join(os.homedir(), ".easymint", "agent", "models.json");
    // 顶层结构固定为 { providers: { <providerId>: { models: [...] } } }——
    // 写成平铺(providers 缺失)会被 SDK 判为非法 schema 整份丢弃(踩过)
    let json: { providers: Record<string, { models?: ModelEntry[] } & Record<string, unknown>> } = { providers: {} };
    if (existsSync(filePath)) {
      try {
        const raw = JSON.parse(readFileSync(filePath, "utf-8"));
        if (raw && typeof raw === "object" && raw.providers && typeof raw.providers === "object") {
          json = raw;
        } else if (raw && typeof raw === "object") {
          // 旧/平铺格式 → 迁移到 providers 层级
          json = { providers: raw as Record<string, { models?: ModelEntry[] }> };
        }
      } catch { /* 坏档 → 按需重建 */ }
    }
    const providersJson = json.providers;
    const lookup = getModelSpecLookup();
    let changed = false;
    for (const [, config] of Object.entries(providers.configs ?? {})) {
      if (!config.presetId || config.presetId === "custom") continue;
      // 已被 SDK 内置的 id 不再声明:models.json 是最高优先级的用户层(applyModelsJson
      // 按 id 覆盖内置条目),升级后 SDK 自带同名模型时,我们的继承条目会遮蔽官方 spec。
      // 以静态数据(SDK 内置模型表)为准——升级后自动让位,无需用户清理 extraModels。
      const siblings = getProviderStaticModels(config.presetId);
      const extras = (config.extraModels ?? []).filter((id) => !siblings.has(id));
      const existing = providersJson[config.presetId]?.models ?? [];
      // extras 为空且此前也没写过 → 跳过(保留用户手写内容)
      if (extras.length === 0 && existing.length === 0) continue;
      const byId = new Map(existing.map((m) => [m.id, m]));
      // 同族能力兜底:优先同名 spec → 该供应商默认模型 → 第一个内置模型。
      // 继承 api / reasoning / thinkingLevelMap / compat / cost——models.json 未写的字段
      // 由 SDK 按"供应商首个模型"兜底(实测继承到 reasoning=false、无 thinkingLevelMap,
      // 思考等级被 clamp 成 off),手动添加的模型必须显式继承才保住能力声明。
      const sibling = siblings.get(config.model ?? "") ?? [...siblings.values()][0];
      const models: ModelEntry[] = extras.map((id) => {
        const spec = lookup.get(id);
        const inherited = pickCapabilityFields(siblings.get(id) ?? sibling);
        // 保留既有条目上的手写字段(如 input 视觉声明、reasoning 微调);
        // id 含视觉关键词时显式补 input: ["text","image"](否则视觉模型被当纯文本)
        const handWritten = byId.get(id) ?? {};
        const vision = /vision|vl[-_]|omni/i.test(id) ? { input: ["text", "image"] } : {};
        return {
          ...inherited,
          ...vision,
          ...handWritten,
          id,
          contextWindow: spec?.contextWindow ?? 200000,
          maxTokens: spec?.maxTokens ?? 4096,
        };
      });
      const entry = { ...providersJson[config.presetId], models };
      if (JSON.stringify(providersJson[config.presetId]) !== JSON.stringify(entry)) {
        providersJson[config.presetId] = entry;
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
            // 同一模型 id 在官方数据里可查(第三方网关/镜像站转售常见)→ 继承其内在能力。
            // 不继承会退化成"只支持到 high、不支持读图",与内置供应商行为不一致
            // (实测:自定义供应商设全局"最高"会被静默压成"高")。
            // api / baseUrl / compat 属协议层,跟随用户配置,不继承。
            const inherited = pickModelCapability(getStaticModelSpec(id));
            return {
              id, name: id, reasoning: true, input: ["text"],
              ...inherited,
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
