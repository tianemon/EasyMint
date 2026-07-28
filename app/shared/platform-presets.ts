/**
 * 平台预设定义 — 内置的 API 供应商模板
 * 参考 cc-switch 的 ProviderPreset + Proma 的 PROVIDER_DEFAULT_URLS
 */

// ── 共享类型（main & renderer 共用）─────────────────

/** 用户保存的供应商配置 */
export interface ProviderConfig {
  id: string;              // 用户配置 ID，如 "deepseek-main"
  presetId: string;        // 引用 PlatformPreset.id，如 "deepseek"
  name: string;            // 用户自定义名称
  apiKey: string;          // API Key
  baseUrl?: string;        // 覆盖预设 URL（可选）
  model: string;           // 当前选中的模型
  models: string[];        // 模型列表
  context1M: boolean;      // 是否启用 1M 上下文
  createdAt: number;       // 创建时间戳
}

export interface ApiProvidersData {
  current: string | null;            // 当前激活的 providerConfig.id
  configs: Record<string, ProviderConfig>;
}

export interface PlatformPreset {
  id: string;
  name: string;
  category: "official" | "cn_official";
  websiteUrl: string;          // 获取 API Key 的链接
  apiKeyUrl?: string;          // 直达 Key 管理页
  /** Pi SDK API 类型（默认 anthropic-messages） */
  apiType?: string;
  env: {
    ANTHROPIC_BASE_URL?: string;     // undefined = SDK 默认
    ANTHROPIC_MODEL?: string;        // 默认模型 ID
  };
  models: string[];            // 默认模型列表
  keyPlaceholder: string;      // API Key 占位文本
  supportsModelList: boolean;  // 是否支持获取模型列表
  modelsUrl?: string;          // 获取模型列表的专用 URL
  supportsContext1M: boolean;  // 是否需要手动勾选 1M 后缀
}

// 按名称首字母排序
export const PLATFORM_PRESETS: PlatformPreset[] = [
  // ── Anthropic ─────────────────────────────────
  {
    id: "anthropic",
    name: "Anthropic",
    category: "official",
    websiteUrl: "https://www.anthropic.com/claude-code",
    env: {
      ANTHROPIC_BASE_URL: "https://api.anthropic.com",
    },
    models: [],
    keyPlaceholder: "sk-ant-...",
    supportsModelList: false,
    supportsContext1M: false,
  },

  // ── DeepSeek ─────────────────────────────────
  {
    id: "deepseek",
    name: "DeepSeek",
    category: "cn_official",
    websiteUrl: "https://platform.deepseek.com",
    env: {
      ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
      ANTHROPIC_MODEL: "deepseek-v4-pro",
    },
    models: [],
    keyPlaceholder: "sk-...",
    supportsModelList: true,
    modelsUrl: "https://api.deepseek.com/models",
    supportsContext1M: true,
  },

  // ── Kimi API ─────────────────────────────────
  {
    id: "kimi-api",
    name: "Kimi API",
    category: "cn_official",
    websiteUrl: "https://platform.moonshot.cn/console",
    env: {
      ANTHROPIC_BASE_URL: "https://api.moonshot.cn/anthropic",
      ANTHROPIC_MODEL: "kimi-k2.6",
    },
    models: [],
    keyPlaceholder: "sk-...",
    supportsModelList: true,
    modelsUrl: "https://api.moonshot.cn/v1/models",
    supportsContext1M: false,
  },

  // ── Kimi Coding Plan ─────────────────────────
  {
    id: "kimi-coding",
    name: "Kimi Coding Plan",
    category: "cn_official",
    websiteUrl: "https://www.kimi.com/code/docs/",
    env: {
      ANTHROPIC_BASE_URL: "https://api.kimi.com/coding",
    },
    models: [],
    keyPlaceholder: "sk-...",
    supportsModelList: true,
    modelsUrl: "https://api.kimi.com/coding/v1/models",
    supportsContext1M: false,
  },

  // ── MiniMax ──────────────────────────────────
  {
    id: "minimax",
    name: "MiniMax",
    category: "cn_official",
    websiteUrl: "https://platform.minimaxi.com",
    apiKeyUrl: "https://platform.minimaxi.com/subscribe/coding-plan",
    env: {
      ANTHROPIC_BASE_URL: "https://api.minimaxi.com/anthropic",
      ANTHROPIC_MODEL: "MiniMax-M2.7",
    },
    models: [],
    keyPlaceholder: "sk-...",
    supportsModelList: true,
    modelsUrl: "https://api.minimaxi.com/v1/models",
    supportsContext1M: false,
  },

  // ── Xiaomi MiMo ──────────────────────────────
  {
    id: "xiaomi-mimo",
    name: "Xiaomi MiMo",
    category: "cn_official",
    websiteUrl: "https://platform.xiaomimimo.com",
    apiKeyUrl: "https://platform.xiaomimimo.com/#/console/api-keys",
    env: {
      ANTHROPIC_BASE_URL: "https://api.xiaomimimo.com/anthropic",
      ANTHROPIC_MODEL: "mimo-v2.5-pro",
    },
    models: [],
    keyPlaceholder: "sk-...",
    supportsModelList: true,
    modelsUrl: "https://api.xiaomimimo.com/v1/models",
    supportsContext1M: true,
  },

  // ── MiMo Token Plan (China) ──────────────────
  {
    id: "xiaomi-mimo-token",
    name: "Xiaomi MiMo Token Plan (China)",
    category: "cn_official",
    websiteUrl: "https://platform.xiaomimimo.com/#/token-plan",
    apiKeyUrl: "https://platform.xiaomimimo.com/#/console/plan-manage",
    env: {
      ANTHROPIC_BASE_URL: "https://token-plan-cn.xiaomimimo.com/anthropic",
      ANTHROPIC_MODEL: "mimo-v2.5-pro",
    },
    models: [],
    keyPlaceholder: "sk-...",
    supportsModelList: true,
    modelsUrl: "https://token-plan-cn.xiaomimimo.com/v1/models",
    supportsContext1M: true,
  },

  // ── Zhipu Coding Plan ────────────────────────
  {
    id: "zhipu-coding",
    name: "Zhipu Coding Plan",
    category: "cn_official",
    websiteUrl: "https://open.bigmodel.cn",
    apiKeyUrl: "https://www.bigmodel.cn/claude-code?ic=RRVJPB5SII",
    env: {
      ANTHROPIC_BASE_URL: "https://open.bigmodel.cn/api/anthropic",
      ANTHROPIC_MODEL: "glm-5.1",
    },
    models: [],
    keyPlaceholder: "sk-...",
    supportsModelList: true,
    modelsUrl: "https://open.bigmodel.cn/api/paas/v4/models",
    supportsContext1M: false,
  },

];

/** 按 category 分组 */
export function getPresetsByCategory(): Record<string, PlatformPreset[]> {
  const groups: Record<string, PlatformPreset[]> = {};
  for (const p of PLATFORM_PRESETS) {
    if (!groups[p.category]) groups[p.category] = [];
    groups[p.category]!.push(p);
  }
  return groups;
}

/** 根据 id 查找预设 */
export function getPreset(id: string): PlatformPreset | undefined {
  return PLATFORM_PRESETS.find((p) => p.id === id);
}

/** 获取所有模型（去重） */
export function getAllModels(): string[] {
  const set = new Set<string>();
  for (const p of PLATFORM_PRESETS) {
    for (const m of p.models) set.add(m);
  }
  return Array.from(set).sort();
}
