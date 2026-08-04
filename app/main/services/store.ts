import fs from "fs";
import path from "path";
import os from "os";
import type { ProviderConfig, ApiProvidersData } from "../../shared/platform-presets";
import { resolveHome } from "../utils/paths";

export const DATA_DIR = path.join(os.homedir(), ".easymint");

// ── 多平台 API 供应商配置 ──────────────────────
// 类型定义见 app/shared/platform-presets.ts

export type { ProviderConfig, ApiProvidersData };

// ───────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
  status: "setup" | "development" | "completed";
  description: string;
}

interface Session {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  lastActiveAt: string;
  sessionId: string;
  status: "active" | "completed";
}

interface Settings {
  defaultProjectDir: string;
  terminalFontSize: number;
  evaluateMode?: boolean;
  apiBaseUrl?: string;
  apiKey?: string;
  model?: string;
  availableModels?: string[];
  apiKeys?: Record<string, string>;
  builtinTools?: Record<string, boolean>;
  lastProjectId?: string;
  setupComplete?: boolean;
  contextThreshold?: number;
  context1M?: boolean;
  showThinking?: boolean;
  showToolUse?: boolean;
  apiProviders?: ApiProvidersData;
  // ── 需求 1:默认 + 兜底模型 ──
  /** 默认供应商 piId(会话未指定时用) */
  defaultProvider?: string;
  /** 默认模型 id */
  defaultModel?: string;
  /** 兜底供应商 piId(主模型失败/无 auth 时降级) */
  fallbackProvider?: string;
  /** 兜底模型 id */
  fallbackModel?: string;
  /** 子 Agent 默认模型(需求 2,委派未指定时用;格式 "provider:model") */
  subagentDefaultModel?: string;
  // ── 需求 4:群聊配置 ──
  /** 群聊最大 agent 数(默认 3) */
  maxGroupAgents?: number;
  /** 转发策略:all 全广播 / conclusion 只转发结论(默认) */
  groupForwardStrategy?: "all" | "conclusion";
  /** 注入方式:steer 打断 / followUp 等空闲(默认) */
  groupInjectMode?: "steer" | "followUp";
  /** 群聊最大转发深度(防环,默认 3) */
  maxForwardDepth?: number;
  /** 群聊预设角色组合(内置 + 用户自定义) */
  groupPresets?: GroupPreset[];
}

/** 群聊预设组合:一组角色模板的命名组合 */
export interface GroupPreset {
  id: string;
  name: string;
  templateIds: string[];
}

/** 内置群聊预设(首次读取时种子写入) */
export const BUILTIN_GROUP_PRESETS: GroupPreset[] = [
  { id: "dev-trio", name: "开发三人组", templateIds: ["mint", "default-builder", "default-evaluator"] },
  { id: "design-duo", name: "设计协作", templateIds: ["mint", "mint-designer"] },
];

const EM_DEFAULTS = {
  setupComplete: false,
  defaultProjectDir: "~/EasyMintProject",
  terminalFontSize: 14,
  contextThreshold: 75,
  context1M: false,
};

export class Store {
  private dataDir: string;
  private projectsPath: string;
  private emSettingsPath: string;
  constructor(baseDir?: string) {
    this.dataDir = baseDir ?? DATA_DIR;
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.projectsPath = path.join(this.dataDir, "projects.json");
    this.emSettingsPath = path.join(this.dataDir, "em-settings.json");
    this.ensureFiles();
  }

  private ensureFiles(): void {
    if (!fs.existsSync(this.projectsPath)) {
      fs.writeFileSync(this.projectsPath, JSON.stringify({ projects: [] }, null, 2));
    }
    if (!fs.existsSync(this.emSettingsPath)) {
      fs.writeFileSync(this.emSettingsPath, JSON.stringify(EM_DEFAULTS, null, 2));
    }
  }

  getProjects(): Project[] {
    try {
      if (!fs.existsSync(this.projectsPath)) return [];
      const raw = fs.readFileSync(this.projectsPath, "utf-8");
      const data = JSON.parse(raw);
      return Array.isArray(data.projects) ? data.projects : [];
    } catch (e) {
      console.error("[store] 读取 projects.json 失败:", (e as Error).message);
      return [];
    }
  }

