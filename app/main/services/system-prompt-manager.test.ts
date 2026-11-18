import beforeFocus from "./__fixtures__/prompts-before-focus.json";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { isPackaged: false } }));
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "em-prompt-config-")); vi.stubEnv("EASYMINT_HOME", root); vi.resetModules(); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const file = () => path.join(root, "system-prompts-v2.json");
const legacyFile = () => path.join(root, "system-prompts.json");
const oldFile = () => path.join(root, "agent-templates.json");
const write = (data: unknown) => fs.writeFileSync(file(), JSON.stringify(data));
const writeLegacy = (data: unknown) => fs.writeFileSync(legacyFile(), JSON.stringify(data));
const read = () => JSON.parse(fs.readFileSync(file(), "utf8"));

describe("unified prompt configuration", () => {
  it("keeps migrated custom roles through the fresh memory first-launch cleanup",async()=>{
    const manager=await import("./system-prompt-manager"),{MemoryDatabase}=await import("./memory/database");
    const personality=manager.getPromptDefaults().main.personality;
    fs.mkdirSync(path.join(root,"memory"));
    fs.writeFileSync(path.join(root,"memory","MEMORY.md"),`# MEMORY\n\n## 人设\n${personality}\n\n## 规则\nKEEP_CUSTOM_RULE\n\n## 记忆\nOLD_TEST_MEMORY\n`);
    write({version:2,main:{},templates:[],modes:[]});manager.initializePromptConfiguration();
    expect(read().main.rules).toBe("KEEP_CUSTOM_RULE");expect(read().main.personality).toBeUndefined();
    const original=fs.readFileSync(file()),db=new MemoryDatabase(path.join(root,"memory","memory.sqlite"));
    try{
      expect(db.query().total).toBe(0);expect(fs.readFileSync(path.join(root,"memory","MEMORY.md"),"utf8")).not.toContain("OLD_TEST_MEMORY");
      expect(fs.readFileSync(file())).toEqual(original);expect(manager.getConversationConfig().main.rules).toBe("KEEP_CUSTOM_RULE");
      expect(manager.getConversationConfig().main.personality).toBe(personality);
    }finally{db.close();}
  });
  it.each(["templates", "main", "design", "guidance"])("rejects incomplete bundled %s instead of starting with empty roles", async missing => {
    const dir = path.join(root, "resources", "prompts"); fs.mkdirSync(dir, { recursive: true });
    const defaults = JSON.parse(fs.readFileSync(path.resolve("resources/prompts/defaults.json"), "utf8"));
    if (missing === "templates") defaults.templates = [];
    if (missing === "main") delete defaults.main.rules;
    if (missing === "design") defaults.design.guidelines = "";
    fs.writeFileSync(path.join(dir, "defaults.json"), JSON.stringify(defaults));
    fs.writeFileSync(path.join(dir, "domain-guidance.md"), missing === "guidance" ? " " : "GUIDANCE");
    const paths = await import("../utils/paths"); vi.spyOn(paths, "getResourcesDir").mockReturnValue(path.dirname(dir));
    const manager = await import("./system-prompt-manager");
    expect(() => manager.getPromptDefaults()).toThrow(/应用/);
    expect(() => manager.getConversationConfig()).toThrow(/应用/);
    expect(fs.existsSync(file())).toBe(false);
  });
  it("rejects external overrides of builtin execution types", async () => {
    write({ version: 2, main: {}, modes: [], templates: [{ id: "default-builder", agentType: "designer" }] });
    const manager = await import("./system-prompt-manager");
    expect(() => manager.initializePromptConfiguration()).toThrow("执行类型");
    expect(manager.getConfiguredTemplates().find(template => template.id === "default-builder")?.agentType).toBe("builder");
    expect(manager.getConversationConfig().warning).toContain("执行类型");
    expect(read().templates[0].agentType).toBe("designer");
  });
  it("reads defaults without creating files, separates identity from work rules, and keeps required methods", async () => {
    const manager = await import("./system-prompt-manager");
    const config = manager.getConversationConfig();
    expect(config.main.personality).toContain("主对话助手");
    expect(config.main.personality).toContain("简单问题用短段落");
    expect(config.main.rules).not.toContain("项目经理 + 架构师");
    expect(config.main.rules).toBe("");
    const core=(await import("./agent-context-rules")).getAgentDeliveryRules();
    expect(core).toContain("实际版本");expect(core).toContain("上下文");expect(core).not.toContain("<thinking_language>");
    expect(fs.existsSync(file())).toBe(false);
    expect(fs.existsSync(oldFile())).toBe(false);
  });
  it("does not mutate legacy files on read and preserves all custom bodies and metadata during migration", async () => {
    const main = "\n用户完整旧提示 <identity>研究伙伴</identity>\n保留空白\n";
    writeLegacy({ prompts: [{ id: "selected", content: main, name: "A" }, { id: "unused", content: "UNSELECTED_CUSTOM", name: "B" }], defaultPromptId: "selected",
      conversation: { main: { nickname: "Mori", personality: "CUSTOM_PERSONALITY" }, modes: [{ id: "my-mode", name: "写作", scenario: "写报告时", prompt: "\nCUSTOM_MODE\n", defaultEnabled: true }] } });
    const oldTemplates = JSON.stringify([{ id: "default-builder", name: "我的构建者", description: "历史描述", prompt: "\nCUSTOM_BUILDER\n", agentType: "builder", customized: true, model: "retired" },
      { id: "my-template", name: "我的模板", description: "原描述", prompt: "\nCUSTOM_TEMPLATE\n", agentType: "custom" }]);
    fs.writeFileSync(oldFile(), oldTemplates);
    const before = fs.readFileSync(legacyFile(), "utf8");
    const manager = await import("./system-prompt-manager");
    expect(manager.getConversationConfig().main.rules).toBe(main);
    expect(fs.readFileSync(legacyFile(), "utf8")).toBe(before);
    manager.initializePromptConfiguration();
    expect(read().version).toBe(2);
    expect(read().legacyPrompts[1].content).toBe("UNSELECTED_CUSTOM");
    expect(manager.getConversationConfig().main.rules).toBe(main);
    expect(manager.getConversationConfig().modes.find(mode => mode.id === "my-mode")?.prompt).toBe("\nCUSTOM_MODE\n");
    expect(manager.getConfiguredTemplates().find(template => template.id === "default-builder")).toMatchObject({ name: "我的构建者", description: "历史描述", prompt: "\nCUSTOM_BUILDER\n" });
    expect(manager.getConfiguredTemplates().find(template => template.id === "my-template")?.prompt).toBe("\nCUSTOM_TEMPLATE\n");
    expect(fs.readFileSync(oldFile(), "utf8")).toBe(oldTemplates);
    expect(fs.readFileSync(legacyFile(), "utf8")).toBe(before);
    const backup = path.join(root, "config-backups", read().migration.backup);
    expect(fs.readFileSync(path.join(backup, "system-prompts.json"), "utf8")).toBe(before);
    expect(fs.readFileSync(path.join(backup, "agent-templates.json"), "utf8")).toBe(oldTemplates);
    const migrated = fs.readFileSync(file(), "utf8"); manager.initializePromptConfiguration();
    expect(fs.readFileSync(file(), "utf8")).toBe(migrated);
  });
  it("preserves manual template text even without the historical customized marker", async () => {
    fs.writeFileSync(oldFile(), JSON.stringify([{ id: "default-evaluator", name: "Eva", description: "desc", prompt: "MANUAL_OVERRIDE", agentType: "evaluator" }]));
    const { initializePromptConfiguration, getConfiguredTemplates } = await import("./system-prompt-manager");
    initializePromptConfiguration();
    expect(getConfiguredTemplates().find(item => item.id === "default-evaluator")?.prompt).toBe("MANUAL_OVERRIDE");
  });
  it("does not mistake expanded legacy builtin labels for custom wording", async () => {
    const manager = await import("./system-prompt-manager");
    const baseline = manager.getPromptDefaults().modes.find(item => item.id === "ui-design")!;
    writeLegacy({ prompts: [], conversation: { modes: [{ ...baseline, prompt: "USER_UI_BODY", defaultEnabled: true }] } });
    manager.initializePromptConfiguration();
    const mode = manager.getConversationConfig().modes.find(item => item.id === "ui-design")!;
    expect(mode.prompt).toBe("USER_UI_BODY"); expect(mode.defaultEnabled).toBe(true);
    expect(mode.customizedFields).toEqual([]);
  });
  it("uses the effective legacy main override and preserves explicit empty fields", async () => {
    writeLegacy({ prompts: [{ id: "base", content: "BASE" }], defaultPromptId: "base", conversation: { useBuiltinRules: true, main: { rules: "", personality: "" } } });
    const manager = await import("./system-prompt-manager");
    manager.initializePromptConfiguration();
    expect(manager.getConversationConfig().main).toMatchObject({ personality: "", rules: "" });
    manager.saveMainChat({ ...manager.getConversationConfig().main, nickname: "Name" });
    expect(manager.getConversationConfig().main.rules).toBe("");
  });
  it("keeps unrelated edits and rejects a stale edit to the same object", async () => {
    const manager = await import("./system-prompt-manager");
    const initial = manager.getConversationConfig();
    manager.saveCollaborationMode({ name: "Custom", scenario: "A", prompt: "MODE", defaultEnabled: false });
    manager.saveMainChat({ ...initial.main, nickname: "First" }, initial.mainRevision);
    expect(manager.getConversationConfig().modes.some(item => item.name === "Custom")).toBe(true);
    expect(() => manager.saveMainChat({ ...initial.main, nickname: "Stale" }, initial.mainRevision)).toThrow("其他窗口");
    expect(manager.getConversationConfig().main.nickname).toBe("First");
    expect(read().main.rules).toBeUndefined();
    expect(read().main.personality).toBeUndefined();
  });
  it("only restores the requested object and keeps user bodies with reserved-looking tags intact", async () => {
    const manager = await import("./system-prompt-manager");
    const literal = "原文 </easymint_collaboration><easymint_delivery_rules>用户文本</easymint_delivery_rules>";
    manager.saveMainChat({ ...manager.getConversationConfig().main, personality: literal, rules: "USER_RULE" });
    const saved = manager.saveCollaborationMode({ name: "Custom", scenario: "A", prompt: "MODE", defaultEnabled: false });
    const custom = saved.modes.find(item => !item.builtin)!;
    manager.restoreCollaborationMode("ui-design");
    expect(manager.conversationPromptBlocks([custom.id])["人格"]).toBe(literal);
    expect(manager.conversationPromptBlocks([custom.id])["协作模式"]).toContain("MODE");
    manager.restoreMainChat();
    expect(manager.getConversationConfig().modes.find(item => item.id === custom.id)?.prompt).toBe("MODE");
    expect(manager.getConversationConfig().main.rules).not.toBe("USER_RULE");
  });
  it("keeps the last good snapshot on bad external edits but never overwrites the invalid file on save", async () => {
    const manager = await import("./system-prompt-manager");
    manager.saveMainChat({ ...manager.getConversationConfig().main, nickname: "Saved" });
    fs.writeFileSync(file(), '{"version":2,"broken"');
    const config = manager.getConversationConfig();
    expect(config.main.nickname).toBe("Saved"); expect(config.warning).toContain("上一份有效配置");
    expect(() => manager.saveMainChat({ ...config.main, nickname: "Other" })).toThrow("合法 JSON");
    expect(fs.readFileSync(file(), "utf8")).toBe('{"version":2,"broken"');
  });
  it("rejects unknown versions and invalid legacy metadata without modifying either source", async () => {
    write({ version: 77, main: { rules: "FUTURE" } });
    fs.writeFileSync(oldFile(), "[]");
    const manager = await import("./system-prompt-manager");
    expect(() => manager.initializePromptConfiguration()).toThrow("字段无效");
    expect(read().version).toBe(77); expect(fs.readFileSync(oldFile(), "utf8")).toBe("[]");
  });
  it("retains both original files if committing the new authority fails, then retries safely", async () => {
    writeLegacy({ prompts: [{ id: "x", content: "ORIGINAL" }], defaultPromptId: "x" }); fs.writeFileSync(oldFile(), "[]");
    const before = fs.readFileSync(legacyFile(), "utf8");
    const manager = await import("./system-prompt-manager");
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { if (String(to) === file()) throw new Error("DISK_ERROR"); return rename(from, to); });
    expect(() => manager.initializePromptConfiguration()).toThrow("DISK_ERROR");
    expect(fs.readFileSync(legacyFile(), "utf8")).toBe(before); expect(fs.readFileSync(oldFile(), "utf8")).toBe("[]");
    vi.restoreAllMocks(); manager.initializePromptConfiguration();
    expect(manager.getConversationConfig().main.rules).toBe("ORIGINAL");
  });
  it("migrates valid settings even when one old template contains no prompt", async () => {
    writeLegacy({ prompts: [{ id: "custom", content: "MY_MAIN" }], defaultPromptId: "custom" });
    const original = JSON.stringify([
      { id: "empty", name: "Incomplete", description: "", prompt: " " },
      { id: "valid", name: "Valid", description: "", prompt: "MY_TEMPLATE" },
    ]);
    fs.writeFileSync(oldFile(), original);
    const manager = await import("./system-prompt-manager");
    manager.initializePromptConfiguration();
    const config = manager.getConversationConfig();
    expect(config.main.rules).toBe("MY_MAIN");
    expect(config.warning).toContain("1 个旧执行模板");
    expect(manager.getConfiguredTemplates().find(template => template.id === "valid")?.prompt).toBe("MY_TEMPLATE");
    expect(manager.getConfiguredTemplates().some(template => template.id === "empty")).toBe(false);
    expect(() => manager.saveMainChat({ ...config.main, nickname: "Compatible" })).not.toThrow();
    expect(fs.readFileSync(oldFile(), "utf8")).toBe(original);
    expect(JSON.parse(fs.readFileSync(legacyFile(), "utf8")).prompts[0].content).toBe("MY_MAIN");
  });

});

