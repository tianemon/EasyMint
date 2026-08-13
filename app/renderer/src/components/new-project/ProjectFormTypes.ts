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
  { value: "minimalism", label: "极简主义", desc: "大留白、干净直接，主流百搭（现代简约）" },
  { value: "flat", label: "扁平化", desc: "纯色块、清晰直观，SaaS/后台打底" },
  { value: "glass", label: "玻璃拟态", desc: "半透明磨砂、通透高级，适合浮层弹窗" },
  { value: "liquid-glass", label: "液态玻璃", desc: "动态折射光影，iOS 26 最新潮" },
  { value: "material", label: "Material Design", desc: "Google 设计语言，纸张层叠、阴影动效" },
  { value: "neumorphism", label: "新拟态", desc: "同色系柔和立体，开关/卡片适用" },
  { value: "claymorphism", label: "粘土拟态", desc: "圆润果冻、粉彩配色，可爱 Q 版" },
  { value: "skeuomorphism", label: "拟物化", desc: "模仿真实材质，熟悉亲切（皮革/金属/纸）" },
  { value: "business", label: "商务专业", desc: "白底蓝调、整齐栅格，B2B/企业标配" },
  { value: "luxury", label: "奢华高级", desc: "黑白金配色、极细线条，高端质感" },
  { value: "bento", label: "Bento 网格", desc: "圆角卡片模块化，信息面板/仪表盘" },
  { value: "colorful", label: "活力彩色", desc: "高饱和鲜艳、多巴胺，年轻有活力" },
  { value: "retro", label: "复古个性", desc: "复古撞色粗边框（Y2K/新野兽派），大胆有态度" },
  { value: "soft", label: "柔和治愈", desc: "低饱和大地色，温柔平静低焦虑" },
  { value: "editorial", label: "杂志编辑风", desc: "大标题大图、大胆留白，媒体/时尚" },
  { value: "dark", label: "暗黑酷炫", desc: "深色背景，沉浸有氛围" },
  { value: "tech", label: "科技感", desc: "暗色光效、3D 空间，未来感" },
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
  targets: ["web"],
  dir: useSettingsStore.getState().defaultProjectDir || "~/EasyMintProject",
  completeness: "mvp",
  features: [],
  uiStyle: "",
  techBudget: "少量",
  deployPlatform: "本地",
  aiIntegration: "none",
};