  saveProjects(projects: Project[]): void {
    fs.writeFileSync(this.projectsPath, JSON.stringify({ projects }, null, 2));
  }

  updateProject(id: string, patch: { name?: string; path?: string }): Project | undefined {
    const projects = this.getProjects();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) return undefined;
    projects[idx] = { ...projects[idx], ...patch, lastOpenedAt: new Date().toISOString() };
    this.saveProjects(projects);
    return projects[idx];
  }

  private readEmSettings(): Record<string, unknown> {
    let data: Record<string, unknown> = {};
    if (fs.existsSync(this.emSettingsPath)) {
      try { data = JSON.parse(fs.readFileSync(this.emSettingsPath, "utf-8")); }
      catch (e) { console.error("[store] 解析 em-settings.json 失败:", (e as Error).message); }
    }
    return data;
  }

  getSettings(): Settings {
    const emData = this.readEmSettings();
    return {
      defaultProjectDir: resolveHome((emData.defaultProjectDir as string) || EM_DEFAULTS.defaultProjectDir),
      terminalFontSize: (emData.terminalFontSize as number) || EM_DEFAULTS.terminalFontSize,
      evaluateMode: emData.evaluateMode as boolean | undefined,
      apiBaseUrl: (emData.apiBaseUrl as string) || "",
      apiKey: (emData.apiKey as string) || "",
      model: (emData.model as string) || undefined,
      availableModels: (emData.availableModels as string[]) || undefined,
      apiKeys: (emData.apiKeys as Record<string, string>) || undefined,
      builtinTools: (emData.builtinTools as Record<string, boolean>) || undefined,
      setupComplete: emData.setupComplete as boolean | undefined,
      lastProjectId: emData.lastProjectId as string | undefined,
      contextThreshold: (emData.contextThreshold as number) ?? EM_DEFAULTS.contextThreshold,
      context1M: (emData.context1M as boolean) ?? false,
      showThinking: emData.showThinking as boolean | undefined,
      showToolUse: emData.showToolUse as boolean | undefined,
      apiProviders: (emData.apiProviders as ApiProvidersData) || undefined,
      defaultProvider: emData.defaultProvider as string | undefined,
      defaultModel: emData.defaultModel as string | undefined,
      fallbackProvider: emData.fallbackProvider as string | undefined,
      fallbackModel: emData.fallbackModel as string | undefined,
      subagentDefaultModel: emData.subagentDefaultModel as string | undefined,
      maxGroupAgents: (emData.maxGroupAgents as number) ?? 3,
      groupForwardStrategy: (emData.groupForwardStrategy as "all" | "conclusion") ?? "conclusion",
      groupInjectMode: (emData.groupInjectMode as "steer" | "followUp") ?? "followUp",
      maxForwardDepth: (emData.maxForwardDepth as number) ?? 3,
      groupPresets: (emData.groupPresets as GroupPreset[]) ?? BUILTIN_GROUP_PRESETS,
    };
  }

  /** 获取当前活跃供应商的 API Key */
  getActiveApiKey(): string {
    const settings = this.getSettings();
    const providers = settings.apiProviders;
    const activeCfg = providers?.current ? providers.configs?.[providers.current] : undefined;
    return activeCfg?.apiKey || settings.apiKey || "";
  }

    getLastProjectId(): string | null {
    return this.getSettings().lastProjectId ?? null;
  }

  setLastProjectId(projectId: string): void {
    const s = this.getSettings();
    s.lastProjectId = projectId;
    this.writeEmSettings(s);
  }

  /** Write EM-only fields to ~/.easymint/settings.json */
  private writeEmSettings(settings: Settings): void {
    const dir = path.dirname(this.emSettingsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data: Record<string, unknown> = {};
    if (fs.existsSync(this.emSettingsPath)) {
      Object.assign(data, JSON.parse(fs.readFileSync(this.emSettingsPath, "utf-8")));
    }
    data.defaultProjectDir = settings.defaultProjectDir;
    data.terminalFontSize = settings.terminalFontSize;
    data.evaluateMode = settings.evaluateMode;
    data.lastProjectId = settings.lastProjectId;
    data.setupComplete = settings.setupComplete;
    // 同步激活供应商的模型列表到旧字段（ChatPanel 下拉引用）
    const providers = settings.apiProviders;
    const activeId = providers?.current;
    const activeCfg = activeId ? providers?.configs?.[activeId] : undefined;
    if (activeCfg) {
      if (activeCfg.model) data.model = activeCfg.model;
      if (activeCfg.models.length > 0) data.availableModels = activeCfg.models;
    } else {
      if (settings.model) data.model = settings.model;
      if (settings.availableModels) data.availableModels = settings.availableModels;
    }
    // 如果新数据中 apiKeys 的值是占位符"••••••••"，从旧文件恢复真实值
    if (settings.apiKeys && Object.keys(settings.apiKeys).length > 0) {
      const merged = { ...settings.apiKeys };
      const oldKeys = (data.apiKeys || {}) as Record<string, string>;
      for (const [k, v] of Object.entries(merged)) {
        if (v === "••••••••" && oldKeys[k]) {
          merged[k] = oldKeys[k];
        }
      }
      data.apiKeys = merged;
    }
    if (settings.builtinTools) data.builtinTools = settings.builtinTools;
    if (settings.contextThreshold !== undefined) data.contextThreshold = settings.contextThreshold;
    if (settings.context1M !== undefined) data.context1M = settings.context1M;
    if (settings.showThinking !== undefined) data.showThinking = settings.showThinking;
    if (settings.showToolUse !== undefined) data.showToolUse = settings.showToolUse;
    if (settings.apiProviders) {
      data.apiProviders = settings.apiProviders;
    }
    // 默认 + 兜底模型(需求 1)
    if (settings.defaultProvider) data.defaultProvider = settings.defaultProvider;
    if (settings.defaultModel) data.defaultModel = settings.defaultModel;
    if (settings.fallbackProvider) data.fallbackProvider = settings.fallbackProvider;
    if (settings.fallbackModel) data.fallbackModel = settings.fallbackModel;
    if (settings.subagentDefaultModel) data.subagentDefaultModel = settings.subagentDefaultModel;
    // 群聊配置(需求 4)
    if (settings.maxGroupAgents !== undefined) data.maxGroupAgents = settings.maxGroupAgents;
    if (settings.groupForwardStrategy) data.groupForwardStrategy = settings.groupForwardStrategy;
    if (settings.groupInjectMode) data.groupInjectMode = settings.groupInjectMode;
    if (settings.maxForwardDepth !== undefined) data.maxForwardDepth = settings.maxForwardDepth;
    if (settings.groupPresets) data.groupPresets = settings.groupPresets;
    fs.writeFileSync(this.emSettingsPath, JSON.stringify(data, null, 2));
  }

  saveSettings(settings: Settings): void {
    this.writeEmSettings(settings);
  }

  getSessionsDir(projectId: string): string {
    const dir = path.join(this.dataDir, "sessions", projectId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  listSessions(projectId: string): Session[] {
    const sessionsFile = path.join(this.getSessionsDir(projectId), "sessions.json");
    if (!fs.existsSync(sessionsFile)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(sessionsFile, "utf-8"));
      return Array.isArray(data.sessions) ? data.sessions : [];
    } catch (e) {
      console.error("[store] 解析 sessions.json 失败:", (e as Error).message);
      return [];
    }
  }

  saveSessions(projectId: string, sessions: Session[]): void {
    const sessionsFile = path.join(this.getSessionsDir(projectId), "sessions.json");
    fs.writeFileSync(sessionsFile, JSON.stringify({ sessions }, null, 2));
  }

  deleteSession(projectId: string, sessionId: string): void {
    const sessionsFile = path.join(this.getSessionsDir(projectId), "sessions.json");
    if (!fs.existsSync(sessionsFile)) return;
    const data = JSON.parse(fs.readFileSync(sessionsFile, "utf-8"));
    data.sessions = data.sessions.filter((s: Session) => s.id !== sessionId);
    fs.writeFileSync(sessionsFile, JSON.stringify(data, null, 2));
  }

}
