import { create } from "zustand";
import type { ApiProvidersData } from "@shared/platform-presets";

interface SettingsState {
  evaluateMode: boolean;
  defaultProjectDir: string;
  apiBaseUrl: string;
  apiKey: string;
  apiKeys: Record<string, string>;
  model: string;
  availableModels: string[];
  setupComplete: boolean;
  contextThreshold: number;
  context1M: boolean;
  showThinking: boolean;
  showToolUse: boolean;
  /** 全局聊天思考等级(新聊天会话初始默认,不控制 agent/task) */
  chatThinkingLevel: string;
  /** 聊天字号级别(1-6,默认 3):整体控制会话列表/气泡/思考工具的字体大小 */
  chatFontLevel: number;
  /** 状态指示光效:输入卡片光效预设 */
  glowEffect: "orbit" | "slide" | "breathe" | "off";
  /** 光效颜色(亮色模式) */
  glowColorLight: string;
  /** 光效颜色(暗色模式) */
  glowColorDark: string;
  /** Mint 状态文本样式:单色/流光 */
  statusTextStyle: "solid" | "shimmer";
  /** 流光色彩组合(有序) */
  statusTextColors: string[];
  apiProviders: ApiProvidersData | null;
  // ── 需求 4:群聊配置 ──
  maxGroupAgents: number;
  groupForwardStrategy: "all" | "conclusion";
  groupInjectMode: "steer" | "followUp";
  maxForwardDepth: number;
  groupPresets: Array<{ id: string; name: string; templateIds: string[] }>;
  setEvaluateMode: (enabled: boolean) => void;
  setDefaultProjectDir: (dir: string) => void;
  setApiBaseUrl: (url: string) => void;
  setApiKey: (key: string) => void;
  setModel: (model: string) => void;
  setAvailableModels: (models: string[]) => void;
  setContextThreshold: (pct: number) => void;
  setContext1M: (enabled: boolean) => void;
  setShowThinking: (enabled: boolean) => void;
  setShowToolUse: (enabled: boolean) => void;
  setChatThinkingLevel: (level: string) => void;
  setChatFontLevel: (level: number) => void;
  setGlowEffect: (v: "orbit" | "slide" | "breathe" | "off") => void;
  setGlowColorLight: (v: string) => void;
  setGlowColorDark: (v: string) => void;
  setStatusTextStyle: (v: "solid" | "shimmer") => void;
  setStatusTextColors: (v: string[]) => void;
  setApiProviders: (data: ApiProvidersData) => void;
  activateProvider: (providerId: string) => void;
  setMaxGroupAgents: (v: number) => void;
  setGroupForwardStrategy: (v: "all" | "conclusion") => void;
  setGroupInjectMode: (v: "steer" | "followUp") => void;
  setMaxForwardDepth: (v: number) => void;
  setGroupPresets: (v: Array<{ id: string; name: string; templateIds: string[] }>) => void;
  loadFromElectron: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  evaluateMode: false,
  defaultProjectDir: "~/EasyMintProject",
  apiBaseUrl: "",
  apiKey: "",
  apiKeys: {},
  model: "",
  availableModels: [],
  apiProviders: null,

  setupComplete: false,
  contextThreshold: 75,
  context1M: false,
  showThinking: false,
  showToolUse: false,
  chatThinkingLevel: "medium",
  chatFontLevel: 3,
  glowEffect: "orbit",
  glowColorLight: "#16a34a",
  glowColorDark: "#4ade80",
  statusTextStyle: "shimmer",
  statusTextColors: ["#22c55e", "#3b82f6", "#a855f7"],
  maxGroupAgents: 3,
  groupForwardStrategy: "conclusion",
  groupInjectMode: "followUp",
  maxForwardDepth: 3,
  groupPresets: [
    { id: "dev-trio", name: "开发三人组", templateIds: ["mint", "default-builder", "default-evaluator"] },
    { id: "design-duo", name: "设计协作", templateIds: ["mint", "mint-designer"] },
  ],

  setModel: (model: string) => {
    set({ model });
    window.electronAPI?.settings?.set?.("model", model);
  },
  setAvailableModels: (availableModels: string[]) => {
    set({ availableModels });
    window.electronAPI?.settings?.set?.("availableModels", availableModels);
  },

