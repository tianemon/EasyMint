import type { AIIntegration } from "../../../../shared/prompts";
import { useSettingsStore } from "../../stores/settings-store";

export type BudgetChoice = "充足" | "少量" | "免费";
export type DeployChoice = "云端" | "本地" | "混合";
export type CompletenessChoice = "full" | "mvp" | "demo";
export type SceneChoice = "practical" | "commercial" | "validation" | "interest" | "learning" | "experiment" | "unknown";

export interface FeatureItem {
  name: string;
}

export interface ProjectFormData {
  name: string;
  description: string;
  scene: SceneChoice;
  targetUsers: string;
  targets: string[];
  dir: string;
  completeness: CompletenessChoice;
  features: FeatureItem[];
  uiStyle: string;
  techBudget: BudgetChoice;
  deployPlatform: DeployChoice;
  aiIntegration: AIIntegration;
}

export const TARGET_OPTIONS = [
  { value: "web", label: "Web 网页", desc: "浏览器访问，不限设备" },
  { value: "wechat-miniprogram", label: "微信小程序", desc: "微信内运行，即用即走" },
  { value: "ios-mobile", label: "iOS 移动 App", desc: "iPhone / iPad 原生应用" },
  { value: "android-mobile", label: "Android 移动 App", desc: "Android 手机/平板原生应用" },
  { value: "windows-desktop", label: "Windows 桌面应用", desc: "Windows 原生桌面应用" },
  { value: "macos-desktop", label: "macOS 桌面应用", desc: "Mac 原生桌面应用" },
  { value: "linux-desktop", label: "Linux 桌面应用", desc: "Linux 原生桌面应用" },
  { value: "cli", label: "命令行工具", desc: "跨平台终端工具" },
] as const;

export const SCENE_OPTIONS = [
  { value: "practical", label: "自己/团队用，要真的能用", desc: "实际使用" },
  { value: "commercial", label: "做成产品上线/卖钱", desc: "商业交付" },
  { value: "validation", label: "先做个能看的，验证想法", desc: "想法验证" },
  { value: "interest", label: "做着玩、探索兴趣", desc: "兴趣创作" },
  { value: "learning", label: "边学边做，练 AI 编程", desc: "学习实践" },
  { value: "experiment", label: "测某项技术能不能用", desc: "技术实验" },
  { value: "unknown", label: "没想好，由AI自己判断", desc: "Mint 对话感知" },
] as const;

export const COMPLETENESS_OPTIONS = [
  { value: "full", label: "完整版", desc: "功能完备，可直接上线" },
  { value: "mvp", label: "MVP", desc: "最小可行产品，验证核心想法" },
  { value: "demo", label: "演示版", desc: "原型展示，核心流程可跑通" },
] as const;

export const UI_STYLE_OPTIONS = [
  { value: "modern", label: "现代简约", desc: "白底卡片，干净直接" },
  { value: "colorful", label: "活力彩色", desc: "鲜艳渐变，年轻有活力" },
  { value: "business", label: "商务专业", desc: "深色克制，稳重" },
  { value: "tech", label: "科技感", desc: "暗色光效，未来感" },
  { value: "custom", label: "自定义", desc: "自己描述想要的样子" },
] as const;

export const BUDGET_OPTIONS = [
  { value: "充足", label: "充足", desc: "优先效果与体验" },
  { value: "少量", label: "少量", desc: "控制成本，适量付费" },
  { value: "免费", label: "免费", desc: "仅使用免费/开源方案" },
] as const;

export const ALL_STEPS = [
  { number: 1, title: "基本信息", desc: "名称、描述、场景与用户" },
  { number: 2, title: "功能清单", desc: "核心功能（可让 Mint 推荐）" },
  { number: 3, title: "UI 风格", desc: "界面风格（白话选，可让 Mint 推荐）" },
  { number: 4, title: "交付方式", desc: "完成度、部署、AI 与成本" },
];

export const DEFAULT_DATA: ProjectFormData = {
  name: "",
  description: "",
  scene: "unknown",
  targetUsers: "",
  targets: ["web"],
  dir: useSettingsStore.getState().defaultProjectDir || "~/EasyMintProject",
  completeness: "mvp",
  features: [],
  uiStyle: "",
  techBudget: "少量",
  deployPlatform: "本地",
  aiIntegration: "none",
};
