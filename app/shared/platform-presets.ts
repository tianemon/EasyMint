/**
 * 平台预设 — Pi 内置 provider 的 EasyMint 展示元数据（唯一权威表，v0.7.2 合并自 provider-brands + 旧预设表）
 *
 * id 必须与 Pi 的 Provider.id 一致（同时是模型数据层 pi-init-static.ts PROVIDER_FILES 的键）。
 * 供应商模型/定价数据仍从 Pi 包实时读取（pi-init-static.ts），本表只管展示：
 *   label（下拉显示名）、brandKey（品牌归属 → 图标，renderer 侧映射）、keyPlaceholder（API key 输入占位）。
 */

import type { ThinkingLevelValue } from "./thinking-levels";

/** 模型参数:显式声明的字段覆盖官方值,未写的字段跟随官方(写 models.json 的 modelOverrides) */
export interface ModelParams {
  input?: Array<"text" | "image">;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  /** 档位标识映射(null = 该档位不可用);不填继承官方 */
  thinkingLevelMap?: Partial<Record<ThinkingLevelValue, string | null>>;
}

/** 手动添加模型的能力声明(用户显式指定,不再自动推断)。
 *  id / name 与 SDK Model 一一对应,没有别名概念:
 *    id   = 发给供应商的请求标识(SDK Model.id),供应商内唯一
 *    name = 界面显示名(SDK Model.name)
 *  存量数据的 alias 由启动迁移改写为这套语义(见 extra-models-migration.ts)。 */
export interface ExtraModelCapability {
  /** 请求标识:发给供应商的模型名(SDK Model.id) */
  id: string;
  /** 界面显示名(SDK Model.name) */
  name: string;
  /** 输入能力:含 "image" 即支持识图 */
  input?: Array<"text" | "image">;
  /** 上下文窗口(token);必填(自添加模型不再推断) */
  contextWindow: number;
  /** 最大输出(token);必填 */
  maxTokens: number;
  reasoning?: boolean;
  thinkingLevelMap?: ModelParams["thinkingLevelMap"];
}

export interface ProviderConfig {
  id: string;              // 用户配置 ID
  presetId: string;        // Pi Provider.id,自定义供应商用 "custom"
  name: string;            // 用户自定义名称
  apiKey: string;
  model: string;           // 该供应商的默认模型(激活时优先使用)
  models: string[];        // 缓存：上次获取的模型列表
  createdAt: number;
  /** 用户手动补充的模型(SDK 列表外的自定义模型,如新上线;保存时与 models 合并去重)。
   *  string = 仅 ID(存量数据,由启动迁移显式化为对象);对象 = 带显式能力声明。
   *  读取一律经 normalizeExtraModels 归一化,不直接分流 string/对象 */
  extraModels?: Array<string | ExtraModelCapability>;
  /** 官方目录模型的参数覆盖(key = 模型 id;空对象 = 参数全跟随官方) */
  modelOverrides?: Record<string, ModelParams>;
  /** 自定义供应商 API 端点(仅 presetId==="custom" 时有效) */
  baseUrl?: string;
  /** 自定义供应商 API 类型(如 anthropic-messages,仅 presetId==="custom" 时有效) */
  apiType?: string;
  /** 该供应商的 task 工具子 Agent 默认模型(委派子 Agent 未指定时用,从 models 选) */
  subagentDefaultModel?: string;
}

export interface ApiProvidersData {
  current: string | null;
  configs: Record<string, ProviderConfig>;
}

/** extraModels 条目的归一化形态(存储仍是 string | ExtraModelCapability union,读取统一经 normalizeExtraModels) */
export interface NormalizedExtraModel {
  /** 请求标识:发给供应商的模型名(SDK Model.id) */
  id: string;
  /** 界面显示名;存量数据缺 name 时回落请求标识 */
  name: string;
  /** 对象条目的完整声明;string 条目(存量遗留)无参数声明 */
  entry?: ExtraModelCapability;
  /** 原始条目(保引用,供在原 union 列表里定位替换/删除) */
  raw: string | ExtraModelCapability;
}

/**
 * extraModels 归一化:所有读取点的统一入口,string 条目转 { id, name }、无 id 的坏条目丢弃。
 *
 * 兼容旧形态(迁移未跑到时):旧条目 id 是显示名、alias 是请求标识——
 * 以「有没有 name 字段」区分新旧:id 侧取 alias ?? id,name 侧取 name ?? id。
 */
