/** 用户提示配置的唯一真源；读接口不写盘，迁移在显式初始化／保存时提交。 */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { MainChatProfile, CollaborationMode, ConversationConfig } from "../../shared/collaboration";
import { UI_DESIGN_MODE_ID, DOMAIN_GUIDANCE_MODE_ID } from "../../shared/collaboration";
import { DESIGNER_TEMPLATE_DIR, designerTemplateTable } from "../../shared/designer-templates";
import type { AgentTemplate } from "./agent-templates";
import { emHome, getResourcesDir } from "../utils/paths";
import { sectionText, writeSection } from "../../shared/memory-doc";
import { atomicWrite, encode, lockConfigDirectory, readText } from "./native-config-storage";

const mainSchema = z.object({
  nickname: z.string().trim().min(1).max(40),
  avatar: z.string().max(1024 * 1024).refine(value => !value || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)),
  personality: z.string(), rules: z.string(),
});
const modeFields = z.object({ name: z.string().trim().min(1).max(40), scenario: z.string().max(200),
  prompt: z.string().refine(value => !!value.trim()), defaultEnabled: z.boolean() });
const templateFields = z.object({ name: z.string().min(1), description: z.string(),
  prompt: z.string().refine(value => !!value.trim()), agentType: z.string().optional() });
