import { create } from "zustand";
import type { ApiProvidersData } from "@shared/platform-presets";

interface SettingsState {
  evaluateMode: boolean;
  tddMode: boolean;
  screenshotVerification: boolean;
  defaultProjectDir: string;
  claudePath: string;
  claudeVersion: string;
  apiBaseUrl: string;
  apiKey: string;
  apiKeys: Record<string, string>;
  model: string;
  availableModels: string[];
  setupComplete: boolean;
  thinkingBudget: number;
  contextThreshold: number;
  context1M: boolean;
  showThinking: boolean;
  showToolUse: boolean;
  apiProviders: ApiProvidersData | null;
  setEvaluateMode: (enabled: boolean) => void;
  setTddMode: (enabled: boolean) => void;
  setScreenshotVerification: (enabled: boolean) => void;
  setDefaultProjectDir: (dir: string) => void;
  setApiBaseUrl: (url: string) => void;
  setApiKey: (key: string) => void;
  setModel: (model: string) => void;
  setAvailableModels: (models: string[]) => void;
  setThinkingBudget: (budget: number) => void;
  setContextThreshold: (pct: number) => void;
  setContext1M: (enabled: boolean) => void;
  setShowThinking: (enabled: boolean) => void;
  setShowToolUse: (enabled: boolean) => void;
  setApiProviders: (data: ApiProvidersData) => void;
  activateProvider: (providerId: string) => void;
  loadFromElectron: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  evaluateMode: false,
  tddMode: false,
  screenshotVerification: false,
  defaultProjectDir: "~/EasyMintProject",
  claudePath: "",
  claudeVersion: "",
  apiBaseUrl: "",
  apiKey: "",
  apiKeys: {},
  model: "",
  availableModels: [],
  apiProviders: null,

  setupComplete: false,
  thinkingBudget: 0,
  contextThreshold: 65,
  context1M: false,
  showThinking: false,
  showToolUse: false,

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
  setTddMode: (enabled) => {
    set({ tddMode: enabled });
    window.electronAPI?.settings?.set?.("tddMode", enabled);
  },
  setScreenshotVerification: (enabled) => {
    set({ screenshotVerification: enabled });
    window.electronAPI?.settings?.set?.("screenshotVerification", enabled);
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
  setThinkingBudget: (_budget) => {
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
          tddMode: settings.tddMode ?? false,
          screenshotVerification: settings.screenshotVerification ?? false,
          defaultProjectDir: settings.defaultProjectDir || "~/EasyMintProject",
          apiBaseUrl: settings.apiBaseUrl ?? "",
          apiKey: settings.apiKey ?? "",
          apiKeys: settings.apiKeys ?? {},
          model: settings.model ?? "",
          availableModels: settings.availableModels ?? [],
          thinkingBudget: 0,
          contextThreshold: settings.contextThreshold ?? 65,
          context1M: settings.context1M ?? false,
          showThinking: settings.showThinking ?? false,
          showToolUse: settings.showToolUse ?? false,
          setupComplete: settings.setupComplete ?? false,
          apiProviders: (settings.apiProviders as ApiProvidersData) ?? null,
        });
      }
    } catch { /* electronAPI unavailable */ }
    try {
      if (window.electronAPI?.claude?.detect) {
        const result = await window.electronAPI.claude.detect();
        if (result.found) {
          set({ claudePath: result.path ?? "", claudeVersion: result.version ?? "" });
        }
      }
    } catch { /* best-effort */ }
  },
}));
