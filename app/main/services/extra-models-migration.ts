/**
 * 存量模型参数迁移 —— extraModels 的 string 条目显式化(一次性写 em-settings.json)。
 *
 * 背景:参数统一管理取消了「近似匹配」(前缀/段级反查官方同族模型推断参数)。
 * 取消后,仅写 ID 的存量条目会回落 200000 / 32768 —— 若模型实际是 1M 窗口会
 * 过早触发压缩(行为退化)。迁移用旧版推断逻辑算出当前生效参数并写成显式声明,
 * 保证迁移前后生效值一致;此后 models.json 只写声明值,不再有任何推断。
 *
 * 一次性:首次运行迁移存量条目并置 modelParamsMigrated 标记,此后不再推断——标记后新增的
 * 条目(即使还是旧 UI 写的纯字符串)直接回落 200000 / 32768,由 UI 要求手填。
 * 幂等:只为「与旧版推断结果不同」的条目改写,已声明字段一律不动。
 * 迁移写入的是推断值(可能本身不准),界面需提示用户核对;只写 em-settings.json,可回退。
 */

import type { ExtraModelCapability } from "../../shared/platform-presets";
import {
  getModelSpecLookup,
  getProviderStaticModels,
  getStaticModelSpecWithAlias,
  lookupBySegmentPrefix,
  lookupWithAlias,
} from "./pi-init-static";
import type { Store } from "./store";

/** 条目声明形态:对象条目可能缺参数(存量数据),字符串条目只有 ID */
type DeclaredEntry = Partial<ExtraModelCapability> & { id: string };

/** 旧版能力继承字段(reasoning / input / thinkingLevelMap)——与取消推断前 pi-init 的继承口径一致 */
function pickCapability(spec: Record<string, any> | undefined): Partial<ExtraModelCapability> {
  if (!spec) return {};
  const out: Partial<ExtraModelCapability> = {};
  if (spec.reasoning !== undefined) out.reasoning = spec.reasoning;
  if (spec.input !== undefined) out.input = spec.input;
  if (spec.thinkingLevelMap !== undefined) out.thinkingLevelMap = spec.thinkingLevelMap;
  return out;
}

/**
 * 内置供应商补充模型的旧版生效参数(与旧版 syncExtraModelsFile 的推断结果一致):
 * 同族能力(段级反查 → 该供应商默认模型/首个模型兜底) + 视觉关键词 + 跨供应商窗口查表。
 * models.json 里的手写字段由 syncExtraModelsFile 的 handWritten 合并保留,与迁移无关。
 */
function legacyBuiltinParams(presetId: string, id: string, fallbackModel?: string): Omit<ExtraModelCapability, "id" | "name"> {
  const lookup = getModelSpecLookup();
  const siblings = getProviderStaticModels(presetId);
  const family =
    siblings.get(id) ??
    lookupBySegmentPrefix(siblings, id) ??
    (fallbackModel ? siblings.get(fallbackModel) : undefined) ??
    [...siblings.values()][0];
  const spec = lookupWithAlias(lookup, id) ?? lookupBySegmentPrefix(lookup, id);
  const vision = /vision|vl[-_]|omni/i.test(id) ? { input: ["text", "image"] as Array<"text" | "image"> } : {};
  return {
    ...pickCapability(family),
    ...vision,
    contextWindow: spec?.contextWindow ?? 200000,
    // 思考 token 计入 max_tokens 预算,4k 级默认会让思考未完成即截断(旧版注释)
    maxTokens: spec?.maxTokens ?? 32768,
  };
}

/** 自定义供应商模型的旧版生效参数(与旧版 syncProviders 的推断结果一致) */
function legacyCustomParams(id: string): Omit<ExtraModelCapability, "id" | "name"> {
  const lookup = getModelSpecLookup();
  const spec = lookupWithAlias(lookup, id) ?? lookupBySegmentPrefix(lookup, id);
  return {
    // 旧版硬编码 reasoning:true / input:["text"],再被官方同族能力覆盖
    reasoning: true,
    input: ["text"],
    ...pickCapability(getStaticModelSpecWithAlias(id)),
    contextWindow: spec?.contextWindow ?? 200000,
    maxTokens: spec?.maxTokens ?? 32768,
  };
}

/** 把条目显式化为对象:用户已声明的字段优先(含手写的未知字段),缺失的用旧版推断值补齐 */
function toExplicitCapability(entry: DeclaredEntry, legacy: Omit<ExtraModelCapability, "id" | "name">): ExtraModelCapability {
  const merged = { ...entry } as ExtraModelCapability;
  if (entry.contextWindow === undefined) merged.contextWindow = legacy.contextWindow;
  if (entry.maxTokens === undefined) merged.maxTokens = legacy.maxTokens;
  if (entry.input === undefined && legacy.input !== undefined) merged.input = legacy.input;
  if (entry.reasoning === undefined && legacy.reasoning !== undefined) merged.reasoning = legacy.reasoning;
  if (entry.thinkingLevelMap === undefined && legacy.thinkingLevelMap !== undefined) {
    merged.thinkingLevelMap = legacy.thinkingLevelMap;
  }
  return merged;
}