const id = z.string().min(1);
const templateOverride = templateFields.partial().extend({ id });
const modeOverride = modeFields.partial().extend({ id });
const storeSchema = z.object({ version: z.literal(2), main: mainSchema.partial(),
  templates: z.array(templateOverride), modes: z.array(modeOverride),
  legacyPrompts: z.array(z.unknown()).optional(), legacyTemplates: z.array(z.unknown()).optional(),
  migration: z.object({ backup: z.string().regex(/^prompts-v2-[a-f0-9]{16}$/), templateHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).optional(),
}).strict();
type PromptStore = z.infer<typeof storeSchema>;
interface Defaults { main: MainChatProfile; templates: AgentTemplate[]; modes: CollaborationMode[]; legacyDesigner: string; legacyHashes: Record<string, string> }
interface Snapshot { config: PromptStore; raw: string | null; templatesRaw: string | null; legacy: boolean; warning?: string }
const hash = (value: unknown): string => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const configPath = () => path.join(emHome(), "system-prompts.json");
const templatesPath = () => path.join(emHome(), "agent-templates.json");
let defaultsCache: { file: string; value: Defaults } | undefined;
const lastValid = new Map<string, Snapshot>();
const initializationWarnings = new Map<string, string>();
const builtinTemplateIds = new Set(["default-builder", "default-evaluator"]);
const retiredIds = new Set(["mint", "mint-designer", "default-orchestrator"]);

function parseJson(raw: string, file: string): unknown {
  try { return JSON.parse(raw.replace(/^\uFEFF/, "")); }
  catch { throw new Error(`提示词配置不是合法 JSON：${file}（原文件已保留）`); }
}
function unique(items: Array<{ id: string }>, label: string): void {
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error(`${label}包含重复 ID`);
}

export function getPromptDefaults(): Defaults {
  const file = path.join(getResourcesDir(), "prompts", "defaults.json");
  if (defaultsCache?.file === file) return structuredClone(defaultsCache.value);
  let raw: unknown;
  try { raw = parseJson(fs.readFileSync(file, "utf8"), file); }
  catch { throw new Error(`无法加载应用默认提示词：${file}`); }
  const nonempty = z.string().refine(value => !!value.trim());
  const parsed = z.object({ version: z.literal(1), main: mainSchema.extend({ personality: nonempty, rules: nonempty }),
    templates: z.array(templateFields.extend({ id })),
    modes: z.array(modeFields.omit({ prompt: true }).extend({ id })),
    design: z.object({ guidelines: nonempty, mainPrefix: nonempty, mainSuffix: nonempty, legacyPrefix: nonempty, legacySuffix: nonempty }),
    legacyHashes: z.record(z.string(), z.string()),
  }).safeParse(raw);
  if (!parsed.success) throw new Error(`应用默认提示词格式无效：${file}`);
  const data = parsed.data;
  if (data.templates.length !== 2 || !["default-builder", "default-evaluator"].every(id => data.templates.some(template => template.id === id && template.agentType === (id === "default-builder" ? "builder" : "evaluator")))) throw new Error(`应用默认执行模板不完整：${file}`);
  if (data.modes.length !== 2 || ![UI_DESIGN_MODE_ID, DOMAIN_GUIDANCE_MODE_ID].every(id => data.modes.some(mode => mode.id === id))) throw new Error(`应用默认模式不完整：${file}`);
  const reference = `\n\n## 设计资源说明\n模板目录：${DESIGNER_TEMPLATE_DIR}/\n${designerTemplateTable()}`;
  const ui = [data.design.mainPrefix, data.design.guidelines, data.design.mainSuffix, reference].join("\n\n");
  const guidancePath = path.join(getResourcesDir(), "prompts", "domain-guidance.md");
  const guidance = fs.readFileSync(guidancePath, "utf8").trim();
  if (!guidance) throw new Error(`应用领域引导提示词为空：${guidancePath}`);
  const value: Defaults = { main: data.main, templates: data.templates.map(item => ({ ...item, agentType: item.agentType ?? "custom" })),
    modes: data.modes.map(mode => ({ ...mode, builtin: true, prompt: mode.id === UI_DESIGN_MODE_ID ? ui : guidance })),
    legacyDesigner: [data.design.legacyPrefix, data.design.guidelines, data.design.legacySuffix, `## 设计资源说明\n模板目录：${DESIGNER_TEMPLATE_DIR}/`].join("\n\n"), legacyHashes: data.legacyHashes };
  unique(value.templates, "内置模板"); unique(value.modes, "内置模式");
  if (!value.modes.some(mode => mode.id === UI_DESIGN_MODE_ID) || !value.modes.some(mode => mode.id === DOMAIN_GUIDANCE_MODE_ID)) throw new Error("应用默认模式不完整");
  defaultsCache = { file, value };
  return structuredClone(value);
}

function emptyStore(): PromptStore { return { version: 2, main: {}, templates: [], modes: [] }; }
function validated(config: unknown): PromptStore {
  const parsed = storeSchema.safeParse(config);
  if (!parsed.success) throw new Error(`提示词配置字段无效：${configPath()}（原文件已保留）`);
  unique(parsed.data.templates, "执行模板"); unique(parsed.data.modes, "协作模式");
  // 自定义对象不能缺字段；内置对象才允许只存覆盖项。
  for (const template of parsed.data.templates) {
    if (retiredIds.has(template.id)) throw new Error("主对话和旧角色不能注册为执行模板");
    if (!builtinTemplateIds.has(template.id)) templateFields.parse(template);
    else if (template.agentType !== undefined && template.agentType !== getPromptDefaults().templates.find(item => item.id === template.id)?.agentType) throw new Error("内置模板不可修改执行类型");
  }
  const builtinModes = new Set(getPromptDefaults().modes.map(mode => mode.id));
  for (const mode of parsed.data.modes) if (!builtinModes.has(mode.id)) modeFields.parse(mode);
  return parsed.data;
}

function convertLegacy(raw: string | null, templatesRaw: string | null): PromptStore {
  const config = emptyStore();
  const legacy = raw === null ? {} : parseJson(raw, configPath());
  if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) throw new Error("旧提示词配置必须是对象");
  const data = legacy as { prompts?: Array<Record<string, unknown>>; defaultPromptId?: string;
    conversation?: { useBuiltinRules?: boolean; main?: Partial<MainChatProfile>; modes?: Array<Record<string, unknown>> } };
  if (data.prompts !== undefined && !Array.isArray(data.prompts)) throw new Error("旧提示词列表格式无效");
  const selected = data.prompts?.find(item => item.id === data.defaultPromptId && item.id !== "builtin-default");
  if (!data.conversation?.useBuiltinRules && selected && typeof selected.content === "string") config.main.rules = selected.content;
  Object.assign(config.main, data.conversation?.main ?? {});
  config.modes = (data.conversation?.modes ?? []).map(mode => {
    const saved = modeOverride.parse(mode);
    const baseline = getPromptDefaults().modes.find(item => item.id === saved.id);
    // 旧版会展开内置标签；与默认相同不是用户改名，继续沿用原来的翻译行为。
    for (const key of ["name", "scenario"] as const) if (baseline && saved[key] === baseline[key]) delete saved[key];
    return saved;
  });
  // 未选中的自定义提示词也保留；不会参与新版运行时优先级。
  if (data.prompts?.length) config.legacyPrompts = structuredClone(data.prompts);
  if (templatesRaw !== null) {
    const templates = z.array(templateFields.extend({ id, customized: z.boolean().optional() })).parse(parseJson(templatesRaw, templatesPath()));
    unique(templates, "旧执行模板");
    const defaults = getPromptDefaults();
    for (const template of templates) {
      if (retiredIds.has(template.id)) continue;
      const baseline = defaults.templates.find(item => item.id === template.id);
      if (!baseline) config.templates.push({ id: template.id, ...templateFields.parse(template), agentType: template.agentType ?? "custom" });
      else {
        const saved: z.infer<typeof templateOverride> = { id: template.id };
        for (const key of ["name", "description"] as const) if (template[key] !== baseline[key]) saved[key] = template[key];
        const oldHash = defaults.legacyHashes[template.id === "default-builder" ? "BUILDER_AGENT_PROMPT" : "EVALUATOR_AGENT_PROMPT"];
        if (template.customized || hash(template.prompt) !== oldHash) saved.prompt = template.prompt;
        if (Object.keys(saved).length > 1) config.templates.push(saved);
      }
    }
    config.legacyTemplates = JSON.parse(templatesRaw);
  }
  return validated(config);
}

