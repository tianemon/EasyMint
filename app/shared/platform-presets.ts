/**
 * 平台预设定义 — 内置的 API 供应商模板
 * 参考 cc-switch 的 ProviderPreset 模式，简化为 EasyMint 专用
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
  env: {
    ANTHROPIC_BASE_URL?: string;     // undefined = SDK 默认（Anthropic 官方）
    ANTHROPIC_AUTH_TOKEN: string;    // 永远为空字符串，用户填
    ANTHROPIC_MODEL?: string;
    ANTHROPIC_DEFAULT_HAIKU_MODEL?: string;
    ANTHROPIC_DEFAULT_SONNET_MODEL?: string;
    ANTHROPIC_DEFAULT_OPUS_MODEL?: string;
    API_TIMEOUT_MS?: string;        // 超时设置
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC?: number;
  };
  models: string[];            // 默认模型列表
  keyPlaceholder: string;      // API Key 占位文本
  supportsModelList: boolean;  // 是否支持获取模型列表
  modelsUrl?: string;          // 获取模型列表的专用 URL
  supportsContext1M: boolean;  // 是否需要手动勾选 1M 后缀
}

export const PLATFORM_PRESETS: PlatformPreset[] = [
  // ── Anthropic 官方 ──────────────────────────────
  {
    id: "anthropic",
    name: "Anthropic (官方)",
    category: "official",
    websiteUrl: "https://www.anthropic.com/claude-code",
    env: {
      ANTHROPIC_AUTH_TOKEN: "",
    },
    models: [],
    keyPlaceholder: "sk-ant-...",
    supportsModelList: false,
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
      ANTHROPIC_AUTH_TOKEN: "",
      ANTHROPIC_MODEL: "mimo-v2.5-pro",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "mimo-v2.5-pro",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "mimo-v2.5-pro",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "mimo-v2.5-pro",
    },
    models: [],
    keyPlaceholder: "sk-...",
    supportsModelList: true,
    modelsUrl: "https://api.xiaomimimo.com/v1/models",
    supportsContext1M: true,
  },

  // ── Xiaomi MiMo Token Plan (China) ───────────
  {
    id: "xiaomi-mimo-token",
    name: "MiMo Token Plan (China)",
    category: "cn_official",
    websiteUrl: "https://platform.xiaomimimo.com/#/token-plan",
    apiKeyUrl: "https://platform.xiaomimimo.com/#/console/plan-manage",
    env: {
      ANTHROPIC_BASE_URL: "https://token-plan-cn.xiaomimimo.com/anthropic",
      ANTHROPIC_AUTH_TOKEN: "",
      ANTHROPIC_MODEL: "mimo-v2.5-pro",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "mimo-v2.5-pro",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "mimo-v2.5-pro",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "mimo-v2.5-pro",
    },
    models: [],
    keyPlaceholder: "sk-...",
    supportsModelList: true,
    modelsUrl: "https://token-plan-cn.xiaomimimo.com/v1/models",
    supportsContext1M: true,
  },

  // ── Zhipu GLM ───────────────────────────────
  {
    id: "zhipu-glm",
    name: "Zhipu GLM",
    category: "cn_official",
    websiteUrl: "https://open.bigmodel.cn",
    apiKeyUrl: "https://www.bigmodel.cn/claude-code?ic=RRVJPB5SII",
    env: {
      ANTHROPIC_BASE_URL: "https://open.bigmodel.cn/api/anthropic",
      ANTHROPIC_AUTH_TOKEN: "",
      ANTHROPIC_MODEL: "glm-5.1",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.1",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.1",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.1",
    },
    models: [],
    keyPlaceholder: "sk-...",
    supportsModelList: true,
    modelsUrl: "https://open.bigmodel.cn/api/paas/v4/models",
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
      ANTHROPIC_AUTH_TOKEN: "",
      ANTHROPIC_MODEL: "deepseek-v4-pro",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro",
    },
    models: [],
    keyPlaceholder: "sk-...",
    supportsModelList: true,
    modelsUrl: "https://api.deepseek.com/models",
    supportsContext1M: true,
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
      ANTHROPIC_AUTH_TOKEN: "",
      API_TIMEOUT_MS: "3000000",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1,
      ANTHROPIC_MODEL: "MiniMax-M2.7",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "MiniMax-M2.7",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "MiniMax-M2.7",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "MiniMax-M2.7",
    },
    models: [],
    keyPlaceholder: "sk-...",
    supportsModelList: true,
    modelsUrl: "https://api.minimaxi.com/v1/models",
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
