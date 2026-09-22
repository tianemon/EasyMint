/**
 * `em-settings.json` 的磁盘结构声明 —— 全仓唯一来源。
 *
 * ## 为什么需要这份声明
 *
 * 本文件此前是扁平结构，字段按「历史添加顺序」排列：`glow*` 与 `status*` 交错、
 * `apiKeys` 里混着 `VISION_MODE` / `VISION_BASE_URL` / `VISION_MODEL` 三个非密钥配置。
 * 同时它被 **6 处**代码读写，各自硬编码字段名：
 *
 *   store.ts（全量读写）、native-config.ts（providers / migration 段）、
 *   api-clients.ts（apiKeys）、mcp-service.ts（hiddenMcpServers / mcpApproved / apiKeys）、
 *   skill-service.ts（hiddenSkills）、sandbox/compat-policy.ts（sandboxExtraDomains）
 *
 * 后果有二：**加字段要改多处、漏一处就静默失效**；**同一个字段在不同模块里路径可能写岔**
 * （Store 写新位置、外部还写旧位置 → 双写分裂、互相看不见）。
 *
 * 这里把「磁盘路径 ↔ 内存键」收敛成一份声明，读写与迁移都按它执行：
 * - 加字段 = 表里加一行（`SETTINGS_FIELDS`），外加穷尽性检查兜底（漏了编译报错）
 * - 外部写入点引用 `EM_PATH` 的常量，不再硬编码路径字符串
 * - 一次性结构迁移（`migrateEmSettingsShape`）直接用同一份路径做搬迁
 *
 * ## 结构约定
 *
 * 最多三层（`group.field` 与 `group.sub.field`），组内 camelCase，组名用单数小写。实际最深的
 * 是 `appearance.glow.effect` / `capabilities.vision.mode` 这一类，正好卡在「三层是舒服编辑
 * 的上限」这条通行做法上——再深就难读也难取值。分组的目的是让后续新增字段有地方可加，
 * 不必继续往顶层平铺。风格也与 pi 自身 `settings.json` 一致（`compaction` / `branchSummary`
 * / `retry` 为对象、其余扁平）。
 *
 * ## 边界：这份文件不做语义归一化
 *
 * 表只负责**结构映射**（嵌套 ↔ 扁平）。类型转换与默认值仍留在 `Store.getSettings()`，
 * 因为那里有字段级语义（如 `chatFontScale` 故意不兜底、`glowGroups*` 读时合并内置组）。
 */

// 仅类型导入（编译期擦除）——`store.ts` 值导入本模块，方向是单向的，运行时无循环依赖。
import type { Settings } from "./store";

/** 当前支持的结构版本。文件里的值高于此值时拒绝加载——否则老程序会把新结构的字段读成"没有"。 */
export const EM_SCHEMA_VERSION = 1;

/** 磁盘路径常量：外部写入点引用这里，避免同名字段在不同模块写成不同路径。 */
export const EM_PATH = {
  // ── project ──
  projectDefaultDir: "project.defaultDir",
  projectLastId: "project.lastId",
  projectSetupComplete: "project.setupComplete",
  // ── session ──
  sessionCompactThreshold: "session.compactThreshold",
  // ── permissions / sandbox ──
  permissionChatMode: "permissions.chatMode",
  permissionSandboxDisabled: "permissions.sandboxDisabled",
  sandboxExtraDomains: "sandbox.extraDomains",
  // ── capabilities（模型能力增强：视觉识图 / 联网搜索抓取）──
  capabilityVisionMode: "capabilities.vision.mode",
  capabilityVisionBaseUrl: "capabilities.vision.baseUrl",
  capabilityVisionModel: "capabilities.vision.model",
  capabilityVisionApiKey: "capabilities.vision.apiKey",
  capabilityWebApiKey: "capabilities.web.apiKey",
  /** 额外环境变量池：键名即注入给 MCP server 的环境变量名 */
  env: "env",
  // ── appearance.font ──
  appearanceFontUi: "appearance.font.ui",
  appearanceFontChat: "appearance.font.chat",
  /** 旧版字号档位（1-6，仅兼容读取） */
  appearanceFontLegacyLevel: "appearance.font.legacyLevel",
  // ── appearance.glow（输入卡片光效）──
  appearanceGlowEffect: "appearance.glow.effect",
  appearanceGlowColorMode: "appearance.glow.colorMode",
  appearanceGlowColorLight: "appearance.glow.colorLight",
  appearanceGlowColorDark: "appearance.glow.colorDark",
  appearanceGlowGroupsLight: "appearance.glow.groupsLight",
  appearanceGlowGroupsDark: "appearance.glow.groupsDark",
  appearanceGlowActiveLight: "appearance.glow.activeLight",
  appearanceGlowActiveDark: "appearance.glow.activeDark",
  // ── appearance.status（Mint 状态栏文本流光）──
  appearanceStatusStyle: "appearance.status.style",
  appearanceStatusColorLight: "appearance.status.colorLight",
  appearanceStatusColorDark: "appearance.status.colorDark",
  appearanceStatusGroupsLight: "appearance.status.groupsLight",
  appearanceStatusGroupsDark: "appearance.status.groupsDark",
  appearanceStatusActiveLight: "appearance.status.activeLight",
  appearanceStatusActiveDark: "appearance.status.activeDark",
  // ── skills ──
  skillsManageEnabled: "skills.manageEnabled",
  skillsLearnEnabled: "skills.learnEnabled",
  skillsImportExternal: "skills.importExternal",
  skillsHidden: "skills.hidden",
  // ── mcp ──
  mcpHidden: "mcp.hidden",
  mcpApproved: "mcp.approved",
  // ── providers（供应商 UI 元数据与旧 ID 兼容索引）──
  providerPreferences: "providers.preferences",
  providerLegacyIds: "providers.legacyIds",
  // ── migration（迁移标记）──
  migrationSchemaVersion: "migration.schemaVersion",
  migrationNativeVersion: "migration.nativeConfigVersion",
  migrationNativeRecord: "migration.nativeConfigMigration",
} as const;