it("migrates legacy MD roles to JSON and never lets later MD edits override them",async()=>{
 const manager=await import("./system-prompt-manager");const dir=path.join(root,"memory");fs.mkdirSync(dir);const md=path.join(dir,"MEMORY.md"),original="# MEMORY\n\n## 规则\n\n用户原规则\n\n## 人设\n\n用户原人格\n";fs.writeFileSync(md,original);
 const prior=manager.getConversationConfig();expect(prior.main.rules).toBe("用户原规则");manager.initializePromptConfiguration();const config=manager.getConversationConfig();expect(config.main).toMatchObject({rules:"用户原规则",personality:"用户原人格"});expect(read().rolesInJson).toBe(true);expect(read().main.rules).toBe("用户原规则");
 const {MemoryDatabase}=await import("./memory/database");const db=new MemoryDatabase(path.join(dir,"memory.sqlite"));db.close();expect(fs.readFileSync(md,"utf8")).not.toContain("## 规则");expect(fs.readFileSync(md,"utf8")).not.toContain("## 人设");
 fs.writeFileSync(md,"# MEMORY\n\n## 人设\n错误覆盖\n");expect(manager.getConversationConfig().main.personality).toBe("用户原人格");expect(manager.conversationPromptBlocks([])["人格"]).not.toContain("错误覆盖");
 const backup=fs.readdirSync(path.join(root,"config-backups")).find(name=>name.startsWith("roles-"))!;expect(fs.readFileSync(path.join(root,"config-backups",backup,"MEMORY.md"),"utf8")).toBe(original);
});
it("stores role prose only in JSON and restores only its own overrides",async()=>{
 const manager=await import("./system-prompt-manager"),defaults=manager.getPromptDefaults().main;
 manager.saveMainChat({...defaults,nickname:"小八",rules:"只给结论",personality:"简洁"});expect(read().main).toMatchObject({nickname:"小八",rules:"只给结论",personality:"简洁"});expect(fs.existsSync(path.join(root,"memory","MEMORY.md"))).toBe(false);
 manager.saveMainChat({...defaults,nickname:"小八"});expect(read().main.nickname).toBe("小八");expect(read().main.rules).toBeUndefined();expect(read().main.personality).toBeUndefined();
});

