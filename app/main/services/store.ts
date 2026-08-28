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

interface Settings {
  defaultProjectDir: string;
  terminalFontSize: number;
  model?: string;
  availableModels?: string[];
  apiKeys?: Record<string, string>;
  builtinTools?: Record<string, boolean>;
  lastProjectId?: string;
  setupComplete?: boolean;
  contextThreshold?: number;
  showThinking?: boolean;
  showToolUse?: boolean;
  /** 全局聊天思考等级(仅作为新聊天会话的初始默认,不控制 agent/task) */
  chatThinkingLevel?: string;
  /** 旧版聊天字号级别(1-6,默认 3;仅兼容读取,新版本用 chatFontScale) */
  chatFontLevel?: number;
  /** 聊天字号缩放系数(0.9-1.3,默认 1):消息内容字号 */
  chatFontScale?: number;
  /** UI 界面字号缩放系数(0.9-1.3,默认 1) */
  uiFontScale?: number;
  /** 状态指示光效:输入卡片光效预设 */
  glowEffect?: "orbit" | "slide" | "breathe" | "off";
  /** 光效颜色模式:单色(solid)/多色(multi) */
  glowColorMode?: "solid" | "multi";
  /** 光效单色(亮色模式) */
  glowColorLight?: string;
  /** 光效单色(暗色模式) */
  glowColorDark?: string;
  /** 多色流光分组(亮色模式;最多 5 组,单次启用一组) */
  glowGroupsLight?: GlowColorGroup[];
  /** 多色流光分组(暗色模式) */
  glowGroupsDark?: GlowColorGroup[];
  /** 当前启用的流光分组 id(亮色模式) */
  activeGlowGroupLight?: string;
  /** 当前启用的流光分组 id(暗色模式) */
  activeGlowGroupDark?: string;
  /** Mint 状态文本样式:单色/流光 */
  statusTextStyle?: "solid" | "shimmer";
  statusColorLight?: string;
  statusColorDark?: string;
  /** 状态流光分组(亮色模式;内置「默认」不可删 + 自定义 ≤4) */
  statusTextGroupsLight?: GlowColorGroup[];
  /** 状态流光分组(暗色模式) */
  statusTextGroupsDark?: GlowColorGroup[];
  /** 当前启用的状态流光分组 id(亮色模式) */
  activeStatusGroupLight?: string;
  /** 当前启用的状态流光分组 id(暗色模式) */
  activeStatusGroupDark?: string;
  apiProviders?: ApiProvidersData;
}

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

/**
 * 合并分组:内置组(代码常量) + 文件自定义组。
 * 无自定义组时可选预置 v1 组(光效专属「自定义 1」);active 失效时回退内置组。
 */
export function mergeGlowGroups(
  builtin: GlowColorGroup,
  saved: GlowColorGroup[] | undefined,
  activeKey: string | undefined,
  v1?: GlowColorGroup
): { groups: GlowColorGroup[]; activeId: string } {
  const groups = [builtin, ...(saved && saved.length > 0 ? saved : v1 ? [v1] : [])];
  const activeId = activeKey && groups.some((g) => g.id === activeKey) ? activeKey : builtin.id;
  return { groups, activeId };
}

