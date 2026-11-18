/** 用户提示配置的唯一真源；读接口不写盘，迁移在显式初始化／保存时提交。 */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { MainChatProfile, CollaborationMode, ConversationConfig } from "../../shared/collaboration";
import { UI_DESIGN_MODE_ID, DOMAIN_GUIDANCE_MODE_ID, CONVERSATION_SETTINGS_MESSAGE_TYPE, CONVERSATION_CONFIG_FILE } from "../../shared/collaboration";
import { DESIGNER_TEMPLATE_DIR, designerTemplateTable } from "../../shared/designer-templates";
import type { AgentTemplate } from "./agent-templates";
import type { SessionManager } from "./pi-sdk";
import { emHome, getResourcesDir } from "../utils/paths";
import { sectionText, sectionRange, writeSection } from "../../shared/memory-doc";
import {documentTransaction,readDocument} from "./memory/document-store";
import { atomicWrite, encode, lockConfigDirectory, readText } from "./native-config-storage";

import { assertPromptStoreEntries, builtinTemplateTypes, legacyTemplateSchema, mainSchema, modeFields, modeOverride, retiredIds, storeSchema, templateFields, type PromptStore } from "./prompt-config-schema";

interface Defaults { main: MainChatProfile; templates: AgentTemplate[]; modes: CollaborationMode[]; legacyDesigner: string; legacyHashes: Record<string, string> }
/** Explicit legacy choices survive hash matching until the one-time upgrade is committed. */
interface LegacyIntent { rules?: string; templateIds: string[]; skippedTemplates?: number }
interface Snapshot { config: PromptStore; raw: string | null; legacy?: { prompts: string | null; templates: string | null }; legacyIntent?: LegacyIntent; warning?: string }
const hash = (value: unknown): string => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const configPath = () => path.join(emHome(), CONVERSATION_CONFIG_FILE);
const legacyConfigPath = () => path.join(emHome(), "system-prompts.json");
const templatesPath = () => path.join(emHome(), "agent-templates.json");
let defaultsCache: { file: string; value: Defaults } | undefined;
const lastValid = new Map<string, Snapshot>();
const initializationWarnings = new Map<string, string>();
const mainKeys = ["nickname", "userAddress", "avatar", "personality", "rules"] as const;

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
  const parsed = z.object({ version: z.literal(1), main: mainSchema.extend({ personality: nonempty }),
    templates: z.array(legacyTemplateSchema),
    modes: z.array(modeFields.omit({ prompt: true }).extend({ id: z.string().min(1) })),
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
  assertPromptStoreEntries(parsed.data);
  return parsed.data;
}

function convertLegacy(raw: string | null, templatesRaw: string | null): Pick<Snapshot,"config"|"legacyIntent"> {
  const config = emptyStore();
  const legacyIntent:LegacyIntent={templateIds:[]};
  const legacy = raw === null ? {} : parseJson(raw, legacyConfigPath());
  if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) throw new Error("旧提示词配置必须是对象");
  const data = legacy as { prompts?: Array<Record<string, unknown>>; defaultPromptId?: string;
    conversation?: { useBuiltinRules?: boolean; main?: Partial<MainChatProfile>; modes?: Array<Record<string, unknown>> } };
  if (data.prompts !== undefined && !Array.isArray(data.prompts)) throw new Error("旧提示词列表格式无效");
  const selected = data.prompts?.find(item => item.id === data.defaultPromptId && item.id !== "builtin-default");
  if (!data.conversation?.useBuiltinRules && selected && typeof selected.content === "string") {config.main.rules = selected.content;legacyIntent.rules=selected.content;}
  Object.assign(config.main, data.conversation?.main ?? {});
  if(config.main.rules!==legacyIntent.rules)delete legacyIntent.rules;
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
    const archived = z.array(z.unknown()).parse(parseJson(templatesRaw, templatesPath()));
    const templates = archived.flatMap(row => {
      const decoded = legacyTemplateSchema.safeParse(row);
      return decoded.success ? [decoded.data] : [];
    });
    if (archived.length !== templates.length) legacyIntent.skippedTemplates = archived.length - templates.length;
    unique(templates, "旧执行模板");
    const defaults = getPromptDefaults();
    for (const template of templates) {
      if (retiredIds.has(template.id)) continue;
      const baseline = defaults.templates.find(item => item.id === template.id);
      if (!baseline) config.templates.push({ id: template.id, ...templateFields.parse(template), agentType: template.agentType ?? "custom" });
      else {
        const saved: PromptStore["templates"][number] = { id: template.id };
        if(template.customized)legacyIntent.templateIds.push(template.id);
        for (const key of ["name", "description"] as const) if (template[key] !== baseline[key]) saved[key] = template[key];
        const oldHash = defaults.legacyHashes[template.id === "default-builder" ? "BUILDER_AGENT_PROMPT" : "EVALUATOR_AGENT_PROMPT"];
        if (template.customized || hash(template.prompt) !== oldHash) saved.prompt = template.prompt;
        if (Object.keys(saved).length > 1) config.templates.push(saved);
      }
    }
    config.legacyTemplates = archived;
  }
  return {config:validated(config),legacyIntent};
}

