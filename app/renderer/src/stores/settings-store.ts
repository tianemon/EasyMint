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
