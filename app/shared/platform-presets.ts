/**
 * 平台预设 — Pi 内置 provider 的 EasyMint 元数据
 *
 * 供应商、模型、定价、API 格式全部来自 Pi SDK，这里只补充 EasyMint UI 需要的展示信息。
 * id 必须与 Pi 的 Provider.id 一致。
 */

export interface ProviderConfig {
  id: string;              // 用户配置 ID
  presetId: string;        // Pi Provider.id,自定义供应商用 "custom"
  name: string;            // 用户自定义名称
  apiKey: string;
  model: string;           // 该供应商的默认模型(激活时优先使用)
  models: string[];        // 缓存：上次获取的模型列表
  createdAt: number;
  /** 自定义供应商 API 端点(仅 presetId==="custom" 时有效) */
  baseUrl?: string;
  /** 自定义供应商 API 类型(如 anthropic-messages,仅 presetId==="custom" 时有效) */
  apiType?: string;
  /** 该供应商的兜底模型(默认模型不可用时降级,从 models 选) */
  fallbackModel?: string;
  /** 该供应商的 task 工具子 Agent 默认模型(委派子 Agent 未指定时用,从 models 选) */
  subagentDefaultModel?: string;
}

export interface ApiProvidersData {
  current: string | null;
  configs: Record<string, ProviderConfig>;
}

export interface PlatformPreset {
  id: string;              // = Pi Provider.id
  name: string;            // 显示名
  category: "official" | "cn_official";
  websiteUrl: string;
  apiKeyUrl?: string;
  keyPlaceholder: string;
  supportsContext1M: boolean;
}

// 精选 Pi 内置 provider（过滤掉企业/边缘/不常用的）
export const PLATFORM_PRESETS: PlatformPreset[] = [
  { id: "anthropic",        name: "Anthropic",              category: "official",    websiteUrl: "https://www.anthropic.com/claude-code",                                          keyPlaceholder: "sk-ant-...", supportsContext1M: false },
  { id: "deepseek",         name: "DeepSeek",               category: "cn_official", websiteUrl: "https://platform.deepseek.com",                                                keyPlaceholder: "sk-...",     supportsContext1M: true },
  { id: "moonshotai",       name: "Kimi API (Moonshot)",    category: "cn_official", websiteUrl: "https://platform.moonshot.cn/console",                                          keyPlaceholder: "sk-...",     supportsContext1M: false },
  { id: "kimi-coding",      name: "Kimi Coding Plan",       category: "cn_official", websiteUrl: "https://www.kimi.com/code/docs/",                                               keyPlaceholder: "sk-...",     supportsContext1M: false },
  { id: "minimax",          name: "MiniMax",                category: "cn_official", websiteUrl: "https://platform.minimaxi.com",           apiKeyUrl: "https://platform.minimaxi.com/subscribe/coding-plan", keyPlaceholder: "sk-...", supportsContext1M: false },
  { id: "minimax-cn",       name: "MiniMax (国内)",          category: "cn_official", websiteUrl: "https://platform.minimaxi.com",           apiKeyUrl: "https://platform.minimaxi.com/subscribe/coding-plan", keyPlaceholder: "sk-...", supportsContext1M: false },
  { id: "xiaomi",           name: "Xiaomi MiMo",            category: "cn_official", websiteUrl: "https://platform.xiaomimimo.com",          apiKeyUrl: "https://platform.xiaomimimo.com/#/console/api-keys",    keyPlaceholder: "sk-...", supportsContext1M: true },
  { id: "xiaomi-token-plan-cn", name: "MiMo Token Plan",    category: "cn_official", websiteUrl: "https://platform.xiaomimimo.com/#/token-plan", apiKeyUrl: "https://platform.xiaomimimo.com/#/console/plan-manage", keyPlaceholder: "sk-...", supportsContext1M: true },
  { id: "zai-coding-cn",    name: "智谱 Coding Plan",       category: "cn_official", websiteUrl: "https://open.bigmodel.cn",                  apiKeyUrl: "https://www.bigmodel.cn/claude-code?ic=RRVJPB5SII",     keyPlaceholder: "sk-...", supportsContext1M: false },
  { id: "zai",              name: "智谱 API (Z.AI)",        category: "cn_official", websiteUrl: "https://open.bigmodel.cn",                                                    keyPlaceholder: "sk-...", supportsContext1M: false },
  { id: "qwen-token-plan",  name: "通义千问 Token Plan",     category: "cn_official", websiteUrl: "https://www.aliyun.com/product/tongyi",                                           keyPlaceholder: "sk-...",     supportsContext1M: false },
  { id: "qwen-token-plan-cn", name: "通义千问 Token Plan (国内)", category: "cn_official", websiteUrl: "https://www.aliyun.com/product/tongyi",                                     keyPlaceholder: "sk-...",     supportsContext1M: false },
  { id: "google",           name: "Google Gemini",          category: "official",    websiteUrl: "https://ai.google.dev",                                                       keyPlaceholder: "AIza...",    supportsContext1M: false },
  { id: "openai",           name: "OpenAI",                 category: "official",    websiteUrl: "https://platform.openai.com/api-keys",                                         keyPlaceholder: "sk-...",     supportsContext1M: false },
  { id: "mistral",          name: "Mistral",                category: "official",    websiteUrl: "https://console.mistral.ai/api-keys",                                          keyPlaceholder: "...",        supportsContext1M: false },
  { id: "groq",             name: "Groq",                   category: "official",    websiteUrl: "https://console.groq.com/keys",                                                keyPlaceholder: "gsk_...",    supportsContext1M: false },
  { id: "xai",              name: "xAI (Grok)",             category: "official",    websiteUrl: "https://console.x.ai",                                                         keyPlaceholder: "xai-...",    supportsContext1M: false },
  { id: "cerebras",         name: "Cerebras",               category: "official",    websiteUrl: "https://cloud.cerebras.ai",                                                    keyPlaceholder: "...",        supportsContext1M: false },
  { id: "github-copilot",   name: "GitHub Copilot",         category: "official",    websiteUrl: "https://github.com/settings/tokens",                                           keyPlaceholder: "ghp_...",    supportsContext1M: false },
];

export function getPreset(id: string): PlatformPreset | undefined {
  return PLATFORM_PRESETS.find((p) => p.id === id);
}