const EM_DEFAULTS = {
  setupComplete: false,
  defaultProjectDir: "~/EasyMintProject",
  terminalFontSize: 14,
  contextThreshold: 75,
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
      model: (emData.model as string) || undefined,
      availableModels: (emData.availableModels as string[]) || undefined,
      apiKeys: (emData.apiKeys as Record<string, string>) || undefined,
      builtinTools: (emData.builtinTools as Record<string, boolean>) || undefined,
      setupComplete: emData.setupComplete as boolean | undefined,
      lastProjectId: emData.lastProjectId as string | undefined,
      contextThreshold: (emData.contextThreshold as number) ?? EM_DEFAULTS.contextThreshold,
      showThinking: emData.showThinking as boolean | undefined,
      showToolUse: emData.showToolUse as boolean | undefined,
      chatThinkingLevel: (emData.chatThinkingLevel as string) ?? "medium",
      chatFontLevel: (emData.chatFontLevel as number) ?? 3,
      chatFontScale: (emData.chatFontScale as number) ?? 1,
      uiFontScale: (emData.uiFontScale as number) ?? 1,
      glowEffect: (emData.glowEffect as "orbit" | "slide" | "breathe" | "off") ?? "orbit",
      glowColorMode: (emData.glowColorMode as "solid" | "multi") ?? "multi",
      glowColorLight: (emData.glowColorLight as string) || "#16a34a",
      glowColorDark: (emData.glowColorDark as string) || "#4ade80",
      // 光效分组:内置组(代码常量) + 文件自定义组(无则预置 V1「自定义 1」)
      ...(() => {
        const light = mergeGlowGroups(BUILTIN_GLOW_GROUPS.light, emData.glowGroupsLight as GlowColorGroup[], emData.activeGlowGroupLight as string, V1_GLOW_GROUPS.light);
        const dark = mergeGlowGroups(BUILTIN_GLOW_GROUPS.dark, emData.glowGroupsDark as GlowColorGroup[], emData.activeGlowGroupDark as string, V1_GLOW_GROUPS.dark);
        return {
          glowGroupsLight: light.groups,
          glowGroupsDark: dark.groups,
          activeGlowGroupLight: light.activeId,
          activeGlowGroupDark: dark.activeId,
        };
      })(),
      statusTextStyle: (emData.statusTextStyle as "solid" | "shimmer") ?? "shimmer",
      statusColorLight: (emData.statusColorLight as string) || "#16a34a",
      statusColorDark: (emData.statusColorDark as string) || "#4ade80",
      // 状态流光分组:内置组(代码常量) + 文件自定义组
      ...(() => {
        const light = mergeGlowGroups(BUILTIN_STATUS_GROUPS.light, emData.statusTextGroupsLight as GlowColorGroup[], emData.activeStatusGroupLight as string);
        const dark = mergeGlowGroups(BUILTIN_STATUS_GROUPS.dark, emData.statusTextGroupsDark as GlowColorGroup[], emData.activeStatusGroupDark as string);
        return {
          statusTextGroupsLight: light.groups,
          statusTextGroupsDark: dark.groups,
          activeStatusGroupLight: light.activeId,
          activeStatusGroupDark: dark.activeId,
        };
      })(),
      apiProviders: (emData.apiProviders as ApiProvidersData) || undefined,
    };
  }

  /** 获取当前活跃供应商的 API Key */
  getActiveApiKey(): string {
    const settings = this.getSettings();
    const providers = settings.apiProviders;
    const activeCfg = providers?.current ? providers.configs?.[providers.current] : undefined;
    return activeCfg?.apiKey || "";
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
    if (settings.apiKeys && Object.keys(settings.apiKeys).length > 0) {
      data.apiKeys = settings.apiKeys;
    }
    if (settings.builtinTools) data.builtinTools = settings.builtinTools;
    if (settings.contextThreshold !== undefined) data.contextThreshold = settings.contextThreshold;
    if (settings.showThinking !== undefined) data.showThinking = settings.showThinking;
    if (settings.showToolUse !== undefined) data.showToolUse = settings.showToolUse;
    if (settings.chatThinkingLevel) data.chatThinkingLevel = settings.chatThinkingLevel;
    if (settings.chatFontLevel !== undefined) data.chatFontLevel = settings.chatFontLevel;
    if (settings.chatFontScale !== undefined) data.chatFontScale = settings.chatFontScale;
    if (settings.uiFontScale !== undefined) data.uiFontScale = settings.uiFontScale;
    if (settings.glowEffect) data.glowEffect = settings.glowEffect;
    if (settings.glowColorMode) data.glowColorMode = settings.glowColorMode;
    if (settings.glowColorLight) data.glowColorLight = settings.glowColorLight;
    if (settings.glowColorDark) data.glowColorDark = settings.glowColorDark;
    // 分组只写自定义组(内置组为代码常量,不落盘,防误改)
    if (settings.glowGroupsLight?.length) data.glowGroupsLight = settings.glowGroupsLight.filter((g) => !g.isBuiltin);
    if (settings.glowGroupsDark?.length) data.glowGroupsDark = settings.glowGroupsDark.filter((g) => !g.isBuiltin);
    if (settings.activeGlowGroupLight) data.activeGlowGroupLight = settings.activeGlowGroupLight;
    if (settings.activeGlowGroupDark) data.activeGlowGroupDark = settings.activeGlowGroupDark;
    if (settings.statusTextStyle) data.statusTextStyle = settings.statusTextStyle;
    if (settings.statusColorLight) data.statusColorLight = settings.statusColorLight;
    if (settings.statusColorDark) data.statusColorDark = settings.statusColorDark;
    if (settings.statusTextGroupsLight?.length) data.statusTextGroupsLight = settings.statusTextGroupsLight.filter((g) => !g.isBuiltin);
    if (settings.statusTextGroupsDark?.length) data.statusTextGroupsDark = settings.statusTextGroupsDark.filter((g) => !g.isBuiltin);
    if (settings.activeStatusGroupLight) data.activeStatusGroupLight = settings.activeStatusGroupLight;
    if (settings.activeStatusGroupDark) data.activeStatusGroupDark = settings.activeStatusGroupDark;
    if (settings.apiProviders) {
      data.apiProviders = settings.apiProviders;
    }
    fs.writeFileSync(this.emSettingsPath, JSON.stringify(data, null, 2));
  }

  saveSettings(settings: Settings): void {
    this.writeEmSettings(settings);
  }
}
