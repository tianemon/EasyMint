/**
 * 供应商品牌图标映射 — 品牌 key → 展示信息（名称/中文名/图标）。
 *
 * 品牌与接入点的归属关系在 shared/platform-presets.ts 的 brandKey 字段（唯一权威表），
 * 本文件只提供品牌图标资产与派生查询（BRAND_BY_PI_ID / providerSelectOptions）。
 * 图标来自 Proma 项目的品牌 PNG(复制至 assets/providers/)。
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
import opencodeIcon from "../assets/providers/opencode.png";
import { listPresets } from "@shared/platform-presets";

export interface ProviderBrand {
  /** 品牌 key(与 platform-presets.brandKey 对应) */
  key: string;
  /** 显示名 */
  name: string;
  /** 中文名(有则显示在括号) */
  cnName?: string;
  /** 品牌图标(无则 UI 不渲染图片,空白占位) */
  icon?: string;
}

/** EM 精选的 11 个主流供应商品牌(与 Proma 重叠,能提供品牌图标) */
const BRANDS: ProviderBrand[] = [
  { key: "anthropic", name: "Anthropic", cnName: "Claude", icon: claudeIcon },
  { key: "openai",    name: "OpenAI",    icon: openaiIcon },
  { key: "deepseek",  name: "DeepSeek",  cnName: "深度求索", icon: deepseekIcon },
  { key: "google",    name: "Google Gemini", cnName: "谷歌", icon: geminiIcon },
  { key: "kimi",      name: "Kimi",      cnName: "月之暗面", icon: moonshotIcon },
  { key: "zai",       name: "智谱",       cnName: "Z.AI",    icon: zhipuIcon },
  { key: "minimax",   name: "MiniMax",   cnName: "稀宇科技", icon: minimaxIcon },
  { key: "qwen",      name: "通义千问",   cnName: "阿里云",   icon: qwenIcon },
  { key: "xiaomi",    name: "小米 MiMo", cnName: "小米",     icon: xiaomiIcon },
  { key: "xai",       name: "xAI",       cnName: "Grok",     icon: grokIcon },
  { key: "codex",     name: "OpenAI Codex", icon: openaiIcon },
  { key: "opencode",  name: "OpenCode",  cnName: "中转",     icon: opencodeIcon },
];

const BRAND_BY_KEY: Map<string, ProviderBrand> = new Map(BRANDS.map((b) => [b.key, b]));

/** pi provider id → 品牌(查找用;从 platform-presets 表的 brandKey 派生,唯一权威表) */
export const BRAND_BY_PI_ID: Map<string, ProviderBrand> = new Map(
  listPresets().flatMap((p) => {
    const brand = BRAND_BY_KEY.get(p.brandKey);
    return brand ? [[p.id, brand] as [string, ProviderBrand]] : [];
  }),
);

/** 下拉选项:value = pi id,label = 预设表显示名,icon = 品牌图标(无品牌则不显示) */
export function providerSelectOptions(): Array<{ value: string; label: string; icon?: string }> {
  return listPresets().map((p) => ({
    value: p.id,
    label: p.label,
    icon: BRAND_BY_KEY.get(p.brandKey)?.icon,
  }));
}
