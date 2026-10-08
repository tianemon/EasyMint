import { uiText } from "./i18n";
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
// GitHub 官方 mark（Proma 的 assets/models/github.svg，同一份来源）。
// 注意：Copilot 有自己的 visor 标，这里用的是 GitHub 品牌标——与 Proma 的处理一致（它也只挂 github.svg）
import githubCopilotIcon from "../assets/providers/github-copilot.svg";
// OpenRouter 官方 wordmark 的**图标部分**（用户提供的 openrouter-light.svg 裁出）：
// 原图是 1607×294 的横版（图标 + 文字），这里只保留左侧紫色 glyph（#7624F4）并按实测 bbox
// 收成 395×395 的正方形 viewBox（内容占 92.6% 宽，与 deepseek 94.5% / claude 89.5% 同一惯例）
import openrouterIcon from "../assets/providers/openrouter.svg";
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

/** 供应商品牌表（与 Proma 重叠的品牌能提供图标；缺图标的条目只提供名称，列表里空白占位） */
const BRANDS: ProviderBrand[] = [
  { key: "anthropic", name: "Anthropic", cnName: "Claude", icon: claudeIcon },
  { key: "openai",    name: "OpenAI",    icon: openaiIcon },
  { key: "deepseek",  name: "DeepSeek",  get cnName() { return uiText("ui.provider-brands.deepseek"); }, icon: deepseekIcon },
  { key: "google",    name: "Google Gemini", get cnName() { return uiText("ui.provider-brands.google"); }, icon: geminiIcon },
  { key: "kimi",      name: "Kimi",      get cnName() { return uiText("ui.provider-brands.moonshotAi"); }, icon: moonshotIcon },
  { key: "zai",       get name() { return uiText("ui.provider-brands.zhipu"); },       cnName: "Z.AI",    icon: zhipuIcon },
  { key: "minimax",   name: "MiniMax",   get cnName() { return uiText("ui.provider-brands.minimax"); }, icon: minimaxIcon },
  { key: "qwen",      get name() { return uiText("ui.provider-brands.qwen"); },   get cnName() { return uiText("ui.provider-brands.alibabaCloud"); },   icon: qwenIcon },
  { key: "xiaomi",    get name() { return uiText("ui.provider-brands.xiaomiMimo"); }, get cnName() { return uiText("ui.provider-brands.xiaomi"); },     icon: xiaomiIcon },
  { key: "xai",       name: "xAI",       cnName: "Grok",     icon: grokIcon },
  { key: "codex",     name: "OpenAI Codex", icon: openaiIcon },
  { key: "opencode",  name: "OpenCode",  get cnName() { return uiText("ui.provider-brands.gateway"); },     icon: opencodeIcon },
  // GitHub Copilot 用 GitHub 品牌标（与 Proma 同一份处理）；OpenRouter 用官方 glyph 裁出的方图
  { key: "githubcopilot", name: "GitHub Copilot", icon: githubCopilotIcon },
  { key: "openrouter",    name: "OpenRouter",     icon: openrouterIcon },
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
