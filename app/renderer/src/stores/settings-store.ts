import { create } from "zustand";
import type { ApiProvidersData } from "@shared/platform-presets";
import { useTabStore } from "./tab-store";

/** 多色流光分组:一组命名色彩组合 */
export interface GlowColorGroup {
  id: string;
  name: string;
  colors: string[];
  /** 内置默认组标记(不可删除) */
  isBuiltin?: boolean;
}

/** 内置默认组 id(亮/暗各一) */
export const BUILTIN_GLOW_GROUP_LIGHT_ID = "glow-builtin-light";
export const BUILTIN_GLOW_GROUP_DARK_ID = "glow-builtin-dark";
/** 内置默认状态流光组 id(亮/暗各一) */
export const BUILTIN_STATUS_GROUP_LIGHT_ID = "status-builtin-light";
export const BUILTIN_STATUS_GROUP_DARK_ID = "status-builtin-dark";

/** 生成分组 id(时间戳,够用且唯一) */
export function newGlowGroupId(): string {
  return `g${Date.now()}`;
}

/** 内置默认光效组(代码常量,不落盘;原状态栏流光配色,光效功能前方案) */
export const BUILTIN_GLOW_GROUPS = {
  light: { id: BUILTIN_GLOW_GROUP_LIGHT_ID, name: "默认", colors: ["#16a34a", "#22c55e", "#eab308", "#facc15", "#4ade80"], isBuiltin: true },
  dark: { id: BUILTIN_GLOW_GROUP_DARK_ID, name: "默认", colors: ["#818cf8", "#a78bfa", "#f472b6", "#c084fc", "#6366f1"], isBuiltin: true },
} as const satisfies Record<string, GlowColorGroup>;

/** 内置默认状态流光组(代码常量,不落盘) */
export const BUILTIN_STATUS_GROUPS = {
  light: { id: BUILTIN_STATUS_GROUP_LIGHT_ID, name: "默认", colors: ["#16a34a", "#22c55e", "#eab308", "#facc15", "#4ade80"], isBuiltin: true },
  dark: { id: BUILTIN_STATUS_GROUP_DARK_ID, name: "默认", colors: ["#818cf8", "#a78bfa", "#f472b6", "#c084fc", "#6366f1"], isBuiltin: true },
} as const satisfies Record<string, GlowColorGroup>;

/** 第一版环绕流光配色(自定义 1 预置组):亮=主题绿 #16a34a / 暗=浅灰 #cccccc(旧暗色 accent,黑灰科技感) */
export const V1_GLOW_GROUPS = {
  light: { id: "glow-custom-v1", name: "自定义 1", colors: ["#16a34a"] },
  dark: { id: "glow-custom-v1-dark", name: "自定义 1", colors: ["#cccccc"] },
} as const satisfies Record<string, GlowColorGroup>;

