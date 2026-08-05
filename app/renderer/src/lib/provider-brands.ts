/**
 * 供应商品牌映射 — EM 精选的 11 个主流品牌(对齐 Proma 支持 + Pi 内置)。
 *
 * 每个品牌含一个或多个「接入方式」(不同 Pi provider,如 Kimi 有 Coding Plan / Moonshot API)。
 * 含显示名、中文名(括号)与图标。图标来自 Proma 项目的品牌 PNG(复制至 assets/providers/)。
 */

import claudeIcon from "../assets/providers/claude.png";
import openaiIcon from "../assets/providers/openai.png";
import deepseekIcon from "../assets/providers/deepseek.png";
import geminiIcon from "../assets/providers/gemini.png";
import moonshotIcon from "../assets/providers/moonshot.png";
import zhipuIcon from "../assets/providers/zhipu.png";
import minimaxIcon from "../assets/providers/minimax.png";
import qwenIcon from "../assets/providers/qwen.png";
import xiaomiIcon from "../assets/providers/xiaomi.png";
import grokIcon from "../assets/providers/grok.png";

/** 品牌的单个接入方式(一个 Pi provider) */
export interface ProviderAccess {
  /** Pi provider id */
  id: string;
  /** 接入方式显示名(如 "Kimi Coding Plan" / "Moonshot API") */
  label: string;
}

export interface ProviderBrand {
  /** 品牌 key */
  key: string;
  /** 显示名 */
  name: string;
  /** 中文名(有则显示在括号) */
  cnName?: string;
  /** 品牌图标 */
  icon: string;
  /** 该品牌的所有接入方式(每个 Pi provider 一项) */
  accesses: ProviderAccess[];
}

/** EM 精选的 11 个主流供应商品牌(与 Proma 重叠,能提供品牌图标) */
export const PROVIDER_BRANDS: ProviderBrand[] = [
  {
    key: "anthropic", name: "Anthropic", cnName: "Claude", icon: claudeIcon,
    accesses: [{ id: "anthropic", label: "Anthropic" }],
  },
  {
    key: "openai", name: "OpenAI", icon: openaiIcon,
    accesses: [{ id: "openai", label: "OpenAI" }],
  },
  {
    key: "deepseek", name: "DeepSeek", cnName: "深度求索", icon: deepseekIcon,
    accesses: [{ id: "deepseek", label: "DeepSeek" }],
  },
  {
    key: "google", name: "Google Gemini", cnName: "谷歌", icon: geminiIcon,
    accesses: [{ id: "google", label: "Google Gemini" }],
  },
  {
    key: "kimi", name: "Kimi", cnName: "月之暗面", icon: moonshotIcon,
    accesses: [
      { id: "kimi-coding", label: "Kimi Coding Plan" },
      { id: "moonshotai", label: "Moonshot API" },
      { id: "moonshotai-cn", label: "Moonshot API(国内)" },
    ],
  },
  {
    key: "zai", name: "智谱", cnName: "Z.AI", icon: zhipuIcon,
    accesses: [
      { id: "zai", label: "Z.AI API" },
      { id: "zai-coding-cn", label: "智谱 Coding Plan" },
    ],
  },
  {
    key: "minimax", name: "MiniMax", cnName: "稀宇科技", icon: minimaxIcon,
    accesses: [
      { id: "minimax", label: "MiniMax" },
      { id: "minimax-cn", label: "MiniMax(国内)" },
    ],
  },
  {
    key: "qwen", name: "通义千问", cnName: "阿里云", icon: qwenIcon,
    accesses: [
      { id: "qwen-token-plan", label: "通义千问 Token Plan" },
      { id: "qwen-token-plan-cn", label: "通义千问 Token Plan(国内)" },
    ],
  },
  {
    key: "xiaomi", name: "小米 MiMo", cnName: "小米", icon: xiaomiIcon,
    accesses: [
      { id: "xiaomi", label: "小米 MiMo" },
      { id: "xiaomi-token-plan-cn", label: "MiMo Token Plan(国内)" },
      { id: "xiaomi-token-plan-sgp", label: "MiMo Token Plan(新加坡)" },
      { id: "xiaomi-token-plan-ams", label: "MiMo Token Plan(欧洲)" },
    ],
  },
  {
    key: "xai", name: "xAI", cnName: "Grok", icon: grokIcon,
    accesses: [{ id: "xai", label: "xAI" }],
  },
  {
    key: "codex", name: "OpenAI Codex", icon: openaiIcon,
    accesses: [{ id: "openai-codex", label: "OpenAI Codex" }],
  },
  {
    key: "opencode", name: "OpenCode", cnName: "中转", icon: deepseekIcon,
    accesses: [
      { id: "opencode", label: "OpenCode" },
      { id: "opencode-go", label: "OpenCode Go" },
    ],
  },
];

/** pi provider id → 品牌(查找用) */
export const BRAND_BY_PI_ID: Map<string, ProviderBrand> = new Map(
  PROVIDER_BRANDS.flatMap((b) => b.accesses.map((a) => [a.id, b] as [string, ProviderBrand])),
);

/** 品牌显示名(含中文括号):如 "DeepSeek(深度求索)" */
export function brandDisplayName(b: ProviderBrand): string {
  return b.cnName ? `${b.name}(${b.cnName})` : b.name;
}

/** 下拉选项:展开所有品牌的全部接入方式,value = pi id,label = 品牌 + 接入方式 */
export function providerSelectOptions(): Array<{ value: string; label: string; icon: string }> {
  return PROVIDER_BRANDS.flatMap((b) =>
    b.accesses.map((a) => ({
      value: a.id,
      // 单接入方式只显示品牌名+中文;多接入方式加 (接入方式) 区分
      label: b.accesses.length > 1 ? `${brandDisplayName(b)}(${a.label})` : brandDisplayName(b),
      icon: b.icon,
    })),
  );
}
