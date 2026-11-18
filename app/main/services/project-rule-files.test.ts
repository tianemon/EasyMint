import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import {discoverProjectRules,initializeProjectRules,loadProjectRuleFiles,applyInitialProjectProfile,finishInitialProjectProfile,markProjectRuleChanged,projectRuleRevision} from "./project-rule-files";
vi.mock("electron",()=>({app:{isPackaged:false,getPath:()=>os.tmpdir()}}));
const roots:string[]=[];afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"em-project-rule-"));roots.push(root);return root;}
it.each(["CLAUDE.md","CODEBUDDY.md","Agents.md",".codebuddy/CODEBUDDY.md"])("uses existing %s without generating a competing AGENTS",name=>{
 const root=fixture(),file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,"USER_RULE");expect(initializeProjectRules(root,"EM_DEFAULT","project")).toBeUndefined();expect(fs.readdirSync(root).includes("AGENTS.md")).toBe(false);expect(discoverProjectRules(root).files.at(-1)?.content).toBe("USER_RULE");
});
it("keeps empty user rules and unsupported conditional rules as existing choices",()=>{
 const root=fixture();fs.writeFileSync(path.join(root,"AGENTS.md"),"");initializeProjectRules(root,"EM_DEFAULT","p");expect(fs.readFileSync(path.join(root,"AGENTS.md"),"utf8")).toBe("");fs.unlinkSync(path.join(root,"AGENTS.md"));fs.mkdirSync(path.join(root,".cursor","rules"),{recursive:true});expect(initializeProjectRules(root,"EM_DEFAULT","p")).toContain("未自动解析");expect(fs.existsSync(path.join(root,"AGENTS.md"))).toBe(false);
});
it("honors a new override without reviving a previously loaded nested lower-priority file",()=>{
 const root=fixture();fs.mkdirSync(path.join(root,".codebuddy"));fs.writeFileSync(path.join(root,".codebuddy","CODEBUDDY.md"),"OLD_LOWER");const initial=loadProjectRuleFiles(root,[]);fs.writeFileSync(path.join(root,"AGENTS.override.md"),"OVERRIDE");const next=loadProjectRuleFiles(root,initial);expect(next.map(file=>file.content)).toEqual(["OVERRIDE"]);
});
it("updates its untouched generated suffix until first-session handoff, preserving user edits",()=>{
 const parent=fixture(),root=path.join(parent,"child");fs.mkdirSync(root);fs.writeFileSync(path.join(parent,"AGENTS.md"),"PARENT");initializeProjectRules(root,"# {{PROJECT_NAME}}\nBASE","Child",false);applyInitialProjectProfile(root,"CLI_RULE");expect(fs.readFileSync(path.join(root,"AGENTS.md"),"utf8")).toContain("CLI_RULE");applyInitialProjectProfile(root,"SECOND");expect(fs.readFileSync(path.join(root,"AGENTS.md"),"utf8")).toContain("SECOND");expect(fs.readFileSync(path.join(root,"AGENTS.md"),"utf8")).not.toContain("CLI_RULE");finishInitialProjectProfile(root);applyInitialProjectProfile(root,"AFTER_START");expect(fs.readFileSync(path.join(root,"AGENTS.md"),"utf8")).not.toContain("AFTER_START");
 const other=path.join(parent,"other");fs.mkdirSync(other);initializeProjectRules(other,"BASE","Other",false);fs.writeFileSync(path.join(other,"AGENTS.md"),"USER_EDIT");expect(()=>applyInitialProjectProfile(other,"DO_NOT_APPEND")).toThrow("项目规则已被修改");expect(fs.readFileSync(path.join(other,"AGENTS.md"),"utf8")).toBe("USER_EDIT");
});
it("normalizes directory aliases for refresh and never loads a credential through a rule symlink",()=>{
 const root=fixture(),home=path.join(root,"home"),project=path.join(root,"project"),alias=path.join(root,"alias");fs.mkdirSync(project);fs.mkdirSync(path.join(home,".ssh"),{recursive:true});fs.writeFileSync(path.join(home,".ssh","id_rsa"),"PRIVATE_SECRET");vi.spyOn(os,"homedir").mockReturnValue(home);fs.symlinkSync(project,alias);fs.writeFileSync(path.join(project,"AGENTS.md"),"RULE");const before=projectRuleRevision(alias);markProjectRuleChanged(path.join(project,"AGENTS.md"));expect(projectRuleRevision(alias)).toBeGreaterThan(before);expect(loadProjectRuleFiles(alias,[{path:path.join(alias,"AGENTS.md"),content:"RULE"}])).toHaveLength(1);fs.unlinkSync(path.join(project,"AGENTS.md"));fs.symlinkSync(path.join(home,".ssh","id_rsa"),path.join(project,"AGENTS.md"));const loaded=discoverProjectRules(project);expect(loaded.hasExisting).toBe(true);expect(loaded.files.map(file=>file.content).join("")).not.toContain("PRIVATE_SECRET");expect(loaded.warnings.join("")).toContain("EACCES");
});

it("preserves and diagnoses a broken rule link rather than seeding a competing default",()=>{const root=fixture();fs.symlinkSync(path.join(root,"missing-rule.md"),path.join(root,"CLAUDE.md"));const found=discoverProjectRules(root);expect(found.hasExisting).toBe(true);expect(found.warnings.join("\n")).toContain("ENOENT");expect(initializeProjectRules(root,"DEFAULT","p")).toContain("ENOENT");expect(fs.readdirSync(root)).not.toContain("AGENTS.md");});