interface SettingsState {
  defaultProjectDir: string;
  model: string;
  availableModels: string[];
  setupComplete: boolean;
  contextThreshold: number;
  showThinking: boolean;
  showToolUse: boolean;
  /** 全局聊天思考等级(新聊天会话初始默认,不控制 agent/task) */
  chatThinkingLevel: string;
  /** 聊天字号级别(1-6,默认 3):整体控制会话列表/气泡/思考工具的字体大小 */
  chatFontLevel: number;
  /** 状态指示光效:输入卡片光效预设 */
  glowEffect: "orbit" | "slide" | "breathe" | "off";
  /** 光效颜色模式:单色(solid)/多色(multi) */
  glowColorMode: "solid" | "multi";
  /** 光效单色(亮色模式) */
  glowColorLight: string;
  /** 光效单色(暗色模式) */
  glowColorDark: string;
  /** 多色流光分组(亮色模式;最多 5 组,单次启用一组) */
  glowGroupsLight: GlowColorGroup[];
  /** 多色流光分组(暗色模式) */
  glowGroupsDark: GlowColorGroup[];
  /** 当前启用的流光分组 id(亮色模式) */
  activeGlowGroupLight: string;
  /** 当前启用的流光分组 id(暗色模式) */
  activeGlowGroupDark: string;
  /** Mint 状态文本样式:单色/流光 */
  statusTextStyle: "solid" | "shimmer";
  /** Mint 状态文本单色(亮色模式,与光效色独立) */
  statusColorLight: string;
  /** Mint 状态文本单色(暗色模式) */
  statusColorDark: string;
  /** 状态流光分组(亮色模式;内置「默认」不可删 + 自定义 ≤4) */
  statusTextGroupsLight: GlowColorGroup[];
  /** 状态流光分组(暗色模式) */
  statusTextGroupsDark: GlowColorGroup[];
  /** 当前启用的状态流光分组 id(亮色模式) */
  activeStatusGroupLight: string;
  /** 当前启用的状态流光分组 id(暗色模式) */
  activeStatusGroupDark: string;
  apiProviders: ApiProvidersData | null;
  setDefaultProjectDir: (dir: string) => void;
  setModel: (model: string) => void;
  setContextThreshold: (pct: number) => void;
  setShowThinking: (enabled: boolean) => void;
  setShowToolUse: (enabled: boolean) => void;
  setChatThinkingLevel: (level: string) => void;
  setChatFontLevel: (level: number) => void;
  setGlowEffect: (v: "orbit" | "slide" | "breathe" | "off") => void;
  setGlowColorMode: (v: "solid" | "multi") => void;
  setGlowColorLight: (v: string) => void;
  setGlowColorDark: (v: string) => void;
  setGlowGroupsLight: (v: GlowColorGroup[]) => void;
  setGlowGroupsDark: (v: GlowColorGroup[]) => void;
  setActiveGlowGroupLight: (v: string) => void;
  setActiveGlowGroupDark: (v: string) => void;
  setStatusTextStyle: (v: "solid" | "shimmer") => void;
  setStatusColorLight: (v: string) => void;
  setStatusColorDark: (v: string) => void;
  setStatusTextGroupsLight: (v: GlowColorGroup[]) => void;
  setStatusTextGroupsDark: (v: GlowColorGroup[]) => void;
  setActiveStatusGroupLight: (v: string) => void;
  setActiveStatusGroupDark: (v: string) => void;
  setApiProviders: (data: ApiProvidersData) => void;
  activateProvider: (providerId: string) => void;
  loadFromElectron: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  defaultProjectDir: "~/EasyMintProject",
  model: "",
  availableModels: [],
  apiProviders: null,

  setupComplete: false,
  contextThreshold: 75,
  showThinking: false,
  showToolUse: false,
  chatThinkingLevel: "medium",
  chatFontLevel: 3,
  glowEffect: "orbit",
  glowColorMode: "multi",
  glowColorLight: "#16a34a",
  glowColorDark: "#4ade80",
  glowGroupsLight: [BUILTIN_GLOW_GROUPS.light, V1_GLOW_GROUPS.light],
  glowGroupsDark: [BUILTIN_GLOW_GROUPS.dark, V1_GLOW_GROUPS.dark],
  activeGlowGroupLight: BUILTIN_GLOW_GROUP_LIGHT_ID,
  activeGlowGroupDark: BUILTIN_GLOW_GROUP_DARK_ID,
  statusTextStyle: "shimmer",
  statusColorLight: "#16a34a",
  statusColorDark: "#4ade80",
  statusTextGroupsLight: [BUILTIN_STATUS_GROUPS.light],
  statusTextGroupsDark: [BUILTIN_STATUS_GROUPS.dark],
  activeStatusGroupLight: BUILTIN_STATUS_GROUP_LIGHT_ID,
  activeStatusGroupDark: BUILTIN_STATUS_GROUP_DARK_ID,