function strictSnapshot(): Snapshot {
  const raw = readText(configPath());
  const cached = lastValid.get(configPath());
  if (raw !== null && cached && !cached.legacy && cached.raw === raw) return structuredClone(cached);
  const parsed = raw === null ? undefined : parseJson(raw, configPath());
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "version" in parsed) {
    return { config: validated(parsed), raw, templatesRaw: null, legacy: false };
  }
  const templatesRaw = readText(templatesPath());
  return { config: convertLegacy(raw, templatesRaw), raw, templatesRaw, legacy: raw !== null || templatesRaw !== null };
}
function readSnapshot(): Snapshot {
  getPromptDefaults(); // 默认资源损坏不能被当作用户配置错误而静默兜底。
  try {
    const snapshot = strictSnapshot();
    lastValid.set(configPath(), structuredClone(snapshot));
    return { ...snapshot, warning: initializationWarnings.get(configPath()) };
  } catch (error) {
    const previous = lastValid.get(configPath());
    const warning = `${error instanceof Error ? error.message : "提示词配置读取失败"}。${previous ? "当前沿用上一份有效配置" : "当前使用应用默认配置"}，未应用本次文件修改。`;
    return { ...(previous ? structuredClone(previous) : { config: emptyStore(), raw: null, templatesRaw: null, legacy: false }), warning };
  }
}
function resolvedModes(config: PromptStore): CollaborationMode[] {
  const defaults = getPromptDefaults();
  const baselineIds = new Set(defaults.modes.map(mode => mode.id));
  return [...defaults.modes.map(mode => {
    const saved = config.modes.find(item => item.id === mode.id);
    return { ...mode, ...saved, builtin: true, customizedFields: (["name", "scenario"] as const).filter(key => saved?.[key] !== undefined) };
  }), ...config.modes.filter(mode => !baselineIds.has(mode.id)).map(mode => ({ ...modeFields.parse(mode), id: mode.id, builtin: false }))]
    .map(mode => ({ ...mode, revision: hash(mode) }));
}
function resolvedTemplates(config: PromptStore): AgentTemplate[] {
  const defaults = getPromptDefaults();
  return [...defaults.templates.map(template => ({ ...template, ...config.templates.find(item => item.id === template.id), agentType: template.agentType })),
    ...config.templates.filter(template => !builtinTemplateIds.has(template.id)).map(template => ({ ...templateFields.parse(template), id: template.id, agentType: template.agentType ?? "custom" }))]
    .map(template => ({ ...template, customized: config.templates.some(item => item.id === template.id && item.prompt !== undefined), revision: hash(template) }));
}
function checkRevision(actual: string | undefined, expected?: string): void {
  if (expected !== undefined && actual !== expected) throw new Error("此项提示词已被其他窗口或程序修改，请重新打开后保存（当前编辑未覆盖磁盘）");
}