it("roundtrips arbitrary Markdown role text and keeps its revision usable for the next save",async()=>{
 const manager=await import("./system-prompt-manager"),initial=manager.getConversationConfig();
 const personality="## 身份\n我叫Mint\n\n\n\n```md\n## 规则\n```\n\n## 性格\n简洁",rules="## 准备\n先调查\n\n## 执行\n再推进";
 const saved=manager.saveMainChat({...initial.main,personality,rules},initial.mainRevision);
 expect(saved.main.personality).toBe(personality);expect(saved.main.rules).toBe(rules);
 expect(manager.conversationPromptBlocks([])["人格"]).toContain(personality);expect(manager.conversationPromptBlocks([])["人格"]).not.toContain("easymint-role");
 expect(()=>manager.saveMainChat({...saved.main,nickname:"新昵称"},saved.mainRevision)).not.toThrow();
});
it("allows role edits independently of a failed or unreadable memory file",async()=>{
 const manager=await import("./system-prompt-manager"),initial=manager.getConversationConfig();const saved=manager.saveMainChat({...initial.main,nickname:"已有昵称",personality:"已有性格",rules:"已有规则"});
 const md=path.join(root,"memory","MEMORY.md");fs.mkdirSync(md);const next=manager.saveMainChat({...saved.main,nickname:"新昵称",rules:"新补充"},saved.mainRevision);expect(next.main.nickname).toBe("新昵称");expect(read().main.rules).toBe("新补充");expect(fs.statSync(md).isDirectory()).toBe(true);
});
it("preserves legacy role bytes when committing their authoritative JSON fails",async()=>{
 const manager=await import("./system-prompt-manager"),md=path.join(root,"memory","MEMORY.md");fs.mkdirSync(path.dirname(md));const original="# MEMORY\n\n## 规则\n原用户规则\n";fs.writeFileSync(md,original);const rename=fs.renameSync;vi.spyOn(fs,"renameSync").mockImplementation((from,to)=>{if(String(to)===file())throw new Error("synthetic config error");return rename(from,to);});
 expect(()=>manager.initializePromptConfiguration()).toThrow("synthetic config error");expect(fs.readFileSync(md,"utf8")).toBe(original);expect(fs.existsSync(file())).toBe(false);
});