function strictSnapshot(): Snapshot {
  const raw = readText(configPath());
  const cached = lastValid.get(configPath());
  if (raw !== null && cached && !cached.legacy && cached.raw === raw) return structuredClone(cached);
  if (raw !== null) return { config: validated(parseJson(raw, configPath())), raw };
  const prompts = readText(legacyConfigPath());
  const parsed = prompts === null ? undefined : parseJson(prompts, legacyConfigPath());
  // Some development builds wrote v2 under the unversioned filename.
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "version" in parsed) {
    return { config: validated(parsed), raw, legacy: { prompts, templates: readText(templatesPath()) } };
  }
  const templates = readText(templatesPath());
  return { ...convertLegacy(prompts, templates), raw, ...(prompts !== null || templates !== null ? { legacy: { prompts, templates } } : {}) };
}
function readSnapshot(): Snapshot {
  getPromptDefaults(); // 默认资源损坏不能被当作用户配置错误而静默兜底。
  try {
    const snapshot = strictSnapshot();
    lastValid.set(configPath(), structuredClone(snapshot));
    const skipped = snapshot.config.migration?.skippedTemplates ?? snapshot.legacyIntent?.skippedTemplates;
    return { ...snapshot, warning: initializationWarnings.get(configPath()) ??
      (skipped ? `有 ${skipped} 个旧执行模板的字段无效，原记录已保留，可在设置中重新创建。` : undefined) };
  } catch (error) {
    const previous = lastValid.get(configPath());
    const warning = `${error instanceof Error ? error.message : "提示词配置读取失败"}。${previous ? "当前沿用上一份有效配置" : "当前使用应用默认配置"}，未应用本次文件修改。`;
    return { ...(previous ? structuredClone(previous) : { config: emptyStore(), raw: null }), warning };
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
function upgradedTemplateOverrides(config: PromptStore,intent?:LegacyIntent): PromptStore["templates"] {
  if (config.defaultUpgrade === 1) return config.templates;
  const defaults = getPromptDefaults();
  return config.templates.map(template=>{
    if(intent?.templateIds.includes(template.id))return template;
    const previous=template.id==="default-builder"?[defaults.legacyHashes.BUILDER_BEFORE_RULE_SPLIT,defaults.legacyHashes.BUILDER_BEFORE_PROMPT_FOCUS]:template.id==="default-evaluator"?[defaults.legacyHashes.EVALUATOR_BEFORE_PROMPT_FOCUS]:[];
    if(template.prompt!==undefined&&previous.includes(hash(template.prompt))){const {prompt:_prompt,...rest}=template;return rest;}
    return template;
  });
}
function resolvedTemplates(config: PromptStore,intent?:LegacyIntent): AgentTemplate[] {
  const defaults = getPromptDefaults();
  config={...config,templates:upgradedTemplateOverrides(config,intent)};
  return [...defaults.templates.map(template => ({ ...template, ...config.templates.find(item => item.id === template.id), agentType: template.agentType })),
    ...config.templates.filter(template => !builtinTemplateTypes.has(template.id)).map(template => ({ ...templateFields.parse(template), id: template.id, agentType: template.agentType ?? "custom" }))]
    .map(template => ({ ...template, customized: config.templates.some(item => item.id === template.id && item.prompt !== undefined), revision: hash(template) }));
}
function checkRevision(actual: string | undefined, expected?: string): void {
  if (expected !== undefined && actual !== expected) throw new Error("此项提示词已被其他窗口或程序修改，请重新打开后保存（当前编辑未覆盖磁盘）");
}

/** Commit the new format separately. Downgrades still see the original legacy files. */
function commit(snapshot: Snapshot, config: PromptStore): void {
  config = validated(config);
  if (snapshot.legacy && !config.migration) {
    const { prompts, templates } = snapshot.legacy;
    const backup = `prompts-v2-${hash([prompts, templates]).slice(0, 16)}`;
    const dir = path.join(emHome(), "config-backups", backup);
    if (prompts !== null) atomicWrite(path.join(dir, "system-prompts.json"), prompts);
    if (templates !== null) atomicWrite(path.join(dir, "agent-templates.json"), templates);
    const skippedTemplates = snapshot.legacyIntent?.skippedTemplates;
    config.migration = { backup, ...(skippedTemplates ? { skippedTemplates } : {}) };
  }
  if (readText(configPath()) !== snapshot.raw || (snapshot.legacy &&
    (readText(legacyConfigPath()) !== snapshot.legacy.prompts || readText(templatesPath()) !== snapshot.legacy.templates))) {
    throw new Error("提示词配置已更新，请重新加载后保存");
  }
  atomicWrite(configPath(), encode(config));
  lastValid.set(configPath(), { config, raw: encode(config) });
  initializationWarnings.delete(configPath());
}
function mutate(edit: (config: PromptStore) => void): void {
  const release = lockConfigDirectory(emHome());
  try {
    let snapshot = strictSnapshot();
    // Any edit may convert the old format; persist its explicit choices before losing that context.
    initializeSnapshot(snapshot);
    snapshot = strictSnapshot();
    const config = structuredClone(snapshot.config);
    edit(config);
    commit(snapshot, config);
  } finally { release(); }
}
function resolvedMain(config:PromptStore,document?:string|null,intent?:LegacyIntent):MainChatProfile {
  const defaults=getPromptDefaults(),main={...defaults.main,...config.main};
  if(!config.rolesInJson){
    const content=document===undefined?readDocument(path.join(emHome(),"memory","MEMORY.md")):document;
    for(const [key,title] of [["rules","规则"],["personality","人设"]] as const)if(content!==null && sectionRange(content,title))main[key]=sectionText(content,title) ?? "";
  }
  if(config.defaultUpgrade!==1){
    if(main.rules!==intent?.rules&&hash(main.rules)===defaults.legacyHashes.MAIN_RULES_BEFORE_CORE)main.rules="";
    if(hash(main.personality)===defaults.legacyHashes.MAIN_PERSONALITY_BEFORE_FOCUS)main.personality=defaults.main.personality;
  }
  return main;
}
/** 默认正文只升级一次，之后显式保存可以有意复用与历史默认完全相同的文本。 */
function upgradeDefaultOverrides(config:PromptStore,main:MainChatProfile,intent?:LegacyIntent):void {
  const defaults=getPromptDefaults().main;
  config.main={};for(const key of mainKeys)if(main[key]!==defaults[key])config.main[key]=main[key];
  config.templates=upgradedTemplateOverrides(config,intent);
  config.defaultUpgrade=1;
}
function initializeSnapshot(snapshot:Snapshot):void {
  if(snapshot.config.rolesInJson){
    if(snapshot.config.defaultUpgrade!==1){const config=structuredClone(snapshot.config);upgradeDefaultOverrides(config,resolvedMain(config,undefined,snapshot.legacyIntent),snapshot.legacyIntent);commit(snapshot,config);}
    else if(snapshot.legacy)commit(snapshot,snapshot.config);
    return;
  }
  const file=path.join(emHome(),"memory","MEMORY.md");
  documentTransaction(file,(before)=>{
    const main=resolvedMain(snapshot.config,before,snapshot.legacyIntent),config=structuredClone(snapshot.config);
    upgradeDefaultOverrides(config,main,snapshot.legacyIntent);
    config.rolesInJson=true;
    const next=writeSection(writeSection(before ?? "","规则",""),"人设","");
    if(before!==null && before!==next)atomicWrite(path.join(emHome(),"config-backups",`roles-${hash(before).slice(0,16)}`,"MEMORY.md"),before);
    // Commit the complete role values before removing their old location. A failed
    // cleanup cannot make an older MD override the now-authoritative JSON.
    commit(snapshot,config);
    // The memory worker removes old role sections through its recoverable
    // file transaction after this JSON becomes authoritative.
  });
  initializationWarnings.delete(configPath());
}
export function initializePromptConfiguration(): void {
  const release=lockConfigDirectory(emHome());
  try {initializeSnapshot(strictSnapshot());}finally{release();}
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
  const { config, warning, legacyIntent } = readSnapshot();
  let main:MainChatProfile;
  try{main=resolvedMain(config,undefined,legacyIntent);}catch(error){main={...getPromptDefaults().main,...config.main};return {main,mainRevision:hash(main),modes:resolvedModes(config),warning:`角色旧位置未读取：${(error as Error).message}`};}
  return {main,mainRevision:hash(main),modes:resolvedModes(config),...(warning?{warning}:{})};
}
export function getConfiguredTemplates(): AgentTemplate[] { const snapshot=readSnapshot();return resolvedTemplates(snapshot.config,snapshot.legacyIntent); }
export function saveConfiguredTemplate(id: string, input: Partial<AgentTemplate>, expectedRevision?: string): AgentTemplate {
  mutate(config => {
    const before = resolvedTemplates(config).find(template => template.id === id);
    checkRevision(before?.revision, expectedRevision);
    if (builtinTemplateTypes.has(id)) {
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
      if (!builtinTemplateTypes.has(id)) throw new Error("该模板不支持恢复");
      const saved = config.templates.find(item => item.id === id);
      if (saved) { delete saved.prompt; if (Object.keys(saved).length === 1) config.templates = config.templates.filter(item => item.id !== id); }
    } else {
      if (builtinTemplateTypes.has(id)) throw new Error("系统内置模板不可删除");
      config.templates = config.templates.filter(item => item.id !== id);
    }
  });
  return getConfiguredTemplates().find(template => template.id === id);
}
export function saveMainChat(input:MainChatProfile,expectedRevision?:string):ConversationConfig {
  const value=mainSchema.parse(input);
  mutate(config=>{
    checkRevision(hash(resolvedMain(config)),expectedRevision);
    const defaults=getPromptDefaults().main;config.main={};
    for(const key of mainKeys)if(value[key]!==defaults[key])config.main[key]=value[key];
    config.rolesInJson=true;
  });return getConversationConfig();
}
export function restoreMainChat(expectedRevision?: string): ConversationConfig {
  return saveMainChat(getPromptDefaults().main,expectedRevision);
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

export function conversationPromptBlocks(modeIds: string[], config = getConversationConfig()): Record<string, string> {
  const enabled = config.modes.filter(mode => modeIds.includes(mode.id));
  return {
    助手昵称: config.main.nickname,
    用户称呼: config.main.userAddress || "",
    人格: config.main.personality,
    用户规则: config.main.rules,
    协作模式: enabled.length ? enabled.map(mode => `## ${mode.name}\n${mode.id === DOMAIN_GUIDANCE_MODE_ID ? "用户已启用领域引导，沿用这个选择，不再次邀请。\n" : ""}${mode.prompt}`).join("\n\n") : "标准",
    配置诊断: config.warning ?? "",
  };
}

/** Compare only settings updates still present in the SDK's active branch and context window. */
export function conversationSettingsUpdate(blocks: Record<string, string>, entries: ReturnType<SessionManager["buildSessionProjection"]>["entries"]) {
  const previous = new Map<string, string>();
  for (const { sourceEntry, messages } of entries) {
    if (sourceEntry.type !== "custom_message" || sourceEntry.customType !== CONVERSATION_SETTINGS_MESSAGE_TYPE) continue;
    if (!messages.some(message => message.role === "custom" && message.content === sourceEntry.content)) continue;
    const details = sourceEntry.details;
    const revisions = details && typeof details === "object" && "settingsRevisions" in details ? details.settingsRevisions : undefined;
    if (!revisions || typeof revisions !== "object") continue;
    for (const [key, revision] of Object.entries(revisions)) if (typeof revision === "string") previous.set(key, revision);
  }
  const changed = Object.entries(blocks).map(([key, value]) => ({ key, value, revision: hash(value) }))
    .filter(({ key, revision }) => previous.get(key) !== revision);
  if (!changed.length) return;
  return {
    customType: CONVERSATION_SETTINGS_MESSAGE_TYPE,
    display: false,
    content: `EasyMint 主对话设置更新（以下各项替换同名设置）：\n${JSON.stringify(Object.fromEntries(changed.map(({ key, value }) => [key, value])), null, 2)}`,
    details: { settingsRevisions: Object.fromEntries(changed.map(({ key, revision }) => [key, revision])) },
  };
}
