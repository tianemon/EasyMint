import { create } from "zustand";
import type { ApiProvidersData } from "@shared/platform-presets";

export interface SlashCommandInfo {
  name: string;
  description: string;
  argumentHint: string;
  aliases?: string[];
}

/** 命令中文翻译 — 基于 SDK supportedCommands() 实际返回的 24 条命令，未命中保留英文原文 */
const ZH_DESC: Record<string, string> = {
  // 会话管理
  compact: "智能压缩上下文",
  clear: "清空对话历史",
  context: "可视化上下文用量",
  goal: "设定完成条件",
  // 项目知识
  init: "初始化项目 CLAUDE.md",
  "reload-skills": "重新扫描 Skills 目录",
  // 配置
  "update-config": "配置 Claude Code 设置",
  "fewer-permission-prompts": "分析工具调用并添加白名单以减少权限弹窗",
  // 用量
  usage: "查看用量面板",
  // 审查与分析
  "code-review": "审查代码变更（正确性 + 简洁性）",
  review: "代码审查（已废弃，推荐 /code-review）",
  "security-review": "安全审计",
  simplify: "审查并简化代码变更",
  debug: "启用调试日志",
  verify: "验证代码变更是否生效",
  // 协作与任务
  insights: "生成会话分析报告",
  "team-onboarding": "生成团队成员上手指南",
  // 帮助
  "claude-api": "Claude API 参考",
  // 自动化
  loop: "动态循环模式",
  batch: "批量执行任务",
  run: "运行命令",
  "deep-research": "深度研究——多渠道搜索、交叉验证、生成引用报告",
  // Skills
  "run-skill-generator": "生成新的 Skill",
  heapdump: "生成堆转储用于内存诊断",
};

const ZH_HINT: Record<string, string> = {
  compact: "[指令]",
  goal: "<描述>",
  debug: "[问题描述]",
  "code-review": "[low|medium|high|xhigh|max] [--fix] [--comment] [<目标>]",
  review: "[目标]",
  "security-review": "[目标]",
  simplify: "[目标]",
  verify: "[目标]",
  run: "<命令>",
  batch: "<描述>",
  insights: "[范围]",
  "team-onboarding": "[团队成员角色]",
};

/** 命令分类顺序 — 基于 SDK supportedCommands() 实际返回，未匹配的命令自动归入"其他" */
export const COMMAND_CATEGORIES: { key: string; label: string; names: string[] }[] = [
  { key: "session", label: "会话管理", names: ["compact", "clear", "context", "goal"] },
  { key: "knowledge", label: "项目知识", names: ["init", "reload-skills"] },
  { key: "config", label: "配置", names: ["update-config", "fewer-permission-prompts"] },
  { key: "usage", label: "用量", names: ["usage"] },
  { key: "review", label: "审查与分析", names: ["code-review", "review", "security-review", "simplify", "debug", "verify"] },
  { key: "automation", label: "自动化与任务", names: ["loop", "batch", "run", "deep-research"] },
  { key: "insights", label: "协作与洞察", names: ["insights", "team-onboarding"] },
  { key: "skills", label: "Skills 管理", names: ["run-skill-generator"] },
  { key: "misc", label: "其他", names: ["heapdump", "claude-api"] },
];

function translateCommands(cmds: SlashCommandInfo[]): SlashCommandInfo[] {
  return cmds.map((c) => ({
    ...c,
    description: ZH_DESC[c.name] || c.description,
    argumentHint: ZH_HINT[c.name] ?? c.argumentHint,
  }));
}

interface SettingsState {
  evaluateMode: boolean;
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
  availableCommands: SlashCommandInfo[];
  setEvaluateMode: (enabled: boolean) => void;
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
  loadCommands: () => Promise<void>;
  setAvailableCommands: (commands: SlashCommandInfo[]) => void;
  loadFromElectron: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  evaluateMode: false,
  defaultProjectDir: "~/EasyMintProject",
  claudePath: "",
  claudeVersion: "",
  apiBaseUrl: "",
  apiKey: "",
  apiKeys: {},
  model: "",
  availableModels: [],
  apiProviders: null,
  availableCommands: [],

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

  setAvailableCommands: (commands) => set({ availableCommands: translateCommands(commands) }),

  loadCommands: async () => {
    try {
      const cmds = await window.electronAPI?.agent?.listCommands?.();
      if (Array.isArray(cmds)) set({ availableCommands: translateCommands(cmds) });
    } catch { /* electronAPI unavailable */ }
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