it("upgrades only the exact known Builder default while preserving user custom instructions",async()=>{
 const manager=await import("./system-prompt-manager"),defaults=manager.getPromptDefaults(),current=defaults.templates.find(template=>template.id==="default-builder")!.prompt;
 const old=beforeFocus.templates.find(template=>template.id==="default-builder")!.prompt.replace("引入新依赖时遵循项目实际依赖清单和既定流程，交接说明新增依赖，不假定技术栈","引入新依赖时必须在 package.json 中声明，并告知用户安装了哪个包").replace("同类失败反复出现时重新核查前提，向主会话交接真实原因、证据和待决事项；不因固定失败次数创建额外文件。负责实现与适用自验，不以等待验收代替自身验证","3 次失败写入 escalation.json，附具体失败原因。负责实现与适用自验；需要独立验收时由 Mint 安排，不以等待验收代替自身验证");
 expect((await import("node:crypto")).createHash("sha256").update(old).digest("hex")).toBe(defaults.legacyHashes.BUILDER_BEFORE_RULE_SPLIT);
 write({version:2,main:{},modes:[],templates:[{id:"default-builder",prompt:old}]});expect(manager.getConfiguredTemplates().find(template=>template.id==="default-builder")?.prompt).toBe(current);
 const custom=old+"\nUSER_ADDITIONAL_INSTRUCTIONS";write({version:2,main:{},modes:[],templates:[{id:"default-builder",prompt:custom}]});expect(manager.getConfiguredTemplates().find(template=>template.id==="default-builder")?.prompt).toBe(custom);
});

