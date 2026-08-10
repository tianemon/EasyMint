/**
 * 平台预设 — Pi 内置 provider 的 EasyMint 展示元数据（唯一权威表，v0.7.2 合并自 provider-brands + 旧预设表）
 *
 * id 必须与 Pi 的 Provider.id 一致（同时是模型数据层 pi-init-static.ts PROVIDER_FILES 的键）。
 * 供应商模型/定价数据仍从 Pi 包实时读取（pi-init-static.ts），本表只管展示：
 *   label（下拉显示名）、brandKey（品牌归属 → 图标，renderer 侧映射）、keyPlaceholder（API key 输入占位）。
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
