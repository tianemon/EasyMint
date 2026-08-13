import type { AIIntegration } from "../../../../shared/prompts";
import { useSettingsStore } from "../../stores/settings-store";

export type BudgetChoice = "充足" | "少量" | "免费";
export type DeployChoice = "云端" | "本地" | "混合";
export type CompletenessChoice = "full" | "mvp" | "demo";

export interface ProjectFormData {
  name: string;
  targets: string[];
  dir: string;
  completeness: CompletenessChoice;
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

export const COMPLETENESS_OPTIONS = [
  { value: "full", label: "完整版", desc: "功能完备，可直接上线" },
  { value: "mvp", label: "MVP", desc: "最小可行产品，验证核心想法" },
  { value: "demo", label: "演示版", desc: "原型展示，核心流程可跑通" },
] as const;

export const BUDGET_OPTIONS = [
  { value: "充足", label: "充足", desc: "优先效果与体验" },
  { value: "少量", label: "少量", desc: "控制成本，适量付费" },
  { value: "免费", label: "免费", desc: "仅使用免费/开源方案" },
] as const;

export const ALL_STEPS = [
  { number: 1, title: "基本信息", desc: "名称、类型与目录" },
  { number: 2, title: "交付方式", desc: "部署、AI 与成本" },
];

export const DEFAULT_DATA: ProjectFormData = {
  name: "",
  targets: ["web"],
  dir: useSettingsStore.getState().defaultProjectDir || "~/EasyMintProject",
  completeness: "mvp",
  techBudget: "少量",
  deployPlatform: "本地",
  aiIntegration: "none",
};