  setModel: (model: string) => {
    set({ model });
    window.electronAPI?.settings?.set?.("model", model);
  },
  setDefaultProjectDir: (dir) => {
    set({ defaultProjectDir: dir });
    window.electronAPI?.settings?.set?.("defaultProjectDir", dir);
  },
  setContextThreshold: (pct: number) => {
    set({ contextThreshold: pct });
    window.electronAPI?.settings?.set?.("contextThreshold", pct);
  },
  setShowThinking: (enabled: boolean) => {
    set({ showThinking: enabled });
    window.electronAPI?.settings?.set?.("showThinking", enabled);
  },
  setShowToolUse: (enabled: boolean) => {
    set({ showToolUse: enabled });
    window.electronAPI?.settings?.set?.("showToolUse", enabled);
  },
  setChatThinkingLevel: (level: string) => {
    set({ chatThinkingLevel: level });
    window.electronAPI?.settings?.set?.("chatThinkingLevel", level);
  },
  setChatFontLevel: (level: number) => {
    set({ chatFontLevel: level });
    window.electronAPI?.settings?.set?.("chatFontLevel", level);
    // 级别表:1-6 → 基准 px(连续,默认第3级=14px);会话列表/气泡 = 基准,思考/工具 = 基准减 1 级
    const SCALE = [12, 13, 14, 15, 16, 17];
    const idx = Math.max(0, Math.min(5, level - 1));
    const base = SCALE[idx] ?? 14;
    const detail = SCALE[Math.max(0, idx - 1)] ?? 12;
    document.documentElement.style.setProperty("--chat-list-size", `${base}px`);
    document.documentElement.style.setProperty("--text-body", `${base}px`);
    document.documentElement.style.setProperty("--text-detail", `${detail}px`);
  },
  setGlowEffect: (v) => { set({ glowEffect: v }); window.electronAPI?.settings?.set?.("glowEffect", v); },
  setGlowColorMode: (v) => { set({ glowColorMode: v }); window.electronAPI?.settings?.set?.("glowColorMode", v); },
  setGlowColorLight: (v) => { set({ glowColorLight: v }); window.electronAPI?.settings?.set?.("glowColorLight", v); },
  setGlowColorDark: (v) => { set({ glowColorDark: v }); window.electronAPI?.settings?.set?.("glowColorDark", v); },
  setGlowGroupsLight: (v) => { set({ glowGroupsLight: v }); window.electronAPI?.settings?.set?.("glowGroupsLight", v); },
  setGlowGroupsDark: (v) => { set({ glowGroupsDark: v }); window.electronAPI?.settings?.set?.("glowGroupsDark", v); },
  setActiveGlowGroupLight: (v) => { set({ activeGlowGroupLight: v }); window.electronAPI?.settings?.set?.("activeGlowGroupLight", v); },
  setActiveGlowGroupDark: (v) => { set({ activeGlowGroupDark: v }); window.electronAPI?.settings?.set?.("activeGlowGroupDark", v); },
  setStatusTextStyle: (v) => { set({ statusTextStyle: v }); window.electronAPI?.settings?.set?.("statusTextStyle", v); },
  setStatusColorLight: (v) => { set({ statusColorLight: v }); window.electronAPI?.settings?.set?.("statusColorLight", v); },
  setStatusColorDark: (v) => { set({ statusColorDark: v }); window.electronAPI?.settings?.set?.("statusColorDark", v); },
  setStatusTextGroupsLight: (v) => { set({ statusTextGroupsLight: v }); window.electronAPI?.settings?.set?.("statusTextGroupsLight", v); },
  setStatusTextGroupsDark: (v) => { set({ statusTextGroupsDark: v }); window.electronAPI?.settings?.set?.("statusTextGroupsDark", v); },
  setActiveStatusGroupLight: (v) => { set({ activeStatusGroupLight: v }); window.electronAPI?.settings?.set?.("activeStatusGroupLight", v); },
  setActiveStatusGroupDark: (v) => { set({ activeStatusGroupDark: v }); window.electronAPI?.settings?.set?.("activeStatusGroupDark", v); },

  setApiProviders: (data: ApiProvidersData) => {
    // 同步激活供应商的模型信息到旧字段（ChatPanel 下拉引用）
    const activeId = data.current;
    const activeCfg = activeId ? data.configs[activeId] : undefined;
    const patch: Partial<SettingsState> = { apiProviders: data };
    if (activeCfg) {
      if (activeCfg.model) patch.model = activeCfg.model;
      if (activeCfg.models.length > 0) patch.availableModels = activeCfg.models;
    }
    set(patch);
    window.electronAPI?.settings?.set?.("apiProviders", data);
  },

