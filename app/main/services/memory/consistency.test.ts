import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterEach,expect,it,vi} from "vitest";
import {MemoryDatabase} from "./database";
import {readDocument,upsertDocumentEntry,writeDocument} from "./document-store";
import {hashText} from "./codec";
import {parseEntries} from "./memory-entries";
const fixtures:Array<{root:string;db:MemoryDatabase}>=[];
function setup(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"em-memory-consistency-")),db=new MemoryDatabase(path.join(root,"memory.sqlite"));fixtures.push({root,db});return {root,db,file:path.join(root,"MEMORY.md")};}
afterEach(()=>{vi.restoreAllMocks();for(const {root,db} of fixtures.splice(0)){db.close();fs.rmSync(root,{recursive:true,force:true});}});
const save=(db:MemoryDatabase,text="durable preference")=>db.save({kind:"preference",text},{confirmed:true,source:{ref:"manual:source",type:"manual"}}).item;
it("rolls back metadata when the atomic document replacement fails and preserves the original",()=>{
 const {db,file,root}=setup();writeDocument(file,"# MEMORY\n\n## 规则\n不更改规则\n");const original=readDocument(file);
 const rename=fs.renameSync;vi.spyOn(fs,"renameSync").mockImplementation((from,to)=>{if(String(to)===file)throw new Error("synthetic readonly");return rename(from,to);});
 expect(()=>save(db)).toThrow("synthetic readonly");expect(readDocument(file)).toBe(original);expect(db.query().total).toBe(0);expect(fs.existsSync(path.join(root,"index-commit.json"))).toBe(true);
});
it("recovers metadata and searchable indexes if SQLite commit fails after document replacement",()=>{
 const {db,file,root}=setup(),exec=DatabaseSync.prototype.exec;let failed=false;
 vi.spyOn(DatabaseSync.prototype,"exec").mockImplementation(function(this:DatabaseSync,sql:string){if(sql==="COMMIT"&&!failed){failed=true;throw new Error("synthetic commit failure");}return exec.call(this,sql);});
 const item=save(db,"recoverableunique");expect(failed).toBe(true);expect(readDocument(file)).toContain("recoverableunique");expect(db.get(item.key)?.text).toBe("recoverableunique");expect(db.query({query:"recoverableunique"}).total).toBe(1);expect(fs.existsSync(path.join(root,"index-commit.json"))).toBe(false);
});
it("keeps pending corrections in the same document but excludes them from active facts until due",()=>{
 const {db,file}=setup(),item=save(db,"old preference"),at=Date.now()+1000;
 const scheduled=db.update(item.key,undefined,1,{text:"future preference",details:"future condition",effectiveAt:at});
 expect(db.get(item.key)?.text).toBe("old preference");expect(db.get(item.key)?.pending?.patch.text).toBe("future preference");expect(parseEntries(readDocument(file)!).filter(entry=>entry.pending)).toHaveLength(0);
 expect(db.get(item.key)?.pending?.patch.details).toBe("future condition");
 const row=db.db.prepare("SELECT json FROM memory").get() as {json:string};expect(row.json).not.toContain("future preference");expect(row.json).not.toContain("future condition");
 db.activateDue(at+1);expect(db.get(item.key)?.text).toBe("future preference");expect(db.get(item.key)?.revision).toBe(scheduled.revision+1);expect(parseEntries(readDocument(file)!).filter(entry=>entry.pending)).toHaveLength(0);
});
it("never appends facts into role sections or changes roles during whole-document maintenance",()=>{
 const {db,file}=setup();writeDocument(file,"# MEMORY\n\n## 关于用户\n\n## 人设\n- 性格稳重\n\n## 规则\n- 不改用户文件\n");
 const item=save(db,"用户偏好中文");const content=readDocument(file)!;expect(content.indexOf("用户偏好中文")).toBeLessThan(content.indexOf("## 人设"));
 expect(parseEntries(content).map(entry=>entry.key)).toEqual([item.key]);
 expect(()=>db.editDocument(content.replace("不改用户文件","随意覆盖"),hashText(content))).toThrow("不能修改规则或人设");expect(readDocument(file)).toBe(content);
 upsertDocumentEntry(file,{key:"new",text:"新事实"});expect(readDocument(file)).toContain("- 不改用户文件");
});
it("does not inject foreign, missing-index, stale or unreadable facts",()=>{
 const {db,file}=setup();const item=save(db);expect(db.lookupReferences([item.key],"other")).toHaveLength(1);
 const foreign=db.save({kind:"preference",text:"PROJECT_SECRET"},{confirmed:true,projectId:"foreign",source:{type:"manual",ref:"other"}}).item;
 expect(db.lookupReferences([foreign.key],"mine")).toHaveLength(0);expect(db.lookupReferences(["global/missing"])).toEqual([]);
 writeDocument(file,readDocument(file)!.replace("durable preference","tampered"));const body=parseEntries(readDocument(file)!).find(entry=>entry.key===item.key)!;
 expect(db.lookupReferences([item.key])[0]!.bodyHash).not.toBe(hashText(JSON.stringify([body.text,null,null])));
});

it("restores a historical activity as an active complete fact rather than claiming success and dropping it",async()=>{
 const {db,file}=setup(),item=db.save({kind:"activity",text:"ProjectMilestoneDone"},{projectId:"p",confirmed:true,source:{type:"manual",ref:"milestone"}}).item;
 const archived=db.update(item.key,"p",item.revision,{lifecycle:"archived"});const {managePatch}=await import("./manage-patch");
 const patch=managePatch("restore",db.get(item.key,"p")!,{kind:"activity",text:"ProjectMilestoneDone"});db.update(item.key,"p",archived.revision,patch);
 expect(db.get(item.key,"p")?.lifecycle).toBe("active");expect(db.get(item.key,"p")?.text).toBe("ProjectMilestoneDone");expect(readDocument(file)).toContain("ProjectMilestoneDone");expect(db.query({projectId:"p",view:"current"}).items.map(item=>item.key)).toContain(item.key);
});