/** 先保存两份原始字节，再原子切换唯一真源；中断时旧文件或完整新版至少有一份可读。 */
function commit(snapshot: Snapshot, config: PromptStore): void {
  config = validated(config);
  if (snapshot.legacy) {
    const backup = `prompts-v2-${hash([snapshot.raw, snapshot.templatesRaw]).slice(0, 16)}`;
    const dir = path.join(emHome(), "config-backups", backup);
    if (snapshot.raw !== null) atomicWrite(path.join(dir, "system-prompts.json"), snapshot.raw);
    if (snapshot.templatesRaw !== null) atomicWrite(path.join(dir, "agent-templates.json"), snapshot.templatesRaw);
    config.migration = { backup, ...(snapshot.templatesRaw !== null ? { templateHash: hash(snapshot.templatesRaw) } : {}) };
  }
  if (readText(configPath()) !== snapshot.raw || (snapshot.legacy && readText(templatesPath()) !== snapshot.templatesRaw)) throw new Error("提示词配置已更新，请重新加载后保存");
  atomicWrite(configPath(), encode(config));
  lastValid.set(configPath(), { config, raw: encode(config), templatesRaw: null, legacy: false });
  archiveLegacyTemplates(config);
  initializationWarnings.delete(configPath());
}
function archiveLegacyTemplates(config: PromptStore): void {
  if (!config.migration?.templateHash) return;
  const raw = readText(templatesPath());
  if (raw === null || hash(raw) !== config.migration.templateHash) return;
  const backup = path.join(emHome(), "config-backups", config.migration.backup, "agent-templates.json");
  if (readText(backup) !== raw) throw new Error("旧模板备份不匹配，保留旧文件后停止清理");
  fs.unlinkSync(templatesPath());
}
function mutate(edit: (config: PromptStore) => void): void {
  const release = lockConfigDirectory(emHome());
  try {
    const snapshot = strictSnapshot();
    const config = structuredClone(snapshot.config);
    edit(config);
    commit(snapshot, config);
  } finally { release(); }
}
export function initializePromptConfiguration(): void {
  const release = lockConfigDirectory(emHome());
  try {
    const snapshot = strictSnapshot();
    if (snapshot.legacy) commit(snapshot, snapshot.config);
    else archiveLegacyTemplates(snapshot.config);
    initializationWarnings.delete(configPath());
  } finally { release(); }
}

/** 初始化失败保留设置入口；读接口仍独立报告坏配置，默认资源损坏仍阻止相关会话创建。 */
export function initializePromptConfigurationForStartup(): string | undefined {
  try { initializePromptConfiguration(); }
  catch (error) {
    const warning = `提示词配置初始化未完成：${error instanceof Error ? error.message : "未知错误"}。原配置或迁移备份已保留，可在设置中检查。`;
    try { strictSnapshot(); initializationWarnings.set(configPath(), warning); }
    catch { /* 解析失败由只读入口提供当前诊断，不阻断应用其余IPC注册。 */ }
    return warning;
  }
}