/**
 * Store 负责读写的字段：磁盘路径 ↔ 内存扁平键。
 *
 * 不加类型注解、保留字面量（`as const`）——下方的穷尽性检查要靠字面量类型推导；
 * 一旦写上 `: readonly [string, string][]` 这类注解，键会被拓宽成 `string`，检查随之失效。
 */
export const SETTINGS_FIELDS = [
  [EM_PATH.projectDefaultDir, "defaultProjectDir"],
  [EM_PATH.projectLastId, "lastProjectId"],
  [EM_PATH.projectSetupComplete, "setupComplete"],
  [EM_PATH.sessionCompactThreshold, "contextThreshold"],
  [EM_PATH.permissionChatMode, "chatPermissionMode"],
  [EM_PATH.permissionSandboxDisabled, "sandboxDisabled"],
  [EM_PATH.appearanceFontUi, "uiFontScale"],
  [EM_PATH.appearanceFontChat, "chatFontScale"],
  [EM_PATH.appearanceFontLegacyLevel, "chatFontLevel"],
  [EM_PATH.appearanceGlowEffect, "glowEffect"],
  [EM_PATH.appearanceGlowColorMode, "glowColorMode"],
  [EM_PATH.appearanceGlowColorLight, "glowColorLight"],
  [EM_PATH.appearanceGlowColorDark, "glowColorDark"],
  [EM_PATH.appearanceGlowGroupsLight, "glowGroupsLight"],
  [EM_PATH.appearanceGlowGroupsDark, "glowGroupsDark"],
  [EM_PATH.appearanceGlowActiveLight, "activeGlowGroupLight"],
  [EM_PATH.appearanceGlowActiveDark, "activeGlowGroupDark"],
  [EM_PATH.appearanceStatusStyle, "statusTextStyle"],
  [EM_PATH.appearanceStatusColorLight, "statusColorLight"],
  [EM_PATH.appearanceStatusColorDark, "statusColorDark"],
  [EM_PATH.appearanceStatusGroupsLight, "statusTextGroupsLight"],
  [EM_PATH.appearanceStatusGroupsDark, "statusTextGroupsDark"],
  [EM_PATH.appearanceStatusActiveLight, "activeStatusGroupLight"],
  [EM_PATH.appearanceStatusActiveDark, "activeStatusGroupDark"],
  [EM_PATH.skillsManageEnabled, "manageSkillEnabled"],
  [EM_PATH.skillsLearnEnabled, "learnEnabled"],
  [EM_PATH.skillsImportExternal, "importExternalSkills"],
  // 迁移记录：由 native-config 写入，但它在 `Settings` 接口内（`getSettings()` 要读给界面），
  // 故归主表——Store 写入时会带上它，两边写的是同一个值，不会打架。
  [EM_PATH.migrationNativeRecord, "nativeConfigMigration"],
] as const;

/** 由 `native-config.ts` 管理、且不在 `Settings` 接口里的字段（故不参与穷尽性检查）。 */
export const NATIVE_CONFIG_FIELDS = [
  [EM_PATH.providerPreferences, "providerPreferences"],
  [EM_PATH.providerLegacyIds, "legacyProviderIds"],
  [EM_PATH.migrationNativeVersion, "nativeConfigVersion"],
] as const;