/**
 * 模型身份迁移 —— 旧「id=显示名 + alias=请求标识」改写为新「id=请求标识 + name=显示名」(一次性)。
 *
 * 背景:早期以为 SDK 只有一个展示字段,于是用 alias 承载请求标识;SDK 的 Model 其实同时有
 * id(请求) 与 name(展示),别名概念多余且易错。新语义下:
 *   id   := 旧 alias ?? 旧 id   —— 请求标识保持不变,已存会话/默认模型/模型缓存都不受影响
 *   name := 旧 id               —— 界面上看到的文字保持不变
 * 旧版代码读新数据只是显示退化成请求标识(功能正常),新版读旧数据有 normalizeExtraModels 兜底。
 * 一次性:modelIdentityMigrated 标记后不再改写。只写 em-settings.json。
 */
export function migrateModelIdentity(store: Store): boolean {
  const settings = store.getSettings();
  if (settings.modelIdentityMigrated) return false;
  const providers = settings.apiProviders;
  let changed = false;
  for (const cfg of Object.values(providers?.configs ?? {})) {
    const list = cfg.extraModels;
    if (!list?.length) continue;
    let cfgChanged = false;
    const next = list.map((raw) => {
      if (typeof raw === "string") return raw;
      const legacy = raw as ExtraModelCapability & { alias?: string };
      // 已有 name 即新形态;无 name 的旧对象(含纯 { id } 条目)按旧语义改写
      if (legacy.name !== undefined) return raw;
      const migrated: ExtraModelCapability = {
        id: legacy.alias ?? legacy.id,
        name: legacy.id,
        contextWindow: legacy.contextWindow,
        maxTokens: legacy.maxTokens,
        input: legacy.input,
        reasoning: legacy.reasoning,
      };
      if (legacy.thinkingLevelMap) migrated.thinkingLevelMap = legacy.thinkingLevelMap;
      cfgChanged = true;
      return migrated;
    });
    if (cfgChanged) {
      cfg.extraModels = next;
      changed = true;
    }
  }
  settings.modelIdentityMigrated = true;
  store.saveSettings(settings);
  return changed;
}

/** 语义比较(键序无关——JSON.stringify 直接比会因键序不同误判为「需迁移」) */
function sameCapability(a: DeclaredEntry, b: ExtraModelCapability): boolean {
  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.every((k) => JSON.stringify(left[k]) === JSON.stringify(right[k]));
}

/**
 * 迁移 extraModels 的 string 条目与缺参对象条目。返回是否改写了条目。
 * 只处理内置供应商(custom 的模型清单存在 config.models,不在迁移范围)。
 *
 * 一次性:首次运行即置 modelParamsMigrated 标记——标记后新增的条目(即使还是旧 UI 写的
 * 纯字符串)不再按旧逻辑推断参数,而是回落 200000/32768(必须手填)。
 * 否则「取消近似匹配」会被迁移重新引回:新模型一律被当成存量条目补上推断值。
 */
export function migrateExtraModels(store: Store): boolean {
  const settings = store.getSettings();
  if (settings.modelParamsMigrated) return false;
  const providers = settings.apiProviders;
  let changed = false;
  for (const cfg of Object.values(providers?.configs ?? {})) {
    const list = cfg.extraModels;
    if (!list?.length) continue;
    const isCustom = !cfg.presetId || cfg.presetId === "custom";
    const siblings = isCustom ? undefined : getProviderStaticModels(cfg.presetId);
    const fallbackModel = siblings?.has(cfg.model) ? cfg.model : undefined;
    let cfgChanged = false;
    const next = list.map((raw) => {
      const entry: DeclaredEntry = typeof raw === "string" ? { id: raw } : raw;
      if (!entry?.id) return raw;
      const legacy = isCustom ? legacyCustomParams(entry.id) : legacyBuiltinParams(cfg.presetId, entry.id, fallbackModel);
      const migrated = toExplicitCapability(entry, legacy);
      if (sameCapability(entry, migrated)) return raw;
      cfgChanged = true;
      return migrated;
    });
    if (cfgChanged) {
      cfg.extraModels = next;
      changed = true;
    }
  }
  // 首次运行即落标记(即使本次无条目可迁)——区分「升级前存量」与「升级后新增」
  settings.modelParamsMigrated = true;
  store.saveSettings(settings);
  return changed;
}