export function getConversationConfig(): ConversationConfig {
  const { config, warning } = readSnapshot();
  const main = { ...getPromptDefaults().main, ...config.main };
  // 界面显示的值要与生效值一致：文件里的角色节优先于 JSON
  const fromFile = { rules: mainRules({ main } as ConversationConfig), personality: mainPersonality({ main } as ConversationConfig) };
  const effective = { ...main, rules: fromFile.rules, personality: fromFile.personality };
  return { main: effective, mainRevision: hash(effective), modes: resolvedModes(config), ...(warning ? { warning } : {}) };
}
export function getConfiguredTemplates(): AgentTemplate[] { return resolvedTemplates(readSnapshot().config); }
export function saveConfiguredTemplate(id: string, input: Partial<AgentTemplate>, expectedRevision?: string): AgentTemplate {
  mutate(config => {
    const before = resolvedTemplates(config).find(template => template.id === id);
    checkRevision(before?.revision, expectedRevision);
    if (builtinTemplateIds.has(id)) {
      if (Object.keys(input).some(key => key !== "prompt")) throw new Error("内置执行模板仅支持修改提示词");
      templateFields.shape.prompt.parse(input.prompt);
      const saved = config.templates.find(item => item.id === id) ?? { id };
      saved.prompt = input.prompt;
      config.templates = [...config.templates.filter(item => item.id !== id), saved];
    } else {
      const value = templateFields.parse({ ...before, ...input });
      const next = { id, ...value, agentType: value.agentType ?? "custom" };
      const index = config.templates.findIndex(item => item.id === id);
      if (index < 0) config.templates.push(next); else config.templates[index] = next;
    }
  });
  return getConfiguredTemplates().find(template => template.id === id)!;
}
export function removeConfiguredTemplate(id: string, restore: boolean, expectedRevision?: string): AgentTemplate | undefined {
  mutate(config => {
    const before = resolvedTemplates(config).find(template => template.id === id);
    if (!before) throw new Error("模板不存在");
    checkRevision(before.revision, expectedRevision);
    if (restore) {
      if (!builtinTemplateIds.has(id)) throw new Error("该模板不支持恢复");
      const saved = config.templates.find(item => item.id === id);
      if (saved) { delete saved.prompt; if (Object.keys(saved).length === 1) config.templates = config.templates.filter(item => item.id !== id); }
    } else {
      if (builtinTemplateIds.has(id)) throw new Error("系统内置模板不可删除");
      config.templates = config.templates.filter(item => item.id !== id);
    }
  });
  return getConfiguredTemplates().find(template => template.id === id);
}
export function saveMainChat(input: MainChatProfile, expectedRevision?: string): ConversationConfig {
  const value = mainSchema.parse(input);
  mutate(config => {
    checkRevision(hash({ ...getPromptDefaults().main, ...config.main }), expectedRevision);
    const defaults = getPromptDefaults().main;
    config.main = {};
    for (const key of ["nickname", "avatar", "personality", "rules"] as const) if (value[key] !== defaults[key]) config.main[key] = value[key];
  });
  // 角色节的真源是 MEMORY.md；JSON 里那两份只作为回落。恢复默认时移除该节。
  try {
    const file = path.join(emHome(), "memory", "MEMORY.md");
    const defaults = getPromptDefaults().main;
    let current = readText(file) ?? "# MEMORY\n\n";
    current = writeSection(current, "规则", value.rules === defaults.rules ? "" : value.rules);
    current = writeSection(current, "人设", value.personality === defaults.personality ? "" : value.personality);
    atomicWrite(file, current);
  } catch { /* 写文件失败不影响保存结果，读取侧仍可用 JSON 回落 */ }
  return getConversationConfig();
}
export function restoreMainChat(expectedRevision?: string): ConversationConfig {
  mutate(config => { checkRevision(hash({ ...getPromptDefaults().main, ...config.main }), expectedRevision); config.main = {}; });
  // 恢复默认要连文件里的角色节一起清掉，否则读取侧仍会用文件里的旧文本
  try {
    const file = path.join(emHome(), "memory", "MEMORY.md");
    const current = readText(file);
    if (current) atomicWrite(file, writeSection(writeSection(current, "规则", ""), "人设", ""));
  } catch { /* 文件不可写时保持原状，界面仍可用 JSON 值 */ }
  return getConversationConfig();
}
export function saveCollaborationMode(input: Omit<CollaborationMode, "id" | "builtin"> & { id?: string }): ConversationConfig {
  const value = modeFields.parse(input);
  mutate(config => {
    const current = input.id ? resolvedModes(config).find(mode => mode.id === input.id) : undefined;
    if (input.id && !current) throw new Error("模式不存在");
    checkRevision(current?.revision, input.revision);
    const baseline = getPromptDefaults().modes.find(mode => mode.id === input.id);
    const saved: z.infer<typeof modeOverride> = { id: input.id ?? randomUUID() };
    for (const key of ["name", "scenario", "prompt", "defaultEnabled"] as const) if (!baseline || value[key] !== baseline[key]) Object.assign(saved, { [key]: value[key] });
    const index = config.modes.findIndex(mode => mode.id === saved.id);
    if (Object.keys(saved).length === 1) config.modes = config.modes.filter(mode => mode.id !== saved.id);
    else if (index < 0) config.modes.push(saved); else config.modes[index] = saved;
  });
  return getConversationConfig();
}
export function deleteCollaborationMode(id: string, expectedRevision?: string): ConversationConfig {
  mutate(config => {
    const mode = resolvedModes(config).find(item => item.id === id);
    if (!mode) throw new Error("模式不存在");
    if (mode.builtin) throw new Error("内置模式不可删除");
    checkRevision(mode.revision, expectedRevision);
    config.modes = config.modes.filter(item => item.id !== id);
  });
  return getConversationConfig();
}
export function restoreCollaborationMode(id: string, expectedRevision?: string): ConversationConfig {
  mutate(config => {
    const mode = resolvedModes(config).find(item => item.id === id);
    if (!mode?.builtin) throw new Error("该模式没有内置默认内容");
    checkRevision(mode.revision, expectedRevision);
    config.modes = config.modes.filter(item => item.id !== id);
  });
  return getConversationConfig();
}