  activateProvider: (providerId: string) => {
    const current = get().apiProviders;
    if (!current) return;
    const next: ApiProvidersData = { ...current, current: providerId };
    const activeCfg = next.configs[providerId];
    const patch: Partial<SettingsState> = { apiProviders: next };
    if (activeCfg) {
      if (activeCfg.model) patch.model = activeCfg.model;
      if (activeCfg.models.length > 0) patch.availableModels = activeCfg.models;
    }
    set(patch);
    window.electronAPI?.settings?.set?.("apiProviders", next);
    // 设置中切供应商 → 当前活跃会话同步热切(会话级绑定持久化到 session-cache,
    // 后续 resume 恢复绑定)。主进程 setModel 带 providerId 用指定供应商解析模型
    if (activeCfg?.model) {
      const { tabs, activeTabId } = useTabStore.getState();
      const tab = tabs.find((t) => t.id === activeTabId && t.type === "chat" && t.sessionId);
      if (tab?.sessionId) {
        window.electronAPI?.agent?.setModel?.(tab.sessionId, activeCfg.model, providerId).catch(() => {});
        window.electronAPI?.sessionCache?.write?.(tab.sessionId, { provider: providerId, model: activeCfg.model }).catch(() => {});
      }
    }
  },

  loadFromElectron: async () => {
    try {
      if (window.electronAPI?.settings?.get) {
        const settings = await window.electronAPI.settings.get();
        set({
          defaultProjectDir: settings.defaultProjectDir || "~/EasyMintProject",
          model: settings.model ?? "",
          availableModels: settings.availableModels ?? [],
          contextThreshold: settings.contextThreshold ?? 75,
          showThinking: settings.showThinking ?? false,
          showToolUse: settings.showToolUse ?? false,
          chatThinkingLevel: settings.chatThinkingLevel ?? "medium",
          chatFontLevel: settings.chatFontLevel ?? 3,
          glowEffect: (settings.glowEffect as "orbit" | "slide" | "breathe" | "off") ?? "orbit",
          glowColorMode: (settings.glowColorMode as "solid" | "multi") ?? "multi",
          glowColorLight: settings.glowColorLight ?? "#16a34a",
          glowColorDark: settings.glowColorDark ?? "#4ade80",
          // 分组由主进程合并(内置常量 + 文件自定义组),空则用内置兜底
          glowGroupsLight: settings.glowGroupsLight?.length ? settings.glowGroupsLight : [BUILTIN_GLOW_GROUPS.light, V1_GLOW_GROUPS.light],
          glowGroupsDark: settings.glowGroupsDark?.length ? settings.glowGroupsDark : [BUILTIN_GLOW_GROUPS.dark, V1_GLOW_GROUPS.dark],
          activeGlowGroupLight: settings.activeGlowGroupLight ?? BUILTIN_GLOW_GROUP_LIGHT_ID,
          activeGlowGroupDark: settings.activeGlowGroupDark ?? BUILTIN_GLOW_GROUP_DARK_ID,
          statusTextStyle: (settings.statusTextStyle as "solid" | "shimmer") ?? "shimmer",
          statusColorLight: settings.statusColorLight ?? "#16a34a",
          statusColorDark: settings.statusColorDark ?? "#4ade80",
          // 分组由主进程合并(内置常量 + 文件自定义组),空则用内置兜底
          statusTextGroupsLight: settings.statusTextGroupsLight?.length ? settings.statusTextGroupsLight : [BUILTIN_STATUS_GROUPS.light],
          statusTextGroupsDark: settings.statusTextGroupsDark?.length ? settings.statusTextGroupsDark : [BUILTIN_STATUS_GROUPS.dark],
          activeStatusGroupLight: settings.activeStatusGroupLight ?? BUILTIN_STATUS_GROUP_LIGHT_ID,
          activeStatusGroupDark: settings.activeStatusGroupDark ?? BUILTIN_STATUS_GROUP_DARK_ID,
          setupComplete: settings.setupComplete ?? false,
          apiProviders: (settings.apiProviders as ApiProvidersData) ?? null,
        });
      }
    } catch { /* electronAPI unavailable */ }
  },
}));
