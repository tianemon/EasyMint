/**
 * Pi SDK 环境初始化 — 全量使用 Pi 内置 provider。
 * API key 通过 setRuntimeApiKey 注入，模型、定价、API 格式全部来自 Pi。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeExtraModels } from "../../shared/platform-presets";
import type { NormalizedExtraModel } from "../../shared/platform-presets";
import type { ModelParams } from "../../shared/platform-presets";
import { THINKING_ORDER } from "../../shared/thinking-levels";
import { Store } from "./store";
import { getProviderStaticModels } from "./pi-init-static";
import {
  getModelRuntimeClass,
  getSettingsManagerClass,
} from "./pi-sdk";
import type { Model } from "@earendil-works/pi-ai";

type ModelRuntimeInstance = Awaited<ReturnType<typeof getModelRuntimeClass>>["prototype"];

let _modelRuntime: ModelRuntimeInstance | null = null;
/** 进行中的构建。并发调用共用同一次构建,reset 时一并作废(见 resetModelRuntime) */
let _runtimePromise: Promise<ModelRuntimeInstance> | null = null;
let _activeModel: Model<any> | null = null;

export async function getModelRuntime(store: Store) {
  if (_modelRuntime) return _modelRuntime;
  // in-flight 去重:构建是异步的(create + syncProviders 全量组合,阻塞主进程事件循环),
  // 只判 _modelRuntime 会让并发调用各建一次。设置页会为每个模型各发一次请求(每次都走到这里),
  // 保存供应商又会 resetModelRuntime(),两者叠加即命中。
  if (_runtimePromise) return _runtimePromise;
  const promise = (async () => {
    // 手动添加模型先落盘(运行时 create 时读取),再构建——保证本次构建即包含
    syncExtraModelsFile(store);
    const MR = await getModelRuntimeClass();
    const rt = await MR.create({ allowModelNetwork: false });
    await syncProviders(store, rt);
    // models.json 被 SDK 判非法时整份丢弃(所有模型参数静默失效),错误只挂在实例上、EM 无人读
    const configError = rt.getError();
    if (configError) console.warn("[pi-init] 模型运行时报告配置错误:\n" + configError);
    return rt;
  })();
  _runtimePromise = promise;
  try {
    const rt = await promise;
    // 构建期间若发生 reset(保存供应商配置),本次结果基于保存前的配置 → 丢弃不写回;
    // 缓存由 reset 之后的调用方负责(那时 _runtimePromise 已被替换成新的 promise)
    if (_runtimePromise === promise) _modelRuntime = rt;
    return rt;
  } catch (e) {
    // 构建失败:清掉 in-flight 缓存允许下次重试,错误照原语义向上抛
    if (_runtimePromise === promise) _runtimePromise = null;
    throw e;
  }
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

/** EM 会写入 models.json 的模型参数字段(ModelParams 的键) */
const MODEL_PARAM_KEYS = ["contextWindow", "maxTokens", "reasoning", "input", "thinkingLevelMap"] as const;

function isPositiveNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * 过滤一条模型参数声明，只保留类型合法的字段。
 *
 * 为什么必须过滤:SDK 的 ModelConfig.load 对**整份** models.json 做 schema 校验，任一字段
 * 类型非法就丢弃整份文件——所有供应商的 models[] / modelOverrides 一起静默失效，EM 侧只
 * 表现为「参数改了不生效」。写入本应只来自 EM 自身(类型安全)，但手改 em-settings / 存量
 * 数据可能带坏值；坏值丢弃并告警(带模型 id)，影响范围限制在单个字段。
 * 未知字段不进结果(调用方只取本函数返回值写覆盖层，models[] 条目保留自己的其他字段)。
 */
function sanitizeModelParams(raw: unknown, label: string): ModelParams {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: ModelParams = {};
  const warn = (field: string, value: unknown) =>
    console.warn(`[pi-init] models.json: ${label} 的 ${field} 值非法(${JSON.stringify(value) ?? String(value)})，已丢弃该字段`);
  if (src.contextWindow !== undefined) {
    if (isPositiveNumber(src.contextWindow)) out.contextWindow = src.contextWindow;
    else warn("contextWindow", src.contextWindow);
  }
  if (src.maxTokens !== undefined) {
    if (isPositiveNumber(src.maxTokens)) out.maxTokens = src.maxTokens;
    else warn("maxTokens", src.maxTokens);
  }
  if (src.reasoning !== undefined) {
    if (typeof src.reasoning === "boolean") out.reasoning = src.reasoning;
    else warn("reasoning", src.reasoning);
  }
  if (src.input !== undefined) {
    const input = src.input;
    // 合法组合:非空数组且元素均为 "text" / "image"(SDK schema 同样只认这两个字面量)
    if (Array.isArray(input) && input.length > 0 && input.every((v) => v === "text" || v === "image")) {
      out.input = input as ModelParams["input"];
    } else warn("input", input);
  }
  if (src.thinkingLevelMap !== undefined) {
    const map = src.thinkingLevelMap;
    if (map && typeof map === "object" && !Array.isArray(map)) {
      const clean: Record<string, string | null> = {};
      let dropped = false;
      for (const [level, v] of Object.entries(map as Record<string, unknown>)) {
        if (v === undefined) continue;
        // 档位名与值都要合法:未知档位名同样会被 SDK schema 拒绝(additionalProperties: false)
        if (!(THINKING_ORDER as readonly string[]).includes(level) || (v !== null && typeof v !== "string")) {
          dropped = true;
          continue;
        }
        clean[level] = v as string | null;
      }
      if (dropped) warn("thinkingLevelMap", map);
      if (Object.keys(clean).length > 0) out.thinkingLevelMap = clean as ModelParams["thinkingLevelMap"];
    } else warn("thinkingLevelMap", map);
  }
  return out;
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
    // 同一 presetId 可能有多份配置(如 DeepSeek 与 DeepSeek22 测试配置),它们共用同一个 SDK
    // provider。聚合口径:激活配置(providers.current 指向的那份)优先——它的 modelOverrides /
    // extraModels / 默认模型先入桶,其余配置仅在未声明时补入。否则「先遍历到者胜」会让编辑
    // 非激活配置的参数看似保存成功却不生效(编辑激活配置也可能被非激活配置盖住)。
    const activeId = providers.current;
    const configs = Object.entries(providers.configs ?? {})
      .sort(([a], [b]) => (a === activeId ? -1 : b === activeId ? 1 : 0));
    for (const [, config] of configs) {
      if (!config.presetId || config.presetId === "custom") continue;
      const siblings = getProviderStaticModels(config.presetId);
      const bucket = byPreset.get(config.presetId)
        ?? { extras: new Map<string, ExtraEntry>(), overrides: new Map<string, ModelParams>() };
      // 官方模型参数覆盖:只写非空条目(空对象 = 参数全跟随官方,写进去无意义)。
      // 官方目录里已有的模型一律以 SDK 为准(用户口径 2026-09-09):EM 不再写出覆盖,
      // 存量覆盖也随之失效——官方模型在界面上本就不可编辑,SDK 升级后跟随官方值才是对的。
      for (const [modelId, params] of Object.entries(config.modelOverrides ?? {})) {
        if (!params || !Object.values(params).some((v) => v !== undefined)) continue;
        if (siblings.has(modelId)) continue;
        if (!bucket.overrides.has(modelId)) bucket.overrides.set(modelId, params);
      }
      // 请求标识 = id，显示名 = name（与 SDK Model 一一对应，无别名）
      for (const n of normalizeExtraModels(config.extraModels)) {
        if (bucket.extras.has(n.id)) continue;
        // 已收录进官方目录的请求标识:以官方定义为准——models[] 同 id 会整体遮蔽官方 spec,
        // 改道写覆盖层又会让 SDK 升级后的官方值失效。改官方参数应等 SDK 更新。
        if (siblings.has(n.id)) {
          console.warn(`[pi-init] 模型 ${n.id} 已在官方目录中，以官方参数为准（手动声明不生效）`);
          continue;
        }
        // 写入规范化后的条目:id/name 用归一化结果(旧形态的 alias 已折算进 id、原 id 成为 name),
        // 并剔除 alias 字段——否则旧条目没有 name,显示名会回落成请求标识
        const canonical: Record<string, unknown> = n.entry ? { ...n.entry } : {};
        delete canonical.alias;
        bucket.extras.set(n.id, { ...canonical, id: n.id, name: n.name });
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
        const { id: _id, name: displayName, ...declared } = entry;
        // 保留既有条目上的手写字段(如 samplingParams);窗口/输出只认声明值——
        // 取消近似匹配后不再反查官方同族模型,存量值已由启动迁移显式化
        const handWritten = byId.get(sdkId) ?? {};
        const model: Record<string, unknown> = {
          ...protocol,
          ...handWritten,
          ...declared,
          id: sdkId,
          name: displayName ?? sdkId,
        };
        // 参数字段统一过一遍防御性过滤:坏值会让整份 models.json 被 SDK 丢弃(见 sanitizeModelParams)
        const params = sanitizeModelParams(model, `手动模型 ${sdkId}`);
        for (const k of MODEL_PARAM_KEYS) delete model[k];
        model.contextWindow = params.contextWindow ?? 200000;
        // 思考 token 计入 max_tokens 预算，4k 级默认会让思考未完成即截断（实测 stopReason: length）
        model.maxTokens = params.maxTokens ?? 32768;
        if (params.reasoning !== undefined) model.reasoning = params.reasoning;
        if (params.input) model.input = params.input;
        if (params.thinkingLevelMap) model.thinkingLevelMap = params.thinkingLevelMap;
        return model;
      });
      const next: ProviderModelsJson = { ...existing };
      if (models.length > 0) next.models = models;
      else delete next.models;
      // 覆盖层逐条过滤:坏值或全部字段非法时丢弃该条(空对象无意义,不写)
      const overrides: Record<string, ModelParams> = {};
      for (const [modelId, params] of bucket.overrides) {
        const clean = sanitizeModelParams(params, `模型 ${modelId} 的参数覆盖`);
        if (Object.keys(clean).length > 0) overrides[modelId] = clean;
      }
      if (Object.keys(overrides).length > 0) next.modelOverrides = overrides;
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
      for (const [pid, entry] of Object.entries(providersJson)) {
        const list = (entry.models ?? []) as Array<Record<string, unknown>>;
        if (list.length > 0) {
          console.log(`[pi-init] models.json 已写入 ${pid}: ${list.map((m) => `${m.id}=${m.contextWindow}`).join(", ")}`);
        }
      }
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
  // 同时作废进行中的构建:它基于保存前的配置,完成后不能写回缓存(见 getModelRuntime)
  _runtimePromise = null;
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
 * 把内置供应商的「模型清单」与 SDK 目录对齐——**以 SDK 目录为准**。做两件事：
 *
 *   A. `config.models`（缓存列表）增删对齐。聊天页下拉 / 会话页模型选择都读它，而它过去只在
 *      「打开供应商配置页并保存」时才重建（renderer 侧 ProviderSettings.handleSave）。只靠那条
 *      手动路径有两个后果：SDK 升级**新增**的模型不打开设置就永远不出现（本函数最初只做并集
 *      追加就是为了这个）；SDK 升级**移除 / 改名**的模型会永久留在列表里，选中它静默回落默认
 *      模型（0.86.0 把 deepseek-v4-flash 改名 deepseek-flash、移除 Codex 的 gpt-5.4 即属此类）。
 *      对齐后**集合**与「手动保存一次」一致（`SDK 目录 ∪ extraModels 中不在目录的请求标识`，
 *      同口径见 ProviderSettings.handleSave）；**顺序**取最小扰动——保留现有顺序、只剔失效项、
 *      新模型追加尾部（启动期重排用户可见的下拉顺序属越权，且 models[0] 是默认模型兜底值）。
 *
 *   B. `extraModels` 中「请求标识已在官方目录」的条目清理。这类条目**不产生任何效果**
 *      （syncExtraModelsFile 遇同 id 跳过写入 models[]，modelOverrides 同样跳过），却会让界面
 *      显示手填的名字而非官方名（settings-store 的 modelLabels 合并顺序是 `{ ...official,
 *      ...自添加 }`，自添加胜出）——同一个 id 顶着两个名字：参数走官方、标题写手填值。
 *
 * 不误伤的三条边界：
 *   1. **自定义供应商一律跳过**：它的模型清单完全由用户声明（extraModels），没有 SDK 目录
 *      可比对——按目录重建 / 清理会把用户手填的模型整份清空。
 *   2. **`extraModels` 里不在目录的请求标识无条件保留**：那是用户显式声明的第三方 / 转售模型，
 *      即使不在目录里也不能删；被清掉的只有「已在官方目录」的那一类（见 B）。
 *   3. **目录为空时整条跳过**（presetId 不在 PROVIDER_FILES / 数据文件缺失）：宁可不梳理，
 *      也不要把用户可见的模型列表清空。
 * 另：默认模型(cfg.model)不在此函数内改写——若它已失效，保留原值等于维持既有行为
 * （运行时查不到会回落），避免启动期静默改掉用户选择的模型。
 *
 * 返回是否有变更。启动期调用（app/main/index.ts，早于 createWindow）无需消费返回值——
 * 前端在窗口创建后才读设置，读到的已是新值；返回值主要供测试断言。
 */
export function syncNativeModels(store: Store): boolean {
  try {
    const settings = store.getSettings();
    const providers = settings.apiProviders;
    if (!providers?.configs) return false;
    let changed = false;
    for (const [cfgId, cfg] of Object.entries(providers.configs)) {
      if (!cfg.presetId || cfg.presetId === "custom") continue;
      const nativeIds = [...getProviderStaticModels(cfg.presetId).keys()];
      if (nativeIds.length === 0) continue;
      const native = new Set(nativeIds);
      const extras = normalizeExtraModels(cfg.extraModels);
      const declared = extras.map((n) => n.id).filter((id) => !native.has(id));
      // 清理「请求标识已在官方目录」的 extraModels 条目——以内置为准的另一半。
      // 这类条目**不产生任何效果**：syncExtraModelsFile 遇到同 id 会跳过写入 models[]，
      // modelOverrides 同样跳过，参数一律取官方 spec。但它会让界面显示**手填的名字**而不是
      // 官方名（settings-store 的 modelLabels 合并顺序是 `{ ...official, ...自添加 }`，自添加胜出），
      // 于是同一个 id 顶着两个名字：参数走官方、标题写手填值——2026-09-20 用户报的
      // 「模型管理区还留着 deepseek flash，而列表里显示 DeepSeek V4.1 Flash」即此。
      // 只清「已在目录」的；不在目录的一律保留（用户显式声明的第三方 / 转售模型）。
      const dupRaws = new Set(extras.filter((n) => native.has(n.id)).map((n) => n.raw));
      if (dupRaws.size > 0) {
        const keptExtra = (cfg.extraModels ?? []).filter((e) => !dupRaws.has(e));
        cfg.extraModels = keptExtra.length > 0 ? keptExtra : undefined;
        changed = true;
        console.log(
          `[pi-init] 清理 ${cfgId}(${cfg.presetId}) 中已在官方目录的 extraModels：` +
            `${[...dupRaws].map((e) => (typeof e === "string" ? e : e.id)).join(", ")}` +
            "（参数与显示名一律以官方为准）",
        );
      }
      const allowed = new Set([...nativeIds, ...declared]);
      const prev = cfg.models ?? [];
      // 顺序以保留现有为准（启动期不重排用户可见的下拉顺序）：只删已失效的，新出现的按目录序追加到尾部。
      // 集合结果与"供应商页保存一次"一致，顺序则取最小扰动——目录顺序与用户顺序不同时不做无谓重排。
      const kept = prev.filter((id) => allowed.has(id));
      const keptSet = new Set(kept);
      // 过一遍 Set：kept 来自 prev、declared 来自 extraModels，两者都可能自带重复项
      // （normalizeExtraModels 不去重，存量数据也可能重复）→ 不去重会让下拉出现重复条目；
      // Set 保序，不影响上面「最小扰动」的顺序策略。
      const next = [
        ...new Set([
          ...kept,
          ...nativeIds.filter((id) => !keptSet.has(id)),
          ...declared.filter((id) => !keptSet.has(id)),
        ]),
      ];
      if (prev.length === next.length && prev.every((id, i) => id === next[i])) continue;
      const removed = prev.filter((id) => !next.includes(id));
      const added = next.filter((id) => !prev.includes(id));
      cfg.models = next;
      changed = true;
      console.log(
        `[pi-init] 模型列表对齐 SDK 目录 ${cfgId}(${cfg.presetId})：新增 ${added.length}、移除 ${removed.length}` +
          (removed.length > 0 ? `（移除 ${removed.join(", ")}）` : ""),
      );
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

/** 供应商级静态参数（官方名 / 官方 Base URL / 接入协议）——设置页内置供应商只读展示用 */
export async function getPiProviderInfo(
  providerId: string,
): Promise<{ name: string; baseUrl?: string; apis: string[] } | null> {
  const data = await loadStaticData();
  const p = data[providerId];
  if (!p) return null;
  return { name: p.name, baseUrl: p.baseUrl, apis: p.apis };
}

async function syncProviders(store: Store, runtime: ModelRuntimeInstance) {
  const settings = store.getSettings();
  const providers = settings.apiProviders;
  if (!providers) return;
  for (const [, config] of Object.entries(providers.configs ?? {})) {
    // 内置 provider 只需 setRuntimeApiKey。
    // 账号登录(authType=oauth)的供应商绝不能设 runtime key:解析优先级是
    // runtime override > auth.json > 环境变量,override 一设,auth.json 里的 OAuth
    // 凭据就永远用不上——表现为「登录了但不生效」。
    if (config.presetId && config.presetId !== "custom" && config.authType !== "oauth" && config.apiKey) {
      await runtime.setRuntimeApiKey(config.presetId, config.apiKey);
    }
    // 用户自定义 provider:调 registerProvider 动态注册
    if (config.presetId === "custom" && config.apiKey && config.baseUrl) {
      try {
        // 模型声明(参数由用户显式指定,不再按 id 反查官方同族模型推断):
        // key = 别名 ?? 名称——SDK 的 Model.id 是发给供应商的请求标识,Model.name 仅用于展示。
        // 旧数据里 extraModels 可能是纯字符串 id(无参数声明),此时按保守默认值回落。
        // 请求标识 = id(无别名概念),显示名 = name
        const declared = normalizeExtraModels(config.extraModels);
        const bySdkId = new Map<string, NormalizedExtraModel>();
        for (const d of declared) {
          if (!bySdkId.has(d.id)) bySdkId.set(d.id, d);
        }
        // 模型清单 = 缓存列表(config.models) ∪ 声明的请求 id(任一来源都能注册)
        const sdkIds = [...new Set([...(config.models ?? []), ...declared.map((d) => d.id)])];
        runtime.registerProvider(config.id, {
          name: config.name,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          api: (config as any).apiType || "anthropic-messages",
          models: sdkIds.map((sdkId) => {
            const d = bySdkId.get(sdkId);
            const entry = d?.entry;
            return {
              id: sdkId,
              name: d?.name ?? sdkId,
              // 未声明时保守默认(与旧版行为一致:推理默认开、纯文本输入)
              reasoning: entry?.reasoning ?? true,
              input: entry?.input ?? ["text"],
              ...(entry?.thinkingLevelMap ? { thinkingLevelMap: entry.thinkingLevelMap } : {}),
              // 第三方网关的上游(DeepSeek/Kimi/GLM 官方 API)不认 OpenAI 的 developer
              // 角色,pi 默认按 OpenAI 官方发 developer → 网关 400 且被 SDK 当正常
              // 回合结束(前端表现为"发消息无响应")。system 角色 OpenAI 官方也接受
              compat: { supportsDeveloperRole: false },
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: entry?.contextWindow ?? 200000,
              maxTokens: entry?.maxTokens ?? 32768,
            };
          }),
        } as any);
        if (config.apiKey) {
          await runtime.setRuntimeApiKey(config.id, config.apiKey);
        }
      } catch (e) {
        console.warn(`[pi-init] 自定义 provider ${config.id} 注册失败:`, (e as Error).message);
      }
    }
  }
}
