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
  apiProviders: ApiProvidersData | null;
  // ── 需求 1:默认 + 兜底模型 ──
  defaultProvider: string;
  defaultModel: string;
  fallbackProvider: string;
  fallbackModel: string;
  subagentDefaultModel: string;
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
  setApiProviders: (data: ApiProvidersData) => void;
  activateProvider: (providerId: string) => void;
  setDefaultProvider: (v: string) => void;
  setDefaultModel: (v: string) => void;
  setFallbackProvider: (v: string) => void;
  setFallbackModel: (v: string) => void;
  setSubagentDefaultModel: (v: string) => void;
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
  defaultProvider: "",
  defaultModel: "",
  fallbackProvider: "",
  fallbackModel: "",
  subagentDefaultModel: "",
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
  setDefaultProvider: (v: string) => { set({ defaultProvider: v }); window.electronAPI?.settings?.set?.("defaultProvider", v); },
  setDefaultModel: (v: string) => { set({ defaultModel: v }); window.electronAPI?.settings?.set?.("defaultModel", v); },
  setFallbackProvider: (v: string) => { set({ fallbackProvider: v }); window.electronAPI?.settings?.set?.("fallbackProvider", v); },
  setFallbackModel: (v: string) => { set({ fallbackModel: v }); window.electronAPI?.settings?.set?.("fallbackModel", v); },
  setSubagentDefaultModel: (v: string) => { set({ subagentDefaultModel: v }); window.electronAPI?.settings?.set?.("subagentDefaultModel", v); },
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
          setupComplete: settings.setupComplete ?? false,
          apiProviders: (settings.apiProviders as ApiProvidersData) ?? null,
          defaultProvider: settings.defaultProvider ?? "",
          defaultModel: settings.defaultModel ?? "",
          fallbackProvider: settings.fallbackProvider ?? "",
          fallbackModel: settings.fallbackModel ?? "",
          subagentDefaultModel: settings.subagentDefaultModel ?? "",
          maxGroupAgents: settings.maxGroupAgents ?? 3,
          groupForwardStrategy: settings.groupForwardStrategy ?? "conclusion",
          groupInjectMode: settings.groupInjectMode ?? "followUp",
          maxForwardDepth: settings.maxForwardDepth ?? 3,
          groupPresets: settings.groupPresets ?? [],
        });
      }
    } catch { /* electronAPI unavailable */ }
  },
}));