export function normalizeExtraModels(
  list?: ReadonlyArray<string | ExtraModelCapability>,
): NormalizedExtraModel[] {
  const out: NormalizedExtraModel[] = [];
  for (const raw of list ?? []) {
    if (typeof raw === "string") {
      if (raw) out.push({ id: raw, name: raw, raw });
    } else if (raw?.id) {
      // 新版条目:id 即请求标识;旧版(无 name):id 是显示名,请求标识可能是 alias
      const legacy = raw.name === undefined && (raw as { alias?: string }).alias;
      const id = legacy ? ((raw as { alias?: string }).alias as string) : raw.id;
      out.push({ id, name: raw.name ?? raw.id, entry: raw, raw });
    }
  }
  return out;
}

export interface PlatformPreset {
  id: string;              // = Pi Provider.id
  label: string;           // 显示名(下拉选项)
  brandKey: string;        // 品牌归属(renderer 侧映射图标/中文名)
  keyPlaceholder: string;  // API key 输入占位
}

// 精选 Pi 内置 provider（过滤掉企业/边缘/不常用的）——下拉选项与预设元数据的唯一来源
const PLATFORM_PRESETS: PlatformPreset[] = [
  { id: "anthropic",             label: "Anthropic",                brandKey: "anthropic", keyPlaceholder: "sk-ant-..." },
  { id: "openai",                label: "OpenAI",                   brandKey: "openai",    keyPlaceholder: "sk-..." },
  { id: "deepseek",              label: "DeepSeek",                 brandKey: "deepseek",  keyPlaceholder: "sk-..." },
  { id: "google",                label: "Google Gemini",            brandKey: "google",    keyPlaceholder: "AIza..." },
  { id: "kimi-coding",           label: "Kimi Coding",              brandKey: "kimi",      keyPlaceholder: "sk-..." },
  { id: "moonshotai",            label: "Moonshot AI",              brandKey: "kimi",      keyPlaceholder: "sk-..." },
  { id: "moonshotai-cn",         label: "Moonshot AI CN",           brandKey: "kimi",      keyPlaceholder: "sk-..." },
  { id: "zai",                   label: "Z.AI",                     brandKey: "zai",       keyPlaceholder: "sk-..." },
  { id: "zai-coding-cn",         label: "Z.AI Coding CN",           brandKey: "zai",       keyPlaceholder: "sk-..." },
  { id: "minimax",               label: "MiniMax",                  brandKey: "minimax",   keyPlaceholder: "sk-..." },
  { id: "minimax-cn",            label: "MiniMax CN",               brandKey: "minimax",   keyPlaceholder: "sk-..." },
  { id: "qwen-token-plan",       label: "Qwen Token Plan",          brandKey: "qwen",      keyPlaceholder: "sk-..." },
  { id: "qwen-token-plan-cn",    label: "Qwen Token Plan CN",       brandKey: "qwen",      keyPlaceholder: "sk-..." },
  { id: "qwen-token-plan-individual", label: "Qwen Token Plan Individual", brandKey: "qwen", keyPlaceholder: "sk-..." },
  { id: "xiaomi",                label: "Xiaomi MiMo",              brandKey: "xiaomi",    keyPlaceholder: "sk-..." },
  { id: "xiaomi-token-plan-cn",  label: "MiMo Token Plan CN",       brandKey: "xiaomi",    keyPlaceholder: "sk-..." },
  { id: "xiaomi-token-plan-sgp", label: "MiMo Token Plan SGP",      brandKey: "xiaomi",    keyPlaceholder: "sk-..." },
  { id: "xiaomi-token-plan-ams", label: "MiMo Token Plan AMS",      brandKey: "xiaomi",    keyPlaceholder: "sk-..." },
  { id: "xai",                   label: "xAI",                      brandKey: "xai",       keyPlaceholder: "xai-..." },
  { id: "openai-codex",          label: "OpenAI Codex",             brandKey: "codex",     keyPlaceholder: "sk-..." },
  { id: "opencode",              label: "OpenCode",                 brandKey: "opencode",  keyPlaceholder: "sk-..." },
  { id: "opencode-go",           label: "OpenCode Go",              brandKey: "opencode",  keyPlaceholder: "sk-..." },
];

export function listPresets(): PlatformPreset[] {
  return PLATFORM_PRESETS;
}

export function getPreset(id: string): PlatformPreset | undefined {
  return PLATFORM_PRESETS.find((p) => p.id === id);
}
