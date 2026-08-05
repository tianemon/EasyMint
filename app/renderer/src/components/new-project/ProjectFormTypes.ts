import type { AIIntegration } from "../../../../shared/prompts";
import { useSettingsStore } from "../../stores/settings-store";

export type BudgetChoice = "充足" | "少量" | "免费";
export type DeployChoice = "云端" | "本地" | "混合";
export type CompletenessChoice = "full" | "mvp" | "demo";

export interface TechOption { value: string; label: string; desc: string }

export interface FeatureItem {
  name: string;
}

export interface ProjectFormData {
  name: string;
  targets: string[];
  dir: string;
  description: string;
  targetUsers: string;
  completeness: CompletenessChoice;
  features: FeatureItem[];
  uiStyle: string;
  techNotes: string;
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

export const FRONTEND_LANG_OPTIONS: TechOption[] = [
  { value: "typescript", label: "TypeScript", desc: "JavaScript 的超集，类型安全" },
  { value: "javascript", label: "JavaScript", desc: "Web 原生语言，无需编译" },
];

export const FRONTEND_FRAMEWORK_OPTIONS: TechOption[] = [
  { value: "react", label: "React", desc: "最主流的前端框架，生态最大" },
  { value: "vue", label: "Vue", desc: "渐进式框架，上手快，中文社区强" },
  { value: "svelte", label: "Svelte", desc: "编译时框架，打包极小，极致性能" },
  { value: "angular", label: "Angular", desc: "企业级框架，适合大型项目" },
  { value: "solidjs", label: "SolidJS", desc: "类 React 写法，无虚拟 DOM，超高性能" },
  { value: "none-fe", label: "纯 HTML（无框架）", desc: "零依赖，单文件即可，适合极简项目" },
];

export const BACKEND_LANG_OPTIONS: TechOption[] = [
  { value: "node", label: "Node.js", desc: "与前端同语言，全栈统一" },
  { value: "python", label: "Python", desc: "AI/ML 首选，开发速度快" },
  { value: "go", label: "Go", desc: "高性能微服务，部署简单" },
  { value: "php", label: "PHP", desc: "快速出活，部署便宜" },
  { value: "java", label: "Java", desc: "企业级标准，稳定可靠" },
];

export const BACKEND_FRAMEWORK_OPTIONS: TechOption[] = [
  { value: "express", label: "Express", desc: "Node.js 最流行的 HTTP 框架" },
  { value: "nestjs", label: "NestJS", desc: "企业级 Node.js 框架，类 Angular 架构" },
  { value: "fastapi", label: "FastAPI", desc: "高性能 Python API 框架" },
  { value: "django", label: "Django", desc: "Python 全栈框架，自带 ORM 和后台" },
  { value: "gin", label: "Gin", desc: "Go 高性能 HTTP 框架" },
  { value: "laravel", label: "Laravel", desc: "PHP 全栈框架，生态成熟" },
  { value: "spring", label: "Spring Boot", desc: "Java 企业级框架" },
];

export const CROSS_PLATFORM_OPTIONS: TechOption[] = [
  { value: "flutter", label: "Flutter", desc: "Google 的跨平台框架，Dart 语言，移动/Web/桌面" },
  { value: "react-native", label: "React Native", desc: "Facebook 的跨平台框架，React 语法，移动端为主" },
  { value: "electron", label: "Electron", desc: "Web 技术构建桌面应用（Windows/macOS/Linux）" },
  { value: "tauri", label: "Tauri", desc: "Rust 驱动的轻量桌面应用框架" },
  { value: "uniapp", label: "uni-app", desc: "Vue 语法，一套代码多端发布，国内生态成熟" },
  { value: "kotlin-mp", label: "Kotlin Multiplatform", desc: "JetBrains 跨平台方案，Android/iOS/桌面" },
];

export const UI_STYLE_OPTIONS = [
  { value: "skeuomorphism", label: "拟物化", desc: "模仿现实物体的质感与纹理，让用户感到熟悉、亲切" },
  { value: "flat", label: "扁平化", desc: "简洁、二维、无阴影和纹理，强调内容本身" },
  { value: "material", label: "Material Design", desc: "通过层级、阴影和动画模拟纸张与墨水的物理世界" },
  { value: "neumorphism", label: "新拟态", desc: "用精致的内外阴影模拟浮雕或嵌入的立体效果" },
  { value: "glassmorphism", label: "玻璃拟态", desc: "模拟磨砂玻璃质感，透明度和背景模糊创造层次感" },
  { value: "claymorphism", label: "粘土拟态", desc: "3D Q版风格，明亮色彩、圆润边角和厚实阴影" },
  { value: "liquid-glass", label: "液态玻璃", desc: "动态的玻璃拟态，光线折射与流动效果" },
  { value: "neo-brutalism", label: "新粗野主义", desc: "粗重边框、强烈对比色、大胆排版，极具视觉冲击力" },
  { value: "minimalism", label: "极简主义", desc: "大量留白、无装饰排版、有限配色，只保留核心元素" },
  { value: "bauhaus", label: "包豪斯", desc: "几何形状与红黄蓝三原色，形式服务于功能" },
  { value: "retrofuturism", label: "复古未来主义", desc: "混合赛博朋克、霓虹灯、蒸汽波，用复古视角想象未来" },
  { value: "brutalism", label: "粗野主义", desc: "结构外露、放弃装饰，纯粹功能性呈现，原始而极致" },
  { value: "anti-design", label: "反设计", desc: "混乱、不和谐、朋克风，挑战传统美学与可用性规则" },
  { value: "acid-graphics", label: "酸性设计", desc: "高饱和度、液态金属感、迷幻几何，视觉冲击力极强" },
] as const;

export const BUDGET_OPTIONS = [
  { value: "充足", label: "充足", desc: "优先效果与体验" },
  { value: "少量", label: "少量", desc: "控制成本，适量付费" },
  { value: "免费", label: "免费", desc: "仅使用免费/开源方案" },
] as const;

export const ALL_STEPS = [
  { number: 1, title: "项目概述", desc: "名称、类型与目录" },
  { number: 2, title: "功能清单", desc: "用户实际使用的功能" },
  { number: 3, title: "视觉风格", desc: "UI 设计风格" },
  { number: 4, title: "技术选型", desc: "技术栈、部署与成本" },
];

export const DEFAULT_DATA: ProjectFormData = {
  name: "",
  targets: ["web"],
  dir: useSettingsStore.getState().defaultProjectDir || "~/EasyMintProject",
  description: "",
  targetUsers: "",
  completeness: "mvp",
  features: [],
  uiStyle: "",
  techNotes: "",
  techBudget: "少量",
  deployPlatform: "本地",
  aiIntegration: "none",
};
