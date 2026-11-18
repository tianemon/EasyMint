import { DatabaseSync } from "node:sqlite";
import { expect,it,vi } from "vitest";
import { MemoryDatabase } from "./database";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {cleanupLegacyProject} from "./first-launch";
import {DOCUMENT_SEED,upsertDocumentEntry} from "./document-store";

it("retries transient WAL-mode contention while preserving real SQLite schema initialization",()=>{
  const original=DatabaseSync.prototype.exec;
  let attempts=0;
  const spy=vi.spyOn(DatabaseSync.prototype,"exec").mockImplementation(function(this:DatabaseSync,sql:string){
    if(sql.includes("journal_mode=WAL") && attempts++===0)throw Object.assign(new Error("database is locked"),{errcode:5});
    return original.call(this,sql);
  });
  let db:MemoryDatabase|undefined;
  try {
    db=new MemoryDatabase(":memory:");
    expect(attempts).toBe(2);
    expect(db.save({kind:"preference",text:"并发初始化后仍能保存"},{source:{ref:"test",type:"manual"},confirmed:true}).item.confidence).toBe("confirmed");
  } finally {spy.mockRestore();db?.close();}
});

it("refuses an existing foreign database before changing its bytes",async()=>{
  const fs=await import("node:fs"),os=await import("node:os"),path=await import("node:path");
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"em-memory-foreign-")),file=path.join(root,"memory.sqlite");
  const foreign=new DatabaseSync(file);foreign.exec("CREATE TABLE personal_data(value TEXT); INSERT INTO personal_data VALUES ('KEEP ORIGINAL')");foreign.close();
  const original=fs.readFileSync(file);
  try {expect(()=>new MemoryDatabase(file)).toThrow("未识别");expect(fs.readFileSync(file)).toEqual(original);}
  finally {fs.rmSync(root,{recursive:true,force:true});}
});