it.each(["default-builder","default-evaluator"])("refreshes only the exact prior builtin %s and preserves user edits",async(id)=>{
 const manager=await import("./system-prompt-manager"),previous=beforeFocus.templates.find(template=>template.id===id)!,current=manager.getPromptDefaults().templates.find(template=>template.id===id)!;
 write({version:2,rolesInJson:true,main:{},modes:[],templates:[{id,prompt:previous.prompt,name:"USER_NAME",description:"USER_DESCRIPTION"}]});
 expect(manager.getConfiguredTemplates().find(template=>template.id===id)).toMatchObject({prompt:current.prompt,name:"USER_NAME",description:"USER_DESCRIPTION",customized:false});
 const custom=previous.prompt+"\nUSER_CUSTOM_CONSTRAINT";write({version:2,rolesInJson:true,main:{},modes:[],templates:[{id,prompt:custom}]});expect(manager.getConfiguredTemplates().find(template=>template.id===id)).toMatchObject({prompt:custom,customized:true});expect(read().templates[0].prompt).toBe(custom);
});
it("refreshes only the exact prior default personality in JSON or legacy MD and keeps explicit empty/custom text",async()=>{
 const manager=await import("./system-prompt-manager"),current=manager.getPromptDefaults().main.personality;
 for(const personality of [beforeFocus.personality,beforeFocus.personality+"\nMY_PERSONALITY",""]){
  write({version:2,rolesInJson:true,main:{personality,rules:"USER_RULES"},modes:[],templates:[]});expect(manager.getConversationConfig().main).toMatchObject({personality:personality===beforeFocus.personality?current:personality,rules:"USER_RULES"});expect(read().main.personality).toBe(personality);
 }
 write({version:2,main:{},modes:[],templates:[]});const md=PathFixture();fs.mkdirSync(path.dirname(md),{recursive:true});fs.writeFileSync(md,`# MEMORY\n\n## 人设\n${beforeFocus.personality}\n\n## 规则\nUSER_RULES\n`);manager.initializePromptConfiguration();expect(manager.getConversationConfig().main).toMatchObject({personality:current,rules:"USER_RULES"});
 function PathFixture(){return path.join(root,"memory","MEMORY.md");}
});

