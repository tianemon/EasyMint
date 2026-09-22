import fs from "fs";
import path from "path";
import os from "os";
import type { ProviderConfig, ApiProvidersData } from "../../shared/platform-presets";
import { resolveHome } from "../utils/paths";
import { dropLegacyEncryptedApiKeys, dropLegacyEncryptedProviderKeys } from "./settings-legacy";
import { LEGACY_PERMISSION_MODE_ALIASES, type PermissionMode } from "./permission/execution-context";
import { atomicWrite, lockConfigDirectory } from "./native-config-storage";

/** 磁盘上的旧权限模式值归一到新三档（`restricted` / `sandbox` → `readonly`）。 */
function normalizeStoredPermissionMode(raw: unknown): PermissionMode {
  if (raw === "full" || raw === "readonly" || raw === "standard") return raw;
  return typeof raw === "string" ? (LEGACY_PERMISSION_MODE_ALIASES[raw] ?? "standard") : "standard";
}

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
  nativeConfigMigration?: { migratedAt: string; duplicateConfigIds: string[] };
  defaultProjectDir: string;
  model?: string;
  availableModels?: string[];
  apiKeys?: Record<string, string>;
  /** 允许 AI 在会话中写 managed skill 区（manage_skill 工具注册开关，D8 默认关闭） */
  manageSkillEnabled?: boolean;
  /** 允许 AI 自沉淀（learn / search_experiences / retire_experiences 三工具同开的注册开关，D8 默认关闭） */
  learnEnabled?: boolean;
  /** 发现外部生态 skill 目录（~/.claude/skills、<p>/.github/skills 等，只读发现，默认开启） */
  importExternalSkills?: boolean;
  lastProjectId?: string;
  setupComplete?: boolean;
  contextThreshold?: number;
  /** 全局聊天思考等级(仅作为新聊天会话的初始默认,不控制 agent/task) */
  chatThinkingLevel?: string;
  /** 全局默认权限模式(仅作为新聊天会话的初始默认,可临时切回) */
  chatPermissionMode?: PermissionMode;
  /**
   * Linux 兜底：关闭沙盒运行（系统依赖 bwrap/socat/rg 装不上时的逃生通道）。
   * 政策：优先引导安装依赖，实在装不了才用它；仅 Linux 生效，见 sandbox/manager.isSandboxBypassed。
   */
  sandboxDisabled?: boolean;
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
  /** extraModels 参数显式化迁移已完成(一次性;标记后新条目不再按旧逻辑推断参数) */
  modelParamsMigrated?: boolean;
  /** 模型身份迁移已完成(一次性:旧 id=显示名 + alias=请求标识 → 新 id=请求标识 + name=显示名) */
  modelIdentityMigrated?: boolean;
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
  contextThreshold: 75,
  sandboxDisabled: false,
};

/**
 * 已下线功能在 em-settings.json 里的落盘残留。
 *
 * 功能移除时只删了代码：本文件写入走「先读旧文件、再覆盖已知字段」（见 writeEmSettings），
 * 未知字段会被原样带下去，于是这些字段在磁盘上一直存活，且全仓（含 origin/main）零引用。
 * 逐组依据：`builtinTools` 能力判据只看 key（docs/开发记录/2026-09-16.md）、
 * `showThinking`/`showToolUse` 显示开关移除（2026-09-08.md）、`terminalFontSize`
 * xterm 残留（2026-08-28.md）、`context1M` 废弃（2026-09-10.md）、旧字号四项与
 * 旧光效六项分别由 chatFontScale / glowGroups 取代、多 Agent 分组五项对应实现已全删。
 * 写入时统一剔除——用户升级后随首次保存设置自动清干净。
 */
const OBSOLETE_EM_FIELDS = [
  "builtinTools", "showThinking", "showToolUse", "terminalFontSize", "claudePath", "context1M",
  "chatFontSize", "chatListFontSize", "chatBubbleFontSize", "chatDetailFontSize",
  "glowThickness", "glowSpeed", "glowTailWidth", "glowTravel", "glowOrbitFade", "glowOrbitBlur",
  "maxGroupAgents", "groupForwardStrategy", "groupInjectMode", "maxForwardDepth", "groupPresets",
];