  setEvaluateMode: (enabled) => {
    set({ evaluateMode: enabled });
    window.electronAPI?.settings?.set?.("evaluateMode", enabled);
    if (window.electronAPI?.evaluator?.setEnabled) {
      window.electronAPI.evaluator.setEnabled(enabled);
    }
  },
  setDefaultProjectDir: (dir) => {
    set({ defaultProjectDir: dir });
    window.electronAPI?.settings?.set?.("defaultProjectDir", dir);
  },
  setApiBaseUrl: (url) => {
    set({ apiBaseUrl: url });
    window.electronAPI?.settings?.set?.("apiBaseUrl", url);
  },
  setApiKey: (key) => {
    set({ apiKey: key });
    window.electronAPI?.settings?.set?.("apiKey", key);
  },
  setContextThreshold: (pct: number) => {
    set({ contextThreshold: pct });
    window.electronAPI?.settings?.set?.("contextThreshold", pct);
  },
  setContext1M: (enabled: boolean) => {
    set({ context1M: enabled });
    window.electronAPI?.settings?.set?.("context1M", enabled);
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
    document.documentElement.style.setProperty("--chat-bubble-size", `${base}px`);
    document.documentElement.style.setProperty("--chat-detail-size", `${detail}px`);
  },
  setGlowEffect: (v) => { set({ glowEffect: v }); window.electronAPI?.settings?.set?.("glowEffect", v); },
  setGlowColorLight: (v) => { set({ glowColorLight: v }); window.electronAPI?.settings?.set?.("glowColorLight", v); },
  setGlowColorDark: (v) => { set({ glowColorDark: v }); window.electronAPI?.settings?.set?.("glowColorDark", v); },
  setStatusTextStyle: (v) => { set({ statusTextStyle: v }); window.electronAPI?.settings?.set?.("statusTextStyle", v); },
  setStatusTextColors: (v) => { set({ statusTextColors: v }); window.electronAPI?.settings?.set?.("statusTextColors", v); },
  setMaxGroupAgents: (v: number) => { set({ maxGroupAgents: v }); window.electronAPI?.settings?.set?.("maxGroupAgents", v); },
  setGroupForwardStrategy: (v: "all" | "conclusion") => { set({ groupForwardStrategy: v }); window.electronAPI?.settings?.set?.("groupForwardStrategy", v); },
  setGroupInjectMode: (v: "steer" | "followUp") => { set({ groupInjectMode: v }); window.electronAPI?.settings?.set?.("groupInjectMode", v); },
  setMaxForwardDepth: (v: number) => { set({ maxForwardDepth: v }); window.electronAPI?.settings?.set?.("maxForwardDepth", v); },
  setGroupPresets: (v: Array<{ id: string; name: string; templateIds: string[] }>) => { set({ groupPresets: v }); window.electronAPI?.settings?.set?.("groupPresets", v); },

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
  },

  loadFromElectron: async () => {
    try {
      if (window.electronAPI?.settings?.get) {
        const settings = await window.electronAPI.settings.get();
        set({
          evaluateMode: settings.evaluateMode ?? false,
          defaultProjectDir: settings.defaultProjectDir || "~/EasyMintProject",
          apiBaseUrl: settings.apiBaseUrl ?? "",
          apiKey: settings.apiKey ?? "",
          apiKeys: settings.apiKeys ?? {},
          model: settings.model ?? "",
          availableModels: settings.availableModels ?? [],
          contextThreshold: settings.contextThreshold ?? 75,
          context1M: settings.context1M ?? false,
          showThinking: settings.showThinking ?? false,
          showToolUse: settings.showToolUse ?? false,
          chatThinkingLevel: settings.chatThinkingLevel ?? "medium",
          chatFontLevel: settings.chatFontLevel ?? 3,
          glowEffect: (settings.glowEffect as "orbit" | "slide" | "breathe" | "off") ?? "orbit",
          glowColorLight: settings.glowColorLight ?? "#16a34a",
          glowColorDark: settings.glowColorDark ?? "#4ade80",
          statusTextStyle: (settings.statusTextStyle as "solid" | "shimmer") ?? "shimmer",
          statusTextColors: settings.statusTextColors ?? ["#22c55e", "#3b82f6", "#a855f7"],
          setupComplete: settings.setupComplete ?? false,
          apiProviders: (settings.apiProviders as ApiProvidersData) ?? null,
          maxGroupAgents: settings.maxGroupAgents ?? 3,          groupForwardStrategy: settings.groupForwardStrategy ?? "conclusion",
          groupInjectMode: settings.groupInjectMode ?? "followUp",
          maxForwardDepth: settings.maxForwardDepth ?? 3,
          groupPresets: settings.groupPresets ?? [],
        });
      }
    } catch { /* electronAPI unavailable */ }
  },
}));