it.each([false,true])("roundtrips explicitly saved historical main prose before/after startup upgrade: %s",async(initialized)=>{
 const manager=await import("./system-prompt-manager");
 expect((await import("node:crypto")).createHash("sha256").update(beforeFocus.rules).digest("hex")).toBe(manager.getPromptDefaults().legacyHashes.MAIN_RULES_BEFORE_CORE);
 if(initialized)manager.initializePromptConfiguration();
 const initial=manager.getConversationConfig(),input={...initial.main,personality:beforeFocus.personality,rules:beforeFocus.rules};
 const saved=manager.saveMainChat(input,initial.mainRevision);
 expect(saved.main).toEqual(input);expect(read()).toMatchObject({defaultUpgrade:1,rolesInJson:true,main:{personality:input.personality,rules:input.rules}});
 expect(manager.getConversationConfig().main).toEqual(input);expect(manager.conversationPromptBlocks([])["人格"]).toContain(input.personality);expect(manager.conversationPromptBlocks([])["用户规则"]).toContain(input.rules);
 const next=manager.saveMainChat({...saved.main,nickname:"再次保存"},saved.mainRevision);expect(next.main).toMatchObject({personality:input.personality,rules:input.rules,nickname:"再次保存"});
 const committed=fs.readFileSync(file(),"utf8");manager.initializePromptConfiguration();expect(fs.readFileSync(file(),"utf8")).toBe(committed);
 vi.resetModules();const reopened=await import("./system-prompt-manager");expect(reopened.getConversationConfig().main).toEqual(next.main);
});

