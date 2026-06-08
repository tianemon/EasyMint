import { create } from "zustand";

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
  loadFromElectron: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
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

  setupComplete: false,
  thinkingBudget: 0,
  contextThreshold: 60,
  context1M: false,
  showThinking: true,
  showToolUse: true,

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
  setThinkingBudget: (budget) => {
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
          contextThreshold: settings.contextThreshold ?? 60,
          context1M: settings.context1M ?? false,
          showThinking: settings.showThinking ?? true,
          showToolUse: settings.showToolUse ?? true,
          setupComplete: settings.setupComplete ?? false,
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
