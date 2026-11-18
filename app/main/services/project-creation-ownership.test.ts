import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {afterEach,expect,it,vi} from "vitest";
import type {Store} from "./store";
import {ProjectService,creationSessionReady,releaseCreationOwnership} from "./project-service";
import {finishInitialProjectProfile,initialProjectProfileContent} from "./project-rule-files";
import {readProjectDesign,saveCreationProjectAssets} from "./project-design";
vi.mock("electron",()=>({app:{isPackaged:false,getPath:()=>os.tmpdir()},shell:{trashItem:vi.fn()}}));
const roots:string[]=[];afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"em-creation-owned-"));roots.push(root);const template=path.join(root,"template"),registry=path.join(root,"projects.json");fs.mkdirSync(template);fs.writeFileSync(path.join(template,"AGENTS.md"),"# {{PROJECT_NAME}}\n\n用户基础范围。\n");fs.writeFileSync(registry,"[]");
 const store={getDataDir:()=>root,getSettings:()=>({memory:{enabled:false}}),getProjects:()=>JSON.parse(fs.readFileSync(registry,"utf8")),saveProjects:(projects:unknown)=>fs.writeFileSync(registry,JSON.stringify(projects))} as unknown as Store;
 const service=new ProjectService(store,template),project=service.create({name:"Owned",path:root,directoryName:"project"});
 const profile=path.join(project.path,".easymint","project-profile.json"),rules=path.join(project.path,"AGENTS.md");
 const save=(text:string)=>service.saveCreationProfile(project.path,text,()=>{fs.mkdirSync(path.dirname(profile),{recursive:true});fs.writeFileSync(profile,JSON.stringify({platformSpec:text}));});
 return {root,store,service,project,profile,rules,save};
}
it("switches a failed web creation to CLI without applying or deleting its old design",()=>{
 const f=fixture(),visual=path.join(f.project.path,".easymint","design","visual-spec.json");
 f.service.saveCreationProfile(f.project.path,"WEB_PROFILE",()=>saveCreationProjectAssets(f.project.path,"WEB_PROFILE",{styleId:"glass",targets:["web"]},path.resolve("resources")));
 const original=fs.readFileSync(visual,"utf8");
 const cli=f.service.saveCreationProfile(f.project.path,"CLI_PROFILE",()=>saveCreationProjectAssets(f.project.path,"CLI_PROFILE"));
 f.service.finishCreation(f.project.path,f.project.id,cli.creationRevision);
 expect(readProjectDesign(f.project.path)).toBeNull();expect(fs.readFileSync(visual,"utf8")).toBe(original);
});
it("rolls back profile and visual assets if publishing the generated rules fails",()=>{
 const f=fixture();
 const save=(styleId:string,spec:string)=>f.service.saveCreationProfile(f.project.path,spec,()=>saveCreationProjectAssets(f.project.path,spec,{styleId,targets:["web"]},path.resolve("resources")));
 save("flat","FIRST_PROFILE");
 const oldProfile=fs.readFileSync(f.profile,"utf8"),oldRules=fs.readFileSync(f.rules,"utf8"),rename=fs.renameSync;
 vi.spyOn(fs,"renameSync").mockImplementation((from,to)=>{if(String(to)===f.rules)throw new Error("synthetic rule rename failure");return rename(from,to);});
 expect(()=>save("glass","SECOND_PROFILE")).toThrow("synthetic rule rename failure");
 releaseCreationOwnership(f.store,f.project.path);
 expect(readProjectDesign(f.project.path)?.selection.styleId).toBe("flat");
 expect(fs.readFileSync(f.profile,"utf8")).toBe(oldProfile);expect(fs.readFileSync(f.rules,"utf8")).toBe(oldRules);
});
it("takes over a readable project without a project-side write lock",()=>{
 const f=fixture();f.save("CLI_PROFILE");
 const rules=fs.readFileSync(f.rules,"utf8"),mkdir=fs.mkdirSync;
 vi.spyOn(fs,"mkdirSync").mockImplementation((dir,options)=>{
   if (String(dir).startsWith(f.project.path+path.sep)) throw new Error("fixture project is read-only");
   return mkdir(dir,options);
 });
 releaseCreationOwnership(f.store,f.project.path);
 expect(f.store.getProjects()[0]?.creationRules).toBeUndefined();
 expect(fs.readFileSync(f.rules,"utf8")).toBe(rules);
});
it("blocks an interrupted creation from opening as a mixed ordinary project, then allows retry", () => {
  const f = fixture();
  f.save("FIRST_PROFILE");
  expect(f.service.checkTargetDir(f.root, "project", "Owned")).toEqual({ conflict: true });
  const projects = f.store.getProjects(), owned = projects[0]!.creationRules!;
  const rules = fs.readFileSync(f.rules);
  const planned = initialProjectProfileContent(rules, owned.baseBytes, "SECOND_PROFILE");
  projects[0]!.creationRules = { hash: owned.hash, baseBytes: owned.baseBytes, preparedHash: createHash("sha256").update(planned).digest("hex") };
  f.store.saveProjects(projects);
  saveCreationProjectAssets(f.project.path, "SECOND_PROFILE", { styleId: "flat", targets: ["web"] }, path.resolve("resources"));

  expect(() => releaseCreationOwnership(f.store, f.project.path)).toThrow("配置保存未完成");
  expect(f.service.checkTargetDir(f.root, "new-translation", "Owned")).toEqual({
    conflict: true, resumeProject: { id: f.project.id, path: f.project.path, directoryName: "project" },
  });
  expect(f.service.checkTargetDir(f.root, "project", "Other")).toEqual({ conflict: true });
  const duplicate = f.service.create({ name: "Owned", path: f.root, directoryName: "duplicate" });
  expect(f.service.checkTargetDir(f.root, "duplicate", "Owned")).toEqual({ conflict: true });
  const ambiguous = f.store.getProjects();
  ambiguous.find(project => project.id === duplicate.id)!.creationRules!.preparedHash = "b".repeat(64);
  f.store.saveProjects(ambiguous);
  expect(f.service.checkTargetDir(f.root, "project", "Owned")).toEqual({ conflict: true });
  expect(fs.readFileSync(f.rules)).toEqual(rules);
  expect(f.store.getProjects()[0]?.creationRules?.preparedHash).toBeDefined();
  f.service.saveCreationProfile(f.project.path, "SECOND_PROFILE", () =>
    saveCreationProjectAssets(f.project.path, "SECOND_PROFILE", { styleId: "flat", targets: ["web"] }, path.resolve("resources")));
  releaseCreationOwnership(f.store, f.project.path);
  expect(f.store.getProjects()[0]?.creationRules).toBeUndefined();
  expect(fs.readFileSync(f.rules, "utf8")).toContain("SECOND_PROFILE");
});
it("keeps an existing visual spec usable when the old project profile cannot be parsed", () => {
  const f = fixture();
  saveCreationProjectAssets(f.project.path, "WEB_PROFILE", { styleId: "flat", targets: ["web"] }, path.resolve("resources"));
  fs.writeFileSync(f.profile, "{");
  expect(readProjectDesign(f.project.path)?.selection.styleId).toBe("flat");
});
it("retries a changed form profile without keeping the first generated specification",()=>{
 const f=fixture();f.save("CLI_PROFILE");const next=f.save("WEB_PROFILE");expect(fs.readFileSync(f.rules,"utf8")).toContain("WEB_PROFILE");expect(fs.readFileSync(f.rules,"utf8")).not.toContain("CLI_PROFILE");expect(JSON.parse(fs.readFileSync(f.profile,"utf8")).platformSpec).toBe("WEB_PROFILE");expect(f.store.getProjects()[0]?.creationRules?.hash).toBe(next.creationRulesHash);
});
it("recovers ownership from the registry after runtime seed state is gone",()=>{
 const f=fixture();f.save("CLI_PROFILE");finishInitialProjectProfile(f.project.path);const recovered=new ProjectService(f.store);const result=recovered.saveCreationProfile(f.project.path,"WEB_PROFILE",()=>fs.writeFileSync(f.profile,JSON.stringify({platformSpec:"WEB_PROFILE"})));expect(result.creationRulesHash).toBe(f.store.getProjects()[0]?.creationRules?.hash);expect(fs.readFileSync(f.rules,"utf8")).toContain("WEB_PROFILE");
});
it.each(["edit","replace","link","override"])("preserves %s of generated rules and refuses to claim a new profile was applied",mode=>{
 const f=fixture();f.save("CLI_PROFILE");const original=fs.readFileSync(f.rules,"utf8");
 if(mode==="edit")fs.appendFileSync(f.rules,"\nUSER_EDIT");
 if(mode==="replace"){fs.renameSync(f.rules,`${f.rules}.old`);fs.writeFileSync(f.rules,`${original}\nUSER_REPLACEMENT`);}
 if(mode==="link"){fs.renameSync(f.rules,`${f.rules}.old`);fs.symlinkSync(`${f.rules}.old`,f.rules);}
 if(mode==="override")fs.writeFileSync(path.join(f.project.path,"AGENTS.override.md"),"USER_OVERRIDE");
 const before=fs.readFileSync(f.rules,"utf8"),write=vi.fn();expect(()=>f.service.saveCreationProfile(f.project.path,"WEB_PROFILE",write)).toThrow("项目规则已被修改");expect(write).not.toHaveBeenCalled();expect(fs.readFileSync(f.rules,"utf8")).toBe(before);expect(JSON.parse(fs.readFileSync(f.profile,"utf8")).platformSpec).toBe("CLI_PROFILE");
});
it("does not infer ownership from setup status or an existing profile JSON",()=>{
 const f=fixture(),projects=f.store.getProjects();delete projects[0]!.creationRules;f.store.saveProjects(projects);const write=vi.fn();expect(()=>f.service.saveCreationProfile(f.project.path,"WEB_PROFILE",write)).toThrow("所有权不可验证");expect(write).not.toHaveBeenCalled();
});
it("seals only the exact latest profile at the host's pre-prompt handoff",()=>{
 const f=fixture(),first=f.save("CLI_PROFILE"),second=f.save("WEB_PROFILE");const callback=creationSessionReady(f.service,f.project.path,null,{details:{kind:"project-created",creationProjectId:f.project.id,creationRevision:second.creationRevision}})!;
 expect(f.store.getProjects()[0]?.creationRules).toBeDefined();expect(()=>f.service.finishCreation(f.project.path,f.project.id,first.creationRevision)).toThrow("配置已变化");callback();expect(f.store.getProjects()[0]?.creationRules).toBeUndefined();expect(()=>f.save("AFTER_START")).toThrow("首次会话已启动");expect(fs.readFileSync(f.rules,"utf8")).toContain("WEB_PROFILE");
});
it("does not consume ownership when profile asset saving fails",()=>{
 const f=fixture(),before=fs.readFileSync(f.rules,"utf8"),hash=f.store.getProjects()[0]?.creationRules?.hash;expect(()=>f.service.saveCreationProfile(f.project.path,"CLI_PROFILE",()=>{throw new Error("synthetic profile write failure");})).toThrow("synthetic");expect(fs.readFileSync(f.rules,"utf8")).toBe(before);expect(f.store.getProjects()[0]?.creationRules?.hash).toBe(hash);expect(()=>f.save("WEB_PROFILE")).not.toThrow();
});
it("leaves complete rules on atomic rule-write failure and never returns a new revision",()=>{
 const f=fixture();f.save("CLI_PROFILE");const before=fs.readFileSync(f.rules,"utf8"),hash=f.store.getProjects()[0]?.creationRules?.hash,rename=fs.renameSync;vi.spyOn(fs,"renameSync").mockImplementation((from,to)=>{if(String(to)===f.rules)throw new Error("synthetic rule rename failure");return rename(from,to);});expect(()=>f.save("WEB_PROFILE")).toThrow("synthetic");expect(fs.readFileSync(f.rules,"utf8")).toBe(before);expect(f.store.getProjects()[0]?.creationRules?.hash).toBe(hash);
});
it("keeps the durable creation proof when sealing cannot be persisted",()=>{
 const f=fixture(),saved=f.save("CLI_PROFILE");vi.spyOn(f.store,"saveProjects").mockImplementation(()=>{throw new Error("synthetic registry failure");});expect(()=>f.service.finishCreation(f.project.path,f.project.id,saved.creationRevision)).toThrow("synthetic");expect(f.store.getProjects()[0]?.creationRules?.hash).toBe(saved.creationRulesHash);expect(f.store.getProjects()[0]?.creationRules?.revision).toBe(saved.creationRevision);
});
it("validates only real new-creation payloads without turning resume into new authorization",()=>{
 const service={finishCreation:vi.fn()},details={kind:"direct-create",creationProjectId:"project",creationRevision:"a".repeat(64)};
 expect(()=>creationSessionReady(service,"/project","existing-session",{details})).toThrow("不能重发");expect(creationSessionReady(service,"/project",null,{details:{kind:"flow"}})).toBeUndefined();expect(()=>creationSessionReady(service,"/project",null,{details:{kind:"project-created"}})).toThrow("凭据缺失");const ready=creationSessionReady(service,"/project",null,{details})!;expect(service.finishCreation).not.toHaveBeenCalled();ready();expect(service.finishCreation).toHaveBeenCalledWith("/project","project","a".repeat(64));
});
it("ordinary takeover only revokes registry ownership and preserves edited rules",()=>{
 const f=fixture();f.save("CLI_PROFILE");fs.writeFileSync(f.rules,"USER_RULE");releaseCreationOwnership(f.store,f.project.path);expect(fs.readFileSync(f.rules,"utf8")).toBe("USER_RULE");expect(f.store.getProjects()[0]?.creationRules).toBeUndefined();expect(()=>f.save("WEB_PROFILE")).toThrow("所有权不可验证");
});
it("retries after the final registry save fails following the owned rule replacement",()=>{
 const f=fixture(),first=f.save("CLI_PROFILE"),before=fs.readFileSync(f.rules,"utf8"),original=f.store.saveProjects.bind(f.store);let writes=0;
 const save=vi.spyOn(f.store,"saveProjects").mockImplementation(projects=>{if(++writes===2)throw new Error("synthetic final registry failure");original(projects);});
 expect(()=>f.save("WEB_PROFILE")).toThrow("synthetic final registry");expect(fs.readFileSync(f.rules,"utf8")).toBe(before);expect(f.store.getProjects()[0]?.creationRules?.hash).toBe(first.creationRulesHash);expect(()=>f.service.finishCreation(f.project.path,f.project.id,first.creationRevision)).toThrow("配置已变化");save.mockRestore();finishInitialProjectProfile(f.project.path);
 const retry=new ProjectService(f.store).saveCreationProfile(f.project.path,"WEB_PROFILE",()=>fs.writeFileSync(f.profile,JSON.stringify({platformSpec:"WEB_PROFILE"})));expect(fs.readFileSync(f.rules,"utf8")).toContain("WEB_PROFILE");expect(f.store.getProjects()[0]?.creationRules?.revision).toBe(retry.creationRevision);
});
it("revokes old receipts before visual-only changes even when rule text stays identical",()=>{
 const f=fixture(),first=f.service.saveCreationProfile(f.project.path,"SAME_WEB_SPEC",()=>{fs.mkdirSync(path.dirname(f.profile),{recursive:true});fs.writeFileSync(f.profile,JSON.stringify({style:"glass"}));});
 const second=f.service.saveCreationProfile(f.project.path,"SAME_WEB_SPEC",()=>{expect(()=>f.service.finishCreation(f.project.path,f.project.id,first.creationRevision)).toThrow("配置已变化");fs.writeFileSync(f.profile,JSON.stringify({style:"flat"}));});
 expect(second.creationRulesHash).toBe(first.creationRulesHash);expect(second.creationRevision).not.toBe(first.creationRevision);expect(()=>f.service.finishCreation(f.project.path,f.project.id,first.creationRevision)).toThrow("配置已变化");expect(()=>f.service.finishCreation(f.project.path,f.project.id,second.creationRevision)).not.toThrow();
});
it("does not touch assets when invalidating the previous receipt cannot be persisted",()=>{
 const f=fixture(),first=f.save("CLI_PROFILE"),before=fs.readFileSync(f.rules,"utf8"),assets=vi.fn();const save=vi.spyOn(f.store,"saveProjects").mockImplementationOnce(()=>{throw new Error("synthetic prepare failure");});
 expect(()=>f.service.saveCreationProfile(f.project.path,"WEB_PROFILE",assets)).toThrow("synthetic prepare");expect(assets).not.toHaveBeenCalled();expect(fs.readFileSync(f.rules,"utf8")).toBe(before);expect(f.store.getProjects()[0]?.creationRules?.revision).toBe(first.creationRevision);save.mockRestore();expect(()=>f.save("WEB_PROFILE")).not.toThrow();
});
it.each(["WEB_PROFILE","CLI_PROFILE"])("normalizes prepared content after interruption before retrying %s",specification=>{
 const f=fixture();f.save("CLI_PROFILE");const projects=f.store.getProjects(),owned=projects[0]!.creationRules!,next=initialProjectProfileContent(fs.readFileSync(f.rules),owned.baseBytes,"WEB_PROFILE");
 projects[0]!.creationRules={hash:owned.hash,baseBytes:owned.baseBytes,preparedHash:createHash("sha256").update(next).digest("hex")};f.store.saveProjects(projects);fs.writeFileSync(f.rules,next);finishInitialProjectProfile(f.project.path);
 const recovered=new ProjectService(f.store).saveCreationProfile(f.project.path,specification,()=>fs.writeFileSync(f.profile,JSON.stringify({platformSpec:specification})));expect(f.store.getProjects()[0]?.creationRules?.revision).toBe(recovered.creationRevision);expect(f.store.getProjects()[0]?.creationRules?.preparedHash).toBeUndefined();expect(fs.readFileSync(f.rules,"utf8")).toContain(specification);expect(fs.readFileSync(f.rules,"utf8")).not.toContain(specification==="WEB_PROFILE"?"CLI_PROFILE":"WEB_PROFILE");
});
it("does not roll back a user rule edit when an asset save fails",()=>{
 const f=fixture();f.save("CLI_PROFILE");expect(()=>f.service.saveCreationProfile(f.project.path,"WEB_PROFILE",()=>{fs.writeFileSync(f.rules,"USER_EDIT_DURING_SAVE");throw new Error("synthetic asset failure");})).toThrow("已保留");expect(fs.readFileSync(f.rules,"utf8")).toBe("USER_EDIT_DURING_SAVE");expect(()=>f.save("WEB_PROFILE")).toThrow("所有权");
});
it("returns a receipt after a durable final registry save with a lost acknowledgement",()=>{
 const f=fixture();f.save("CLI_PROFILE");const original=f.store.saveProjects.bind(f.store);let writes=0;vi.spyOn(f.store,"saveProjects").mockImplementation(projects=>{original(projects);if(++writes===2)throw new Error("synthetic lost commit acknowledgement");});
 const result=f.save("WEB_PROFILE");expect(f.store.getProjects()[0]?.creationRules?.revision).toBe(result.creationRevision);expect(fs.readFileSync(f.rules,"utf8")).toContain("WEB_PROFILE");
});
it("accepts a byte-identical atomic replacement without depending on its historical inode",()=>{
 const f=fixture();f.save("CLI_PROFILE");const content=fs.readFileSync(f.rules);fs.renameSync(f.rules,`${f.rules}.old`);fs.writeFileSync(f.rules,content);expect(()=>f.save("WEB_PROFILE")).not.toThrow();expect(fs.readFileSync(f.rules,"utf8")).toContain("WEB_PROFILE");
});