it.each([false,true].flatMap(initialized=>["default-builder","default-evaluator"].map(id=>({initialized,id}))))("roundtrips an explicit historical $id after migrating other defaults, initialized=$initialized",async({initialized,id})=>{
 const manager=await import("./system-prompt-manager"),previous=beforeFocus.templates.find(template=>template.id===id)!;
 write({version:2,rolesInJson:true,main:{personality:beforeFocus.personality,rules:beforeFocus.rules},modes:[],templates:beforeFocus.templates});
 const raw=fs.readFileSync(file(),"utf8"),initial=manager.getConfiguredTemplates().find(template=>template.id===id)!;
 expect(initial.prompt).not.toBe(previous.prompt);expect(fs.readFileSync(file(),"utf8")).toBe(raw);
 if(initialized)manager.initializePromptConfiguration();
 const saved=manager.saveConfiguredTemplate(id,{prompt:previous.prompt},initial.revision);
 expect(saved).toMatchObject({prompt:previous.prompt,customized:true});expect(read()).toMatchObject({defaultUpgrade:1,rolesInJson:true});
 expect(read().templates.find((template:{id:string})=>template.id===id).prompt).toBe(previous.prompt);
 expect(manager.getConversationConfig().main).toEqual(manager.getPromptDefaults().main);
 const other=manager.getConfiguredTemplates().find(template=>template.id!==id)!;expect(other.prompt).toBe(manager.getPromptDefaults().templates.find(template=>template.id===other.id)!.prompt);expect(other.customized).toBe(false);
 const next=manager.saveConfiguredTemplate(id,{prompt:previous.prompt},saved.revision);expect(next).toEqual(saved);
 const committed=fs.readFileSync(file(),"utf8");manager.initializePromptConfiguration();expect(fs.readFileSync(file(),"utf8")).toBe(committed);
 vi.resetModules();const reopened=await import("./system-prompt-manager");expect(reopened.getConfiguredTemplates().find(template=>template.id===id)).toEqual(saved);
});

it("commits the default upgrade once with legacy JSON/template and MD-role backups intact",async()=>{
 const manager=await import("./system-prompt-manager");
 writeLegacy({prompts:[{id:"builtin-default",content:beforeFocus.rules}],defaultPromptId:"builtin-default"});fs.writeFileSync(oldFile(),JSON.stringify(beforeFocus.templates));
 const md=path.join(root,"memory","MEMORY.md"),original=`# MEMORY\n\n## 人设\n${beforeFocus.personality}\n\n## 规则\n${beforeFocus.rules}\n`;
 fs.mkdirSync(path.dirname(md));fs.writeFileSync(md,original);
 const raw=fs.readFileSync(legacyFile(),"utf8"),templatesRaw=fs.readFileSync(oldFile(),"utf8");
 expect(manager.getConversationConfig().main).toEqual(manager.getPromptDefaults().main);expect(fs.readFileSync(legacyFile(),"utf8")).toBe(raw);expect(fs.readFileSync(md,"utf8")).toBe(original);
 manager.initializePromptConfiguration();expect(read()).toMatchObject({defaultUpgrade:1,rolesInJson:true});expect(manager.getConversationConfig().main).toEqual(manager.getPromptDefaults().main);
 expect(manager.getConfiguredTemplates().map(template=>template.prompt)).toEqual(manager.getPromptDefaults().templates.map(template=>template.prompt));
 const backup=path.join(root,"config-backups",read().migration.backup);expect(fs.readFileSync(path.join(backup,"system-prompts.json"),"utf8")).toBe(raw);expect(fs.readFileSync(path.join(backup,"agent-templates.json"),"utf8")).toBe(templatesRaw);expect(fs.readFileSync(oldFile(),"utf8")).toBe(templatesRaw);
 const roleBackup=fs.readdirSync(path.join(root,"config-backups")).find(name=>name.startsWith("roles-"))!;expect(fs.readFileSync(path.join(root,"config-backups",roleBackup,"MEMORY.md"),"utf8")).toBe(original);
 const committed=fs.readFileSync(file(),"utf8");manager.initializePromptConfiguration();expect(fs.readFileSync(file(),"utf8")).toBe(committed);
});

