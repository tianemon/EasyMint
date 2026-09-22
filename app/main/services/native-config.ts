/** Pi files are the configuration source. ProviderConfig is only an EM view model. */
import path from "node:path";
import fs from "node:fs";
import { buildPiImport, probePiImport } from "./pi-config-import";
import { createHash } from "node:crypto";
import type { Model, Api } from "@earendil-works/pi-ai";
import { getPiConfigSdk } from "./pi-config-sdk";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { normalizeExtraModels, type ApiProvidersData, type ProviderConfig } from "../../shared/platform-presets";
import { THINKING_ORDER } from "../../shared/thinking-levels";
import { Store, registerNativeSettingsView } from "./store";
import { getModelRuntimeClass } from "./pi-sdk";
import { getProviderStaticModels } from "./pi-init-static";
import { migrateExtraModels, migrateModelIdentity } from "./extra-models-migration";
import { NativeConfigStorage, readText, type JsonObject } from "./native-config-storage";
import { EM_PATH, EM_SCHEMA_VERSION, EXTERNAL_FIELD_MOVES, NATIVE_CONFIG_FIELDS, SETTINGS_FIELDS, applyApiKeysToDisk, deletePath, getPath, setPath } from "./em-settings-schema";

const repositories = new Map<string, Promise<NativeConfig>>();
const LEGACY_FIELDS = ["apiProviders", "model", "availableModels", "chatThinkingLevel", "modelParamsMigrated", "modelIdentityMigrated"];
const PARAM_FIELDS = ["name", "contextWindow", "maxTokens", "reasoning", "input", "thinkingLevelMap"];
function validateDefaults(settings: JsonObject): void {
  for (const key of ["defaultProvider", "defaultModel"]) {
    if (settings[key] !== undefined && typeof settings[key] !== "string") throw new Error(`原生设置 ${key} 必须是字符串`);
  }
  if (settings.defaultThinkingLevel !== undefined && !(THINKING_ORDER as readonly unknown[]).includes(settings.defaultThinkingLevel)) throw new Error("原生默认思考等级无效");
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// pi 0.86 permits provider.name in its schema but its composer rejects name alone.
// Empty headers are a neutral native override; no catalog values are copied.
function ensureNativeProvider(provider: JsonObject): void {
  if (!provider.models?.length && !provider.baseUrl && !provider.headers && !provider.compat &&
      !Object.keys(provider.modelOverrides ?? {}).length && !provider.apiKey && !provider.oauth && provider.authHeader === undefined) provider.headers = {};
}
export const nativeProviderId = (cfg: ProviderConfig) => cfg.presetId === "custom" ? cfg.id : cfg.presetId;

export function getNativeConfig(store: Store): Promise<NativeConfig> {
  const dir = store.getDataDir();
  let pending = repositories.get(dir);
  if (!pending) {
    pending = NativeConfig.create(store).catch(error => { repositories.delete(dir); throw error; });
    repositories.set(dir, pending);
  }
  return pending;
}

export class NativeConfig {
  readonly storage: NativeConfigStorage;
  readonly files: { models: string; auth: string; settings: string; em: string };
  private runtime!: ModelRuntime;
  private fingerprint = "";
  private initialModel: Model<Api> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(readonly store: Store) {
    this.storage = new NativeConfigStorage(store.getDataDir());
    this.files = {
      models: path.join(this.storage.agentDir, "models.json"),
      auth: path.join(this.storage.agentDir, "auth.json"),
      settings: path.join(this.storage.agentDir, "settings.json"),
      em: path.join(store.getDataDir(), "em-settings.json"),
    };
  }
  static async create(store: Store): Promise<NativeConfig> {
    const repo = new NativeConfig(store);
    await repo.storage.initialize();
    await repo.migrate();
    await repo.refresh();
    registerNativeSettingsView(store.getDataDir(), () => repo.view());
    return repo;
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }
  private revision(): string {
    return createHash("sha256").update(JSON.stringify([
      readText(this.files.models), readText(this.files.auth), readText(this.files.settings),
      getPath(this.storage.read(this.files.em), EM_PATH.providerPreferences),
    ])).digest("hex");
  }
  private originals() { return new Map(Object.values(this.files).map(file => [file, readText(file)])); }
  async refresh(): Promise<ModelRuntime> {
    this.storage.assertReady();
    const revision = this.revision();
    if (this.runtime && revision === this.fingerprint) return this.runtime;
    const MR = await getModelRuntimeClass();
    // Keep one runtime identity: existing AgentSessions also hold this object.
    // Replacing it would leave their provider/auth composition on an old snapshot.
    const runtime = this.runtime ?? await MR.create({
      modelsPath: this.files.models, authPath: this.files.auth,
      modelsStorePath: path.join(this.storage.agentDir, "models-store.json"), allowModelNetwork: false,
    });
    if (this.runtime) await runtime.refresh({ allowNetwork: false });
    const error = runtime.getError();
    if (error) throw new Error(`无法读取 pi 模型配置：${error}`);
    const settings = this.storage.read(this.files.settings);
    validateDefaults(settings);
    const sdk = await getPiConfigSdk();
    this.initialModel = (await sdk.findInitialModel({ scopedModels: [], isContinuing: false,
      defaultProvider: settings.defaultProvider, defaultModelId: settings.defaultModel,
      defaultThinkingLevel: settings.defaultThinkingLevel, modelThinkingLevels: settings.modelThinkingLevels, modelRuntime: runtime })).model;
    this.runtime = runtime;
    this.fingerprint = revision;
    return runtime;
  }
  getDefaultModel() { return this.initialModel ?? null; }
  async getRuntime(): Promise<ModelRuntime> { return this.serial(() => this.refresh()); }
  view(): { apiProviders: ApiProvidersData; chatThinkingLevel: string; model?: string; availableModels: string[] } {
    const models = this.storage.read(this.files.models).providers ?? {};
    const auth = this.storage.read(this.files.auth);
    const settings = this.storage.read(this.files.settings);
    const preferences = (getPath(this.storage.read(this.files.em), EM_PATH.providerPreferences) ?? {}) as JsonObject;
    const ids = new Set<string>([...Object.keys(models), ...Object.keys(auth), ...Object.keys(preferences)]);
    // 默认供应商只在**真实存在**时才纳入列表：settings.json 被外部改过（或跨版本混用）时它可能
    // 是一个早就删掉的 id，无条件 add 会让界面上多出一个点不开的空壳条目（无凭据、无模型——
    // 实测过：删掉供应商后手改 defaultProvider，列表里就多一条）。三处声明与 runtime 都不认识
    // 它就判为悬空、不纳入；模型侧另有回落（findInitialModel 会挑一个可用的），不受影响。
    if (settings.defaultProvider
      && (models[settings.defaultProvider] || auth[settings.defaultProvider]
        || preferences[settings.defaultProvider] || this.runtime.getProvider(settings.defaultProvider))) {
      ids.add(settings.defaultProvider);
    }
    for (const p of this.runtime.getProviders()) if (this.runtime.hasConfiguredAuth(p.id)) ids.add(p.id);
    const configs: Record<string, ProviderConfig> = {};
    const revision = this.revision();
    const effectiveProvider = this.initialModel?.provider ?? settings.defaultProvider;
    for (const id of ids) {
      const provider = this.runtime.getProvider(id);
      const list = this.runtime.getModels(id);
      const raw = models[id] ?? {};
      const pref = preferences[id] ?? {};
      const isBuiltin = getProviderStaticModels(id).size > 0;
      configs[id] = {
        id, nativeRevision: revision, presetId: isBuiltin ? id : "custom",
        name: raw.name ?? provider?.name ?? id,
        // Preserve references (!command / ENV_VAR) as references; never resolve them in the UI.
        apiKey: auth[id]?.type === "api_key" ? auth[id].key : raw.apiKey ?? "",
        authType: auth[id]?.type === "oauth" ? "oauth" : "api_key",
        model: this.initialModel?.provider === id ? this.initialModel.id : settings.defaultProvider === id ? settings.defaultModel ?? "" : pref.lastModel ?? list[0]?.id ?? "",
        models: list.map(m => m.id), createdAt: pref.createdAt ?? 0,
        baseUrl: raw.baseUrl, apiType: raw.api,
        extraModels: (raw.models ?? []).map((m: JsonObject) => {
          const effective = list.find(item => item.id === m.id);
          return Object.fromEntries(["id", ...PARAM_FIELDS].map(key => [key, m[key] ?? (effective as any)?.[key]]));
        }),
        modelOverrides: raw.modelOverrides,
      };
    }
    const current = effectiveProvider && configs[effectiveProvider] ? effectiveProvider : null;
    return {
      apiProviders: { current, configs, revision },
      chatThinkingLevel: settings.defaultThinkingLevel ?? "medium",
      model: current ? configs[current]?.model : settings.defaultModel, availableModels: current ? configs[current]!.models : [],
    };
  }

  /**
   * 两段一次性迁移。**顺序不能颠倒**：先重排 em-settings.json 的结构，再跑 pi 原生真源迁移——
   * 后者读写的 `providerPreferences` 等字段要到第一步之后才位于新路径上；反过来的话它会读不到，
   * 会把用户已有的供应商 UI 元数据当成"没有"而重建。
   */
  private async migrate(): Promise<void> {
    this.assertSupportedVersions();
    await this.migrateEmSettingsShape();
    await this.migratePiNative();
    // 第三步：清掉会话缓存里指向「已不存在的供应商」的绑定。**刻意不设版本标记**——它幂等、
    // 只在真有悬挂时才写盘，而且必须能覆盖「迁移之后才产生的悬挂」（删供应商发生在任意时刻，
    // 不是一次性事件）。前置的两步只改写「在本次迁移映射里」的 id，管不到后续的悬挂。
    await this.pruneDanglingSessionRefs();
  }

  /**
   * 版本检查：任一标记高于本版支持值就拒绝加载，且**不碰文件**。
   * 必须独立于具体迁移步骤——否则第一步已经改了文件、第二步才发现版本过高，
   * 就把"拒绝新版本、原文件保持原样"这条承诺破坏了。
   */
  private assertSupportedVersions(): void {
    const em = this.storage.read(this.files.em);
    const schema = getPath(em, EM_PATH.migrationSchemaVersion);
    if (schema !== undefined && schema !== EM_SCHEMA_VERSION) throw new Error("此配置来自更新版本的 EM，请使用对应版本打开");
    // 兼容读旧扁平键：版本标记本身也可能还在旧位置
    const native = getPath(em, EM_PATH.migrationNativeVersion) ?? em.nativeConfigVersion;
    if (native !== undefined && native !== 1) throw new Error("此配置来自更新版本的 EM，请使用对应版本打开");
  }

  /**
   * 一次性把 em-settings.json 从扁平结构重排为分组结构（**只改位置，不改语义**）。
   *
   * 搬迁范围（路径声明集中在 `em-settings-schema`）：
   * - `SETTINGS_FIELDS` / `NATIVE_CONFIG_FIELDS`：Store 与本文件读写的字段；
   * - `EXTERNAL_FIELD_MOVES`：外部模块直写的字段（hiddenSkills / hiddenMcpServers /
   *   mcpApproved / sandboxExtraDomains）；
   * - `apiKeys`：拆成 `capabilities.vision.*` + `capabilities.web.apiKey` + `env` 池。
   *   这是唯一"改名"的一处——它的键名本就是注入给 MCP server 的环境变量名，
   *   不能改成嵌套对象，否则注入契约断掉。
   *
   * 安全要点：**幂等**（版本已是当前值就直接返回，连文件都不碰）；**走事务**
   * （与 pi 原生迁移共用 `storage.commit`，白得备份、恢复日志、外部修改检测与中断回滚）；
   * **值原样**（除 apiKeys 的结构拆分外一个字节不改，也不做类型归一化——那是读侧职责）。
   */
  private async migrateEmSettingsShape(): Promise<void> {
    const em = this.storage.read(this.files.em);
    if (getPath(em, EM_PATH.migrationSchemaVersion) === EM_SCHEMA_VERSION) return;
    const originals = this.originals();

    for (const [field, flatKey] of [...SETTINGS_FIELDS, ...NATIVE_CONFIG_FIELDS, ...EXTERNAL_FIELD_MOVES]) {
      if (!(flatKey in em)) continue;   // 旧键不在：新位置可能已有值，保持不动
      const value = em[flatKey];
      deletePath(em, flatKey);
      // **新位置优先**：两处都有值时不用旧值盖掉已排好的新值。正常路径下不可达（新位置只在
      // 本步跑过之后才存在），写成这样是为了让这段循环被复用时不会静默用旧值覆盖新值。
      if (value !== undefined && getPath(em, field) === undefined) setPath(em, field, value);
    }
    if (em.apiKeys !== undefined) {
      applyApiKeysToDisk(em, em.apiKeys as Record<string, string>);
      deletePath(em, "apiKeys");
    }
    setPath(em, EM_PATH.migrationSchemaVersion, EM_SCHEMA_VERSION);

    await this.storage.commit(new Map([[this.files.em, em]]), "em-settings-shape", originals);
  }

  private async migratePiNative(): Promise<void> {
    const originals = this.originals();
    const em = this.storage.read(this.files.em);
    // 幂等：原生迁移已完成就不再动文件。版本过高不在这里判——`assertSupportedVersions()` 已在
    // **动文件之前**拦下（见 `migrate()` 的调用顺序），此处再判一次是永不成立的分支。
    if (getPath(em, EM_PATH.migrationNativeVersion) === 1) return;
    const models = this.storage.read(this.files.models);
    models.providers ??= {};
    const auth = this.storage.read(this.files.auth);
    const settings = this.storage.read(this.files.settings);
    // Run previous migrations on an in-memory copy, before *any* original is changed.
    let legacy = { ...this.store.getSettings() };
    const adapter = { getSettings: () => legacy, saveSettings: (value: typeof legacy) => { legacy = value; } } as Store;
    migrateExtraModels(adapter);
    migrateModelIdentity(adapter);
    const old = legacy.apiProviders;
    const ordered = Object.values(old?.configs ?? {}).sort((a, b) =>
      a.id === old?.current ? -1 : b.id === old?.current ? 1 : a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const selected = new Set<string>();
    const aliases: Record<string, string> = {};
    const duplicates: string[] = [];
    const preferences: JsonObject = { ...((getPath(em, EM_PATH.providerPreferences) as JsonObject | undefined) ?? {}) };
    for (const cfg of ordered) {
      const id = nativeProviderId(cfg) || cfg.id;
      aliases[cfg.id] = id;
      const duplicate = selected.has(id);
      if (duplicate) duplicates.push(cfg.id);
      selected.add(id);
      const existing = models.providers[id] ?? {};
      const next: JsonObject = { name: cfg.name || id, ...existing };
      const custom = !cfg.presetId || cfg.presetId === "custom";
      if (custom) {
        next.baseUrl ??= cfg.baseUrl;
        next.api ??= cfg.apiType || "anthropic-messages";
      }
      const extras = normalizeExtraModels(cfg.extraModels);
      const declarations = new Map(extras.map(e => [e.id, e]));
      const ids = custom ? [...new Set([...(cfg.models ?? []), ...declarations.keys()])] : [...declarations.keys()];
      const nativeModels = new Map<string, JsonObject>((existing.models ?? []).map((m: JsonObject) => [m.id, m]));
      for (const modelId of ids) {
        if (nativeModels.has(modelId) || (!custom && getProviderStaticModels(id).has(modelId))) continue; // Native hand-written values win.
        const declaration = declarations.get(modelId);
        const entry = declaration?.entry ?? {};
        // Retain old custom-provider defaults during migration only.
        nativeModels.set(modelId, {
          contextWindow: 200000, maxTokens: 32768,
          ...(custom ? { reasoning: true, input: ["text"], compat: { supportsDeveloperRole: false }, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } : {}),
          ...entry, id: modelId, name: declaration?.name ?? modelId,
        });
      }
      if (nativeModels.size) next.models = [...nativeModels.values()];
      const oldOverrides = Object.fromEntries(Object.entries(cfg.modelOverrides ?? {}).filter(([modelId]) => !getProviderStaticModels(id).has(modelId)));
      if (Object.keys(oldOverrides).length) next.modelOverrides = { ...oldOverrides, ...existing.modelOverrides };
      ensureNativeProvider(next);
      models.providers[id] = next;
      // Legacy runtime overrides took priority over auth.json; preserve that effective key.
      if (!duplicate && cfg.authType !== "oauth" && cfg.apiKey) auth[id] = { type: "api_key", key: cfg.apiKey };
      if (!duplicate) preferences[id] = { ...preferences[id], createdAt: cfg.createdAt, lastModel: cfg.model };
    }
    const active = old?.current ? old.configs[old.current] : undefined;
    if (active) {
      settings.defaultProvider = nativeProviderId(active) || active.id;
      settings.defaultModel = active.model;
    }
    const hadThinkingLevel = em.chatThinkingLevel !== undefined;
    if (em.chatThinkingLevel && (THINKING_ORDER as readonly string[]).includes(em.chatThinkingLevel)) settings.defaultThinkingLevel = em.chatThinkingLevel;
    setPath(em, EM_PATH.providerPreferences, preferences);
    // Old EM tab/session-cache references only.
    setPath(em, EM_PATH.providerLegacyIds, { ...(getPath(em, EM_PATH.providerLegacyIds) as JsonObject | undefined), ...aliases });
    setPath(em, EM_PATH.migrationNativeVersion, 1);
    setPath(em, EM_PATH.migrationNativeRecord, { migratedAt: new Date().toISOString(), duplicateConfigIds: duplicates });
    for (const field of LEGACY_FIELDS) delete em[field];
    validateDefaults(settings);
    await this.storage.validateModels(models);
    const values = new Map<string, JsonObject>([[this.files.em, em]]);
    if (selected.size) { values.set(this.files.models, models); values.set(this.files.auth, auth); }
    if (active || hadThinkingLevel) values.set(this.files.settings, settings);
    const cacheDir = path.join(this.store.getDataDir(), "session-cache");
    if (fs.existsSync(cacheDir)) for (const entry of fs.readdirSync(cacheDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const file = path.join(cacheDir, entry.name);
      const before = readText(file);
      let cache: JsonObject;
      try { cache = this.storage.read(file); } catch { continue; }
      if (typeof cache.provider === "string" && aliases[cache.provider] && aliases[cache.provider] !== cache.provider) {
        originals.set(file, before);
        values.set(file, { ...cache, provider: aliases[cache.provider] });
      }
    }
    const backup = await this.storage.commit(values, "pi-native-v1", originals);
    if (ordered.length) console.info(`[config] 原生配置迁移完成，备份：${backup}；重复配置 ${duplicates.length} 份保留在备份中`);
  }

  /**
   * 把会话缓存里指向「已不存在的供应商」的绑定清掉（`provider` 与 `model` 两个字段）。
   *
   * 为什么需要：删供应商不会回头改会话缓存（另一条存储），被删的 id 会长期留在那些会话的缓存里。
   * 之后打开这些会话时模型解析失败、只能回落到全局默认——会话能用，但显示的模型与它实际用过
   * 的对不上，且没有任何提示（用户实测里就有这么一个：9/12 删掉的供应商，缓存里留到今天）。
   *
   * 判据用「三处声明（models / auth / preferences）都查不到」，**不用 runtime**——调用时机可能在
   * runtime 建立之前（迁移段）。三处全空时直接跳过：那是「还没配过任何供应商」的全新配置，
   * 不是「供应商被删了」，不能把人家所有绑定当悬空清掉。
   *
   * 返回改动（文件 → 新内容），由调用方并入自己的事务；无改动即空 Map。会顺带把 `originals`
   * 补上这些文件的原文（commit 需要它才能做外部修改检测与备份）。
   */
  private pruneSessionCacheRefs(
    models: JsonObject, auth: JsonObject, preferences: JsonObject, originals: Map<string, string | null>,
  ): Map<string, JsonObject> {
    const changes = new Map<string, JsonObject>();
    const known = new Set([...Object.keys(models.providers ?? {}), ...Object.keys(auth), ...Object.keys(preferences)]);
    if (!known.size) return changes;
    const dir = path.join(this.store.getDataDir(), "session-cache");
    if (!fs.existsSync(dir)) return changes;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const file = path.join(dir, entry.name);
      const before = readText(file);
      let cache: JsonObject;
      try { cache = this.storage.read(file); } catch { continue; }   // 已损坏的缓存不碰
      if (typeof cache.provider !== "string" || known.has(cache.provider)) continue;
      const next: JsonObject = { ...cache };
      delete next.provider;
      delete next.model;   // 模型名脱离供应商就没有意义了（同名模型可能属于别的供应商）
      originals.set(file, before);
      changes.set(file, next);
    }
    return changes;
  }

  /** 启动兜底：清存量悬挂引用。无悬挂时**不写盘、不产生备份**。 */
  private async pruneDanglingSessionRefs(): Promise<void> {
    const originals = this.originals();
    const em = this.storage.read(this.files.em);
    const changes = this.pruneSessionCacheRefs(
      this.storage.read(this.files.models), this.storage.read(this.files.auth),
      (getPath(em, EM_PATH.providerPreferences) ?? {}) as JsonObject, originals,
    );
    if (!changes.size) return;
    const backup = await this.storage.commit(changes, "session-cache-prune", originals);
    console.info(`[config] 清理了 ${changes.size} 个指向已删除供应商的会话缓存（备份：${backup}）`);
  }

  resolveProviderId(id: string): string {
    const legacy = getPath(this.storage.read(this.files.em), EM_PATH.providerLegacyIds) as Record<string, string> | undefined;
    return legacy?.[id] ?? id;
  }
  async importPi(sourceDir: string, apply = false, probe = false) {
    // probe 是零 IO 的目录存在性检查（不碰本实例状态、不读文件内容），
    // 不进 serial 队列——挂在引导页/设置页挂载时机，若与导入等重事务互斥排队，
    // 探测会被无关事务拖延。
    if (probe) return probePiImport(sourceDir);
    return this.serial(async () => {
      await this.refresh();
      const plan = await buildPiImport(this, sourceDir);
      if (!apply || !plan.summary.found) return plan.summary;
      const backup = await this.storage.commit(plan.values, "pi-import", plan.originals, plan.sessions);
      await this.refresh();
      return { ...plan.summary, backup };
    });
  }
  async setThinkingLevel(level: string): Promise<void> {
    return this.serial(async () => {
      if (!(THINKING_ORDER as readonly string[]).includes(level)) throw new Error("无效的思考等级");
      const before = this.originals();
      const settings = this.storage.read(this.files.settings);
      settings.defaultThinkingLevel = level;
      validateDefaults(settings);
      await this.storage.commit(new Map([[this.files.settings, settings]]), "settings", before);
      await this.refresh();
    });
  }
  async setDefaultModel(modelId: string): Promise<void> {
    return this.serial(async () => {
      await this.refresh();
      const before = this.originals();
      const settings = this.storage.read(this.files.settings);
      const providerId = settings.defaultProvider ?? this.initialModel?.provider;
      if (!providerId || !this.runtime.getModel(providerId, modelId)) {
        throw new Error(`默认供应商中不存在模型：${modelId}`);
      }
      settings.defaultProvider = providerId;
      settings.defaultModel = modelId;
      validateDefaults(settings);
      await this.storage.commit(new Map([[this.files.settings, settings]]), "settings", before);
      await this.refresh();
    });
  }
  async saveProviders(data: ApiProvidersData): Promise<void> {
    return this.serial(async () => {
      await this.refresh();
      const before = this.view().apiProviders;
      if (!data.revision || data.revision !== before.revision) throw new Error("供应商配置已更新，请重新打开设置后保存");
      const originals = this.originals();
      const models = this.storage.read(this.files.models);
      models.providers ??= {};
      const auth = this.storage.read(this.files.auth);
      const settings = this.storage.read(this.files.settings);
      const em = this.storage.read(this.files.em);
      if (getPath(em, EM_PATH.providerPreferences) === undefined) setPath(em, EM_PATH.providerPreferences, {});
      const preferences = getPath(em, EM_PATH.providerPreferences) as JsonObject;
      const seen = new Set<string>();
      for (const [id, cfg] of Object.entries(data.configs)) {
        if (!id || id !== cfg.id || nativeProviderId(cfg) !== id || seen.has(id)) throw new Error("每个供应商只能保存一份配置");
        seen.add(id);
        const previous = before.configs[id];
        if (same(previous, cfg)) continue;
        if (previous && cfg.nativeRevision && cfg.nativeRevision !== previous.nativeRevision) throw new Error("此供应商在编辑期间已更新，请重新打开编辑窗口");
        // 新建必填凭据：界面层已拦（ProviderSettings 仅在新增时要求 API Key），这里是绕过界面时的兜底。
        // 编辑态凭据可能只在 auth.json，不拦——空 apiKey 也不会抹掉已有凭据（只在非空时才写 auth）。
        if (!previous && cfg.authType !== "oauth" && !cfg.apiKey?.trim() && auth[id]?.type !== "api_key") {
          throw new Error(`新建供应商「${cfg.name || id}」缺少 API Key`);
        }
        const raw: JsonObject = { ...(models.providers[id] ?? {}) };
        for (const [ui, native] of [["name", "name"], ["baseUrl", "baseUrl"], ["apiType", "api"]] as const) {
          if (!same(cfg[ui], previous?.[ui])) {
            if (cfg[ui]) raw[native] = cfg[ui]; else delete raw[native];
          }
        }
        if (!same(cfg.extraModels, previous?.extraModels)) {
          const existing = new Map<string, JsonObject>((raw.models ?? []).map((m: JsonObject) => [m.id, m]));
          const prior = new Map(normalizeExtraModels(previous?.extraModels).map(e => [e.id, e.entry]));
          const next = normalizeExtraModels(cfg.extraModels).map(e => {
            const model: JsonObject = { ...(existing.get(e.id) ?? {}), id: e.id };
            for (const field of PARAM_FIELDS) {
              const value = field === "name" ? e.name : (e.entry as any)?.[field];
              if (!same(value, (prior.get(e.id) as any)?.[field])) {
                if (value === undefined) delete model[field]; else model[field] = value;
              }
            }
            return model;
          });
          if (next.length) raw.models = next; else delete raw.models;
        }
        // Overrides not exposed by this UI remain untouched.
        ensureNativeProvider(raw);
        models.providers[id] = raw;
        if (cfg.authType !== "oauth" && cfg.apiKey !== previous?.apiKey) {
          if (cfg.apiKey) auth[id] = { type: "api_key", key: cfg.apiKey };
          else if (auth[id]?.type === "api_key") delete auth[id];
          // An edited key moves to auth.json; remove the competing original key.
          delete raw.apiKey;
        }
        preferences[id] = { ...preferences[id], createdAt: cfg.createdAt, lastModel: cfg.model };
      }
      for (const id of Object.keys(before.configs)) if (!data.configs[id]) {
        delete models.providers[id]; delete auth[id]; delete preferences[id];
      }
      if (data.current && (data.current !== before.current || data.configs[data.current]?.model !== before.configs[data.current]?.model)) {
        const current = data.configs[data.current];
        if (!current) throw new Error("默认供应商不存在");
        settings.defaultProvider = data.current;
        settings.defaultModel = current.model;
      } else if (!data.current) { delete settings.defaultProvider; delete settings.defaultModel; }
      validateDefaults(settings);
      await this.storage.validateModels(models);
      const values = new Map<string, JsonObject>([
        [this.files.models, models], [this.files.auth, auth], [this.files.settings, settings], [this.files.em, em],
      ]);
      // 删供应商的**源头清理**：会话缓存里指向它的绑定要一起清掉，否则那些会话今后每次打开
      // 都会走「模型不可用 → 回落全局默认」（见 pruneSessionCacheRefs）。并入同一事务 →
      // 与供应商删除同生共死，不会出现「配置删了、缓存没清」的半截状态。
      for (const [file, value] of this.pruneSessionCacheRefs(models, auth, preferences, originals)) values.set(file, value);
      await this.storage.commit(values, "provider-edit", originals);
      await this.refresh();
    });
  }
}