type NativeSettingsView = Pick<Settings, "apiProviders" | "chatThinkingLevel" | "model" | "availableModels">;
const nativeViews = new Map<string, () => NativeSettingsView>();
export function registerNativeSettingsView(dataDir: string, read: () => NativeSettingsView): void {
  nativeViews.set(dataDir, read);
}

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

  getDataDir(): string { return this.dataDir; }

  private ensureFiles(): void {
    // 快路径：文件都在时不加锁——Store 会被多处构造（pi-init 的默认参数、IPC 默认值），
    // 每次构造都 lock+unlock 一次 proper-lockfile 是无谓的磁盘 IO
    if (fs.existsSync(this.projectsPath) && fs.existsSync(this.emSettingsPath)) return;
    const release = lockConfigDirectory(this.dataDir);
    try {
      // 锁内复查（两个进程同时构造时避免 TOCTOU）
      if (!fs.existsSync(this.projectsPath)) atomicWrite(this.projectsPath, JSON.stringify({ projects: [] }, null, 2));
      if (!fs.existsSync(this.emSettingsPath)) atomicWrite(this.emSettingsPath, JSON.stringify(EM_DEFAULTS, null, 2));
    } finally { release(); }
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
    const release = lockConfigDirectory(this.dataDir);
    try { atomicWrite(this.projectsPath, JSON.stringify({ projects }, null, 2)); }
    finally { release(); }
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
    const emData: Record<string, unknown> = { ...this.readEmSettings(), ...nativeViews.get(this.dataDir)?.() };
    return {
      nativeConfigMigration: emData.nativeConfigMigration as Settings["nativeConfigMigration"],
      defaultProjectDir: resolveHome((emData.defaultProjectDir as string) || EM_DEFAULTS.defaultProjectDir),
      model: (emData.model as string) || undefined,
      availableModels: (emData.availableModels as string[]) || undefined,
      apiKeys: dropLegacyEncryptedApiKeys(emData.apiKeys as Record<string, string> | undefined),
      manageSkillEnabled: emData.manageSkillEnabled as boolean | undefined,
      learnEnabled: emData.learnEnabled as boolean | undefined,
      importExternalSkills: emData.importExternalSkills as boolean | undefined,
      setupComplete: emData.setupComplete as boolean | undefined,
      lastProjectId: emData.lastProjectId as string | undefined,
      contextThreshold: (emData.contextThreshold as number) ?? EM_DEFAULTS.contextThreshold,
      sandboxDisabled: Boolean(emData.sandboxDisabled),
      chatThinkingLevel: (emData.chatThinkingLevel as string) ?? "medium",
      chatPermissionMode: normalizeStoredPermissionMode(emData.chatPermissionMode),
      chatFontLevel: (emData.chatFontLevel as number) ?? 3,
      // chatFontScale 不兜底:老用户磁盘无此字段时须返回 undefined,
      // 前端 loadFromElectron 才能走 LEGACY_CHAT_FONT_SCALE 旧级别迁移(?? 1 会吞掉迁移)
      chatFontScale: emData.chatFontScale as number | undefined,
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
      apiProviders: dropLegacyEncryptedProviderKeys(emData.apiProviders as ApiProvidersData | undefined),
      modelParamsMigrated: emData.modelParamsMigrated as boolean | undefined,
      modelIdentityMigrated: emData.modelIdentityMigrated as boolean | undefined,
    };
  }

  getLastProjectId(): string | null {
    return this.getSettings().lastProjectId ?? null;
  }

  /**
   * 记录当前项目，并顺带刷新它在 projects.json 里的 lastOpenedAt（「打开项目」弹窗按此排序）。
   * 合并写在同一个方法里是因为**所有打开项目的入口最终都收敛到这里**：
   * 弹窗选中/切换项目 → 渲染层 settings:set-last-project；新窗口打开 → window:open-project。
   * 单开一条 project:touch IPC 等于让两个入口各写一次同一件事。
   */
  setLastProjectId(projectId: string): void {
    const s = this.getSettings();
    s.lastProjectId = projectId;
    this.writeEmSettings(s);
    this.touchProject(projectId);
  }

  /** 刷新项目最近打开时间。项目已不在列表中（被删/被过滤）时静默跳过。 */
  private touchProject(id: string): void {
    const projects = this.getProjects();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) return;
    projects[idx] = { ...projects[idx], lastOpenedAt: new Date().toISOString() };
    this.saveProjects(projects);
  }

  /** Write EM-only fields to ~/.easymint/settings.json */
  private writeEmSettings(settings: Settings): void {
    const release = lockConfigDirectory(this.dataDir);
    try {
      const dir = path.dirname(this.emSettingsPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data: Record<string, unknown> = {};
      if (fs.existsSync(this.emSettingsPath)) {
        Object.assign(data, JSON.parse(fs.readFileSync(this.emSettingsPath, "utf-8")));
      }
      data.defaultProjectDir = settings.defaultProjectDir;
      data.sandboxDisabled = Boolean(settings.sandboxDisabled);
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
      if (settings.manageSkillEnabled !== undefined) data.manageSkillEnabled = settings.manageSkillEnabled;
      if (settings.learnEnabled !== undefined) data.learnEnabled = settings.learnEnabled;
      if (settings.importExternalSkills !== undefined) data.importExternalSkills = settings.importExternalSkills;
      if (settings.contextThreshold !== undefined) data.contextThreshold = settings.contextThreshold;
      if (settings.chatThinkingLevel) data.chatThinkingLevel = settings.chatThinkingLevel;
      if (settings.chatPermissionMode) data.chatPermissionMode = settings.chatPermissionMode;
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
      if (settings.modelParamsMigrated) data.modelParamsMigrated = true;
      if (settings.modelIdentityMigrated) data.modelIdentityMigrated = true;
      if (nativeViews.has(this.dataDir) || data.nativeConfigVersion === 1) {
        for (const key of ["apiProviders", "model", "availableModels", "chatThinkingLevel", "modelParamsMigrated", "modelIdentityMigrated"]) delete data[key];
      }
      // 已下线功能的残留（见 OBSOLETE_EM_FIELDS）：读取侧本就只挑已知字段，
      // 这里顺手把磁盘上的历史值一并清掉，否则它们会随每次保存无限期带下去。
      for (const key of OBSOLETE_EM_FIELDS) delete data[key];
      atomicWrite(this.emSettingsPath, JSON.stringify(data, null, 2));
    } finally { release(); }
  }

  saveSettings(settings: Settings): void {
    this.writeEmSettings(settings);
  }
}