function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"em-fresh-memory-")),home=path.join(root,"home"),directory=path.join(home,"memory"),file=path.join(directory,"memory.sqlite");return {root,home,directory,file};}
function roles(home:string,main:unknown={rules:"CUSTOM_RULE"}){fs.writeFileSync(path.join(home,"system-prompts-v2.json"),JSON.stringify({version:2,rolesInJson:true,main,modes:[],templates:[]}));}
it.each([1,2,3,4])("starts fresh exactly once for recognized schema %s and leaves unrelated assets intact",version=>{
 const f=fixture();let db:MemoryDatabase|undefined;
 try{
  db=new MemoryDatabase(f.file);const old=db.save({kind:"activity",text:"OLD_FACT_BODY"},{confirmed:true,source:{type:"manual",ref:"old"}}).item;
  db.update(old.key,undefined,old.revision,{text:"OLD_UPDATED_BODY"});db.enqueue({ref:"old-job",sessionId:"s",entryId:"a",sessionFile:"never-read.jsonl",projectPath:"old",timestamp:1,hash:"old"});db.reserveUsage(12,"2026-11-17",100);
  fs.appendFileSync(path.join(f.directory,"MEMORY.md"),"\n## 人设\nCUSTOM_PERSONALITY\n\n## 规则\nCUSTOM_RULE\n");roles(f.home,{personality:"CUSTOM_PERSONALITY",rules:"CUSTOM_RULE"});
  fs.mkdirSync(path.join(f.directory,"deep","2026-01-01"),{recursive:true});fs.writeFileSync(path.join(f.directory,"deep","2026-01-01","MEMORY.md"),"OLD_DEEP_BODY");
  fs.mkdirSync(path.join(f.home,"experiences","history"),{recursive:true});fs.writeFileSync(path.join(f.home,"experiences","old.md"),"OLD_EXPERIENCE");fs.writeFileSync(path.join(f.home,"experiences","index.json"),"OLD_INDEX");fs.writeFileSync(path.join(f.home,"experiences","history","old.md"),"OLD_HISTORY");fs.writeFileSync(path.join(f.home,"learn-state.json"),"OLD_LEARN_STATE");
  fs.writeFileSync(path.join(f.directory,"index-commit.json"),"BROKEN_RETIRED_JOURNAL");fs.writeFileSync(path.join(f.directory,"MEMORY.md.old.pending"),"OLD_PENDING");
  const untouched=[path.join(f.home,"config-backups","keep.md"),path.join(f.home,"agent","sessions","chat.jsonl"),path.join(f.root,"project","开发记录.md")];for(const file of untouched){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,"UNRELATED_KEEP");}
  const roleBytes=fs.readFileSync(path.join(f.home,"system-prompts-v2.json"));db.db.exec(`PRAGMA user_version=${version}`);db.close();db=undefined;
  const before=Date.now();db=new MemoryDatabase(f.file);const epoch=db.status().recordingStartedAt!;expect(epoch).toBeGreaterThanOrEqual(before);expect(db.query({history:true,confidence:"all"}).total).toBe(0);expect(db.status()).toMatchObject({pending:0,usedTokens:0});expect(db.metadata("bodylessFormat")).toBe(4);expect((db.db.prepare("PRAGMA user_version").get() as any).user_version).toBe(5);
  for(const table of ["revisions","blocked_sources","jobs","usage","current_search","history_search","search_tokens"])expect((db.db.prepare(`SELECT count(*) n FROM ${table}`).get() as any).n).toBe(0);
  expect(fs.readFileSync(path.join(f.directory,"MEMORY.md"),"utf8")).toBe(DOCUMENT_SEED);for(const target of [path.join(f.directory,"deep"),path.join(f.home,"experiences"),path.join(f.home,"learn-state.json"),path.join(f.directory,"index-commit.json"),path.join(f.directory,"MEMORY.md.old.pending")])expect(fs.existsSync(target)).toBe(false);
  expect(fs.readFileSync(path.join(f.home,"system-prompts-v2.json"))).toEqual(roleBytes);for(const file of untouched)expect(fs.readFileSync(file,"utf8")).toBe("UNRELATED_KEEP");
  const fresh=db.save({kind:"lesson",text:"FRESH_VERIFIED_BODY",details:"Only the controlled comparison is covered."},{confirmed:true,source:{type:"manual",ref:"fresh"}}).item;db.close();db=undefined;
  db=new MemoryDatabase(f.file);expect(db.status().recordingStartedAt).toBe(epoch);expect(db.get(fresh.key)?.text).toBe("FRESH_VERIFIED_BODY");
 }finally{db?.close();fs.rmSync(f.root,{recursive:true,force:true});}
});
it.each([undefined,{version:2,rolesInJson:true,main:"BROKEN",modes:[],templates:[]},{version:2,rolesInJson:true,main:{},modes:[],templates:[null]},{version:2,rolesInJson:true,main:{},modes:[],templates:[{id:"custom"}]}])("refuses cleanup while a unique MD role has no valid JSON owner",config=>{
 const f=fixture();let db:MemoryDatabase|undefined;try{db=new MemoryDatabase(f.file);db.save({kind:"activity",text:"KEEP_OLD"},{confirmed:true,source:{type:"manual",ref:"old"}});fs.appendFileSync(path.join(f.directory,"MEMORY.md"),"\n## 规则\nCUSTOM_ONLY_COPY\n");if(config)fs.writeFileSync(path.join(f.home,"system-prompts-v2.json"),JSON.stringify(config));db.db.exec("PRAGMA user_version=4");db.close();db=undefined;
  expect(()=>new MemoryDatabase(f.file)).toThrow("角色配置尚未确认");expect(fs.readFileSync(path.join(f.directory,"MEMORY.md"),"utf8")).toContain("CUSTOM_ONLY_COPY");const raw=new DatabaseSync(f.file);try{expect((raw.prepare("PRAGMA user_version").get() as any).user_version).toBe(4);expect((raw.prepare("SELECT count(*) n FROM memory").get() as any).n).toBe(1);}finally{raw.close();}
 }finally{db?.close();fs.rmSync(f.root,{recursive:true,force:true});}
});
it("accepts real v2 partial main overrides while preserving the role configuration",()=>{
 const f=fixture();let db:MemoryDatabase|undefined;try{db=new MemoryDatabase(f.file);fs.writeFileSync(path.join(f.directory,"MEMORY.md"),"# MEMORY\n\n## 规则\nCUSTOM_RULE\n");roles(f.home);const config=fs.readFileSync(path.join(f.home,"system-prompts-v2.json"));db.db.exec("PRAGMA user_version=4");db.close();db=new MemoryDatabase(f.file);expect(db.status().recordingStartedAt).toBeTypeOf("number");expect(fs.readFileSync(path.join(f.home,"system-prompts-v2.json"))).toEqual(config);}finally{db?.close();fs.rmSync(f.root,{recursive:true,force:true});}
});
it("fails closed for missing fresh indexes and incomplete schema5 eligibility",()=>{
 const f=fixture();let db:MemoryDatabase|undefined;try{fs.mkdirSync(f.directory,{recursive:true});upsertDocumentEntry(path.join(f.directory,"MEMORY.md"),{key:"global/new",text:"KEEP_NEW_UNINDEXED_BODY"});expect(()=>new MemoryDatabase(f.file)).toThrow("索引缺失");expect(fs.readFileSync(path.join(f.directory,"MEMORY.md"),"utf8")).toContain("KEEP_NEW_UNINDEXED_BODY");fs.unlinkSync(path.join(f.directory,"MEMORY.md"));db=new MemoryDatabase(f.file);const item=db.save({kind:"activity",text:"KEEP_FRESH_BODY"},{confirmed:true,source:{type:"manual",ref:"fresh"}}).item;db.db.prepare("DELETE FROM metadata WHERE key='recordingStartedAt'").run();db.close();db=undefined;expect(()=>new MemoryDatabase(f.file)).toThrow("资格状态不完整");expect(fs.readFileSync(path.join(f.directory,"MEMORY.md"),"utf8")).toContain(item.text);}finally{db?.close();fs.rmSync(f.root,{recursive:true,force:true});}
});
it("does not mark fresh completion after a cleanup failure and safely retries",()=>{
 const f=fixture();let db:MemoryDatabase|undefined;try{db=new MemoryDatabase(f.file);db.save({kind:"activity",text:"OLD_RETIRED_BODY"},{confirmed:true,source:{type:"manual",ref:"old"}});db.db.exec("PRAGMA user_version=4");db.close();db=undefined;fs.mkdirSync(path.join(f.home,"experiences"),{recursive:true});const old=path.join(f.home,"experiences","old.md");fs.writeFileSync(old,"OLD_SOURCE");const unlink=fs.unlinkSync,spy=vi.spyOn(fs,"unlinkSync").mockImplementation(file=>{if(String(file)===old)throw new Error("synthetic cleanup failure");return unlink(file);});try{expect(()=>new MemoryDatabase(f.file)).toThrow("synthetic cleanup failure");}finally{spy.mockRestore();}const raw=new DatabaseSync(f.file);try{expect((raw.prepare("PRAGMA user_version").get() as any).user_version).toBe(4);}finally{raw.close();}db=new MemoryDatabase(f.file);expect(db.query().total).toBe(0);expect(fs.existsSync(old)).toBe(false);}finally{db?.close();fs.rmSync(f.root,{recursive:true,force:true});}
});
it("refuses linked database paths and legacy trees without touching their targets",()=>{
 const f=fixture();try{fs.mkdirSync(f.directory,{recursive:true});const outside=path.join(f.root,"outside.db");fs.writeFileSync(outside,"PRIVATE_BYTES");fs.symlinkSync(outside,f.file);expect(()=>new MemoryDatabase(f.file)).toThrow("不能跟随链接");expect(fs.readFileSync(outside,"utf8")).toBe("PRIVATE_BYTES");fs.unlinkSync(f.file);fs.mkdirSync(path.join(f.home,"experiences"));fs.symlinkSync(outside,path.join(f.home,"experiences","linked.md"));expect(()=>new MemoryDatabase(f.file)).toThrow("普通文件");expect(fs.readFileSync(outside,"utf8")).toBe("PRIVATE_BYTES");}finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
it("keeps empty fresh initialization idempotent and rejects future databases",()=>{
 const f=fixture();let db:MemoryDatabase|undefined;try{db=new MemoryDatabase(f.file);expect(fs.existsSync(path.join(f.directory,"MEMORY.md"))).toBe(false);const epoch=db.status().recordingStartedAt;db.close();db=new MemoryDatabase(f.file);expect(db.status().recordingStartedAt).toBe(epoch);db.db.exec("PRAGMA user_version=6");db.close();db=undefined;expect(()=>new MemoryDatabase(f.file)).toThrow("版本高于");}finally{db?.close();fs.rmSync(f.root,{recursive:true,force:true});}
});
it("persists the worker's earlier startup candidate only for the fresh epoch",()=>{
 const f=fixture();let db:MemoryDatabase|undefined;try{const started=Date.now()-30_000;db=new MemoryDatabase(f.file,started);expect(db.status().recordingStartedAt).toBe(started);db.close();db=new MemoryDatabase(f.file,Date.now());expect(db.status().recordingStartedAt).toBe(started);db.close();db=undefined;const invalid=path.join(f.root,"invalid","memory","memory.sqlite");expect(()=>new MemoryDatabase(invalid,Number.NaN)).toThrow("记录起点无效");}finally{db?.close();fs.rmSync(f.root,{recursive:true,force:true});}
});
it("uses the version observed after acquiring the SQLite write lock",()=>{
 const f=fixture();let db:MemoryDatabase|undefined;try{db=new MemoryDatabase(f.file);const item=db.save({kind:"activity",text:"NEW_FROM_COMPLETED_INITIALIZER"},{confirmed:true,source:{type:"manual",ref:"fresh"}}).item;db.db.exec("PRAGMA user_version=4");db.close();db=undefined;
  const original=DatabaseSync.prototype.exec;let advanced=false;
  const spy=vi.spyOn(DatabaseSync.prototype,"exec").mockImplementation(function(this:DatabaseSync,sql:string){
   if(!advanced&&sql.includes("BEGIN IMMEDIATE")){advanced=true;const other=new DatabaseSync(f.file);try{original.call(other,"BEGIN IMMEDIATE");other.prepare("UPDATE metadata SET json=? WHERE key='recordingStartedAt'").run("77");original.call(other,"PRAGMA user_version=5; COMMIT");}finally{other.close();}}
   return original.call(this,sql);
  });
  try{db=new MemoryDatabase(f.file);}finally{spy.mockRestore();}
  expect(advanced).toBe(true);expect(db.get(item.key)?.text).toBe(item.text);expect(db.status().recordingStartedAt).toBe(77);
 }finally{db?.close();fs.rmSync(f.root,{recursive:true,force:true});}
});
it("cleans only retired project entries, retaining documents and retrying linked or readonly paths",()=>{
 const f=fixture();let db:MemoryDatabase|undefined;try{db=new MemoryDatabase(f.file);const project=path.join(f.root,"project"),metadata=path.join(project,".easymint"),experiences=path.join(metadata,"experiences"),doc=path.join(project,"开发记录.md");fs.mkdirSync(experiences,{recursive:true});fs.writeFileSync(doc,"KEEP_PROJECT_DOCUMENT");fs.writeFileSync(path.join(experiences,"old.md"),"OLD");fs.writeFileSync(path.join(metadata,"learn-state.json"),"OLD");fs.chmodSync(experiences,0o500);expect(db.cleanupLegacyProjects([{id:"p",path:project}]).warnings).toHaveLength(1);expect(db.metadata("projectCleanup:v1:p")).toBeUndefined();fs.chmodSync(experiences,0o700);expect(db.cleanupLegacyProjects([{id:"p",path:project}]).warnings).toEqual([]);expect(db.metadata("projectCleanup:v1:p")).toBe(true);expect(fs.readFileSync(doc,"utf8")).toBe("KEEP_PROJECT_DOCUMENT");expect(fs.existsSync(experiences)).toBe(false);fs.symlinkSync(f.root,experiences);expect(cleanupLegacyProject(project).warnings).toHaveLength(1);expect(fs.existsSync(doc)).toBe(true);}finally{db?.close();fs.rmSync(f.root,{recursive:true,force:true});}
});