/** 角色层规则：`MEMORY.md` 的 `## 规则` 优先，缺失时回落系统提示配置里的 rules。 */
function mainRules(config: ConversationConfig): string {
  try {
    const file = path.join(emHome(), "memory", "MEMORY.md");
    const content = readText(file);
    const fromFile = content ? sectionText(content, "规则") : null;
    if (fromFile) return fromFile;
  } catch { /* 读不到就回落，不影响启动 */ }
  return config.main.rules;
}

/** 角色层人设：`MEMORY.md` 的 `## 人设` 优先，缺失时回落系统提示配置里的 personality。 */
function mainPersonality(config: ConversationConfig): string {
  try {
    const file = path.join(emHome(), "memory", "MEMORY.md");
    const content = readText(file);
    const fromFile = content ? sectionText(content, "人设") : null;
    if (fromFile) return fromFile;
  } catch { /* 读不到就回落，不影响启动 */ }
  return config.main.personality;
}

/** 仅返回可变段正文；宿主使用 SDK section 键替换，不解析用户输入中的同名标签。 */
export function conversationPromptSection(modeIds: string[], config = getConversationConfig()): string {
  const enabled = config.modes.filter(mode => modeIds.includes(mode.id));
  return [config.warning ? `配置加载诊断：${config.warning}。不得声称已应用未加载内容。` : "",
    `当前主对话身份以本段为准。你的昵称是 ${JSON.stringify(config.main.nickname)}。`,
    `<personality>\n${mainPersonality(config)}\n</personality>`, `<user_rules>\n${mainRules(config)}\n</user_rules>`,
    `当前启用的协作模式：${enabled.map(mode => mode.name).join("、") || "标准"}。仅按当前模式工作，历史选择以本段为准。`,
    "模式补充当前工作方式，不改变权限或新增工具；兼容要求叠加，真正冲突按当前用户目标处理。",
    ...enabled.map(mode => `<collaboration_mode name=${JSON.stringify(mode.name)}>\n${mode.id === DOMAIN_GUIDANCE_MODE_ID ? "用户已启用领域引导，沿用这个选择，不再次邀请。\n" : ""}${mode.prompt}\n</collaboration_mode>`),
  ].filter(Boolean).join("\n\n");
}