it("preserves custom prefixes and explicit empty main fields through the one-time upgrade",async()=>{
 const manager=await import("./system-prompt-manager"),custom=beforeFocus.templates.map(template=>({...template,prompt:"USER_PREFIX\n"+template.prompt}));
 write({version:2,rolesInJson:true,main:{personality:"",rules:"USER_PREFIX\n"+beforeFocus.rules},templates:custom,modes:[]});
 manager.initializePromptConfiguration();expect(read().defaultUpgrade).toBe(1);expect(manager.getConversationConfig().main).toMatchObject({personality:"",rules:"USER_PREFIX\n"+beforeFocus.rules});
 expect(manager.getConfiguredTemplates().map(template=>template.prompt)).toEqual(custom.map(template=>template.prompt));
 const config=manager.getConversationConfig(),saved=manager.saveMainChat({...config.main,rules:""},config.mainRevision);expect(saved.main).toMatchObject({personality:"",rules:""});
});

it("preserves an explicitly selected legacy custom prompt even when its body equals the old builtin rules",async()=>{
 const manager=await import("./system-prompt-manager");
 writeLegacy({prompts:[{id:"my-saved-rules",name:"My rules",content:beforeFocus.rules}],defaultPromptId:"my-saved-rules",conversation:{useBuiltinRules:false}});
 const raw=fs.readFileSync(legacyFile(),"utf8");expect(manager.getConversationConfig().main.rules).toBe(beforeFocus.rules);expect(fs.readFileSync(legacyFile(),"utf8")).toBe(raw);
 manager.saveCollaborationMode({name:"Unrelated mode",scenario:"",prompt:"MODE",defaultEnabled:false});
 manager.initializePromptConfiguration();expect(read()).toMatchObject({defaultUpgrade:1,main:{rules:beforeFocus.rules}});expect(manager.getConversationConfig().main.rules).toBe(beforeFocus.rules);
 const config=manager.getConversationConfig(),saved=manager.saveMainChat({...config.main,nickname:"仍保留选择"},config.mainRevision);expect(saved.main.rules).toBe(beforeFocus.rules);
 vi.resetModules();expect((await import("./system-prompt-manager")).getConversationConfig().main.rules).toBe(beforeFocus.rules);
});

it("preserves explicitly customized legacy templates whose text equals a known old default",async()=>{
 const manager=await import("./system-prompt-manager");
 fs.writeFileSync(oldFile(),JSON.stringify(beforeFocus.templates.map(template=>({...template,customized:true}))));
 const raw=fs.readFileSync(oldFile(),"utf8");
 for(const previous of beforeFocus.templates)expect(manager.getConfiguredTemplates().find(template=>template.id===previous.id)).toMatchObject({prompt:previous.prompt,customized:true});
 expect(fs.readFileSync(oldFile(),"utf8")).toBe(raw);expect(fs.existsSync(file())).toBe(false);
 manager.initializePromptConfiguration();expect(read().defaultUpgrade).toBe(1);
 for(const previous of beforeFocus.templates)expect(manager.getConfiguredTemplates().find(template=>template.id===previous.id)).toMatchObject({prompt:previous.prompt,customized:true});
 const backup=path.join(root,"config-backups",read().migration.backup,"agent-templates.json");expect(fs.readFileSync(backup,"utf8")).toBe(raw);
 vi.resetModules();const reopened=await import("./system-prompt-manager");for(const previous of beforeFocus.templates)expect(reopened.getConfiguredTemplates().find(template=>template.id===previous.id)?.prompt).toBe(previous.prompt);
});