/**
 * 不落盘的「读取投影」：由 pi 原生文件推导后经 IPC 交给界面，磁盘上若残留一并删掉。
 * 见 `NativeConfig.view()` 与 `writeEmSettings` 的守卫。
 */
export const PROJECTED_FIELDS = [
  "model", "availableModels", "chatThinkingLevel", "apiProviders",
  "modelParamsMigrated", "modelIdentityMigrated",
] as const;

/**
 * 只由外部模块直写、Store 不参与读写的字段：旧扁平键 → 分组路径。
 * 搬迁由结构迁移执行；那些模块自己读写时也引用同一路径（见各模块对 `EM_PATH` 的引用）。
 * Store 的 `writeEmSettings` 靠「保留未识别字段」维持它们不被抹掉。
 */
export const EXTERNAL_FIELD_MOVES = [
  [EM_PATH.skillsHidden, "hiddenSkills"],
  [EM_PATH.mcpHidden, "hiddenMcpServers"],
  [EM_PATH.mcpApproved, "mcpApproved"],
  [EM_PATH.sandboxExtraDomains, "sandboxExtraDomains"],
] as const;

// ── 点号路径读写（路径一律来自本文件的常量，不接受外部输入）─────────────

/** 按 `a.b.c` 取值；任一层缺失返回 undefined。 */
export function getPath(data: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = data;
  for (const seg of path.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}

/** 按 `a.b.c` 写值，中间层不存在则建对象；值为 undefined 时删除该叶子并清理空壳。 */
export function setPath(data: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split(".");
  let cursor: Record<string, unknown> = data;
  for (const seg of segs.slice(0, -1)) {
    const next = cursor[seg];
    if (next === null || typeof next !== "object" || Array.isArray(next)) cursor[seg] = {};
    cursor = cursor[seg] as Record<string, unknown>;
  }
  const leaf = segs[segs.length - 1]!;
  if (value === undefined) delete cursor[leaf];
  else cursor[leaf] = value;
}

/** 按 `a.b.c` 删除，并自底向上清理变空的父对象（避免留下 `"glow": {}` 这类空壳）。 */
export function deletePath(data: Record<string, unknown>, path: string): void {
  const segs = path.split(".");
  const stack: Array<[Record<string, unknown>, string]> = [];
  let cursor: Record<string, unknown> = data;
  for (const seg of segs.slice(0, -1)) {
    const next = cursor[seg];
    if (next === null || typeof next !== "object" || Array.isArray(next)) return;
    stack.push([cursor, seg]);
    cursor = next as Record<string, unknown>;
  }
  delete cursor[segs[segs.length - 1]!];
  for (let i = stack.length - 1; i >= 0; i--) {
    const [parent, key] = stack[i]!;
    const child = parent[key];
    if (child && typeof child === "object" && !Array.isArray(child) && Object.keys(child).length === 0) delete parent[key];
  }
}

// ── apiKeys：一对多的特殊形态 ────────────────────────────────
//
// 磁盘上拆成三处（结构化配置 + 环境变量池），内存里**仍是**「环境变量名 → 值」的 Record。
// 为什么不把内存也拆开：`apiKeys` 的键名同时是**注入给 MCP server 的环境变量名**
// （`mcp-service.ts` 的 `{ ...apiKeys, ...cfgEnv }`），且 `api-clients.ts` 的启用判据与渲染层
// 三处整对象读改写都按 Record 工作。保持 Record 形态 = 这些调用点零改动，注入行为也完全不变。

/** 结构化字段 ↔ 环境变量名。**键名是 MCP 注入契约，不是显示名，不要改**。 */
const VISION_ENV_TO_PATH: Record<string, string> = {
  VISION_MODE: EM_PATH.capabilityVisionMode,
  VISION_BASE_URL: EM_PATH.capabilityVisionBaseUrl,
  VISION_MODEL: EM_PATH.capabilityVisionModel,
  VISION_API_KEY: EM_PATH.capabilityVisionApiKey,
};
const VISION_PATH_TO_ENV: Record<string, string> = {
  [EM_PATH.capabilityVisionMode]: "VISION_MODE",
  [EM_PATH.capabilityVisionBaseUrl]: "VISION_BASE_URL",
  [EM_PATH.capabilityVisionModel]: "VISION_MODEL",
  [EM_PATH.capabilityVisionApiKey]: "VISION_API_KEY",
};
const WEB_ENV_KEY = "TAVILY_API_KEY";

/** 磁盘 → 内存：结构化位置为准，`env` 池补其它任意键。全空时返回 undefined（保持旧语义）。 */
export function apiKeysFromDisk(data: Record<string, unknown>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  const env = getPath(data, EM_PATH.env);
  if (env && typeof env === "object" && !Array.isArray(env)) {
    for (const [k, v] of Object.entries(env)) if (typeof v === "string") out[k] = v;
  }
  for (const [path, envKey] of Object.entries(VISION_PATH_TO_ENV)) {
    const v = getPath(data, path);
    if (typeof v === "string" && v) out[envKey] = v;
  }
  const webKey = getPath(data, EM_PATH.capabilityWebApiKey);
  if (typeof webKey === "string" && webKey) out[WEB_ENV_KEY] = webKey;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 内存 → 磁盘：按当前 Record 重建三处位置。先删后写——用户删掉某个 key 时要能反映到盘上。 */
export function applyApiKeysToDisk(data: Record<string, unknown>, apiKeys: Record<string, string> | undefined): void {
  for (const path of [...Object.values(VISION_PATH_TO_ENV), EM_PATH.capabilityWebApiKey, EM_PATH.env]) deletePath(data, path);
  if (!apiKeys) return;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(apiKeys)) {
    if (typeof value !== "string") continue;
    const structured = VISION_ENV_TO_PATH[key];
    if (structured) { if (value) setPath(data, structured, value); continue; }
    if (key === WEB_ENV_KEY) { if (value) setPath(data, EM_PATH.capabilityWebApiKey, value); continue; }
    env[key] = value;   // 其余任意键（含用户给 MCP server 配的自定义变量）进池子
  }
  if (Object.keys(env).length > 0) setPath(data, EM_PATH.env, env);
}

// ── 外部直写字段的读写（供 skill-service / mcp-service / compat-policy 共用）──

const EXTERNAL_PATH_BY_FLAT: Record<string, string> = Object.fromEntries(
  EXTERNAL_FIELD_MOVES.map(([path, flatKey]) => [flatKey, path]),
);

/** 读外部字段：优先新路径，回落旧扁平键（结构迁移尚未执行时兜底）。 */
export function readExternalField(data: Record<string, unknown>, flatKey: string): unknown {
  return getPath(data, EXTERNAL_PATH_BY_FLAT[flatKey] ?? flatKey) ?? data[flatKey];
}

/** 写外部字段：写到新路径并清掉旧扁平键，杜绝新旧并存。 */
export function writeExternalField(data: Record<string, unknown>, flatKey: string, value: unknown): void {
  setPath(data, EXTERNAL_PATH_BY_FLAT[flatKey] ?? flatKey, value);
  if (flatKey in data) delete data[flatKey];
}

// ── 磁盘 → 扁平（读侧）──────────────────────────────────────

/**
 * 按表把磁盘嵌套读成扁平 raw 值（**不做类型归一化**，那仍由 `Store.getSettings()` 负责）。
 *
 * 每个字段都带**旧扁平结构兜底**：新路径取不到时回落到同名顶层键。这样即使迁移尚未执行
 * （或迁移因外部修改而中止、用户手工把文件改回旧形态），读侧也不会整体回落默认值——
 * 最坏情况只是文件仍不整齐，而不是"用户的配置看起来丢了"。
 */
export function flattenEmSettings(raw: Record<string, unknown>): Record<string, unknown> {
  // 先原样保留全部字段：`apiProviders` 等**投影字段**不在表内，但 `Store.getSettings()` 与
  // pi 原生迁移都要读它们（迁移期间 nativeViews 尚未注册）。只保留表内字段会让这些字段凭空消失。
  const out: Record<string, unknown> = { ...raw };
  for (const [path, key] of SETTINGS_FIELDS) {
    const value = getPath(raw, path) ?? raw[key];
    if (value !== undefined) out[key] = value;
  }
  const apiKeys = apiKeysFromDisk(raw) ?? raw.apiKeys;
  if (apiKeys !== undefined) out.apiKeys = apiKeys;
  return out;
}

// ── 穷尽性检查：漏字段 = 编译错误 ────────────────────────────
//
// 这是「字段会持续增长」场景下的主要防线：新加一个 `Settings` 字段却忘了进 `SETTINGS_FIELDS`，
// 会导致「界面上改得动、落盘却丢」的静默失效，而且运行期没有报错。让它在编译期就红。

type MappedKey = (typeof SETTINGS_FIELDS)[number][1] | "apiKeys";
type ProjectedKey = (typeof PROJECTED_FIELDS)[number];
/** 既没进表、也不属投影字段的 `Settings` 键。理想为 never。 */
type UnmappedKey = Exclude<keyof Settings, MappedKey | ProjectedKey>;

// 用 `[T] extends [never]` 而非裸 `UnmappedKey extends never`：裸 never 在条件类型里会**分发**，
// 结果恒为 never，检查就永远"通过"了（第一版就踩了这个坑）。
export const _missingSettingsFields: Record<UnmappedKey, true> = {};
