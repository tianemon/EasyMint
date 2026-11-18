import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it} from "vitest";
import {MemoryDatabase} from "./database";
import {readDocument} from "./document-store";
const readSummaryDocument=(_db:MemoryDatabase,_file:string,_projects:unknown[])=>{return _db.scopeDocument();};
const saveSummaryDocument=(db:MemoryDatabase,file:string,_projects:unknown[],content:string,hash:string)=>{db.editDocument(content,hash);return readSummaryDocument(db,file,[]);};
const fixtures:Array<{root:string;db:MemoryDatabase}>=[];
const setup=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"em-memory-document-")),db=new MemoryDatabase(path.join(root,"memory.sqlite"));fixtures.push({root,db});return {db,file:path.join(root,"MEMORY.md")};};
afterEach(()=>{for(const {db,root} of fixtures.splice(0)){db.close();fs.rmSync(root,{recursive:true,force:true});}});
const save=(db:MemoryDatabase,text="简洁回答")=>db.save({kind:"preference",text},{source:{type:"manual",ref:"manual:fixture"},confirmed:true}).item;
it("uses one canonical body, updates it immediately, and keeps only searchable metadata in SQLite",()=>{
 const {db,file}=setup();const item=save(db,"UNIQUE_BODY_FIRST");
 expect(readSummaryDocument(db,file,[]).content).toContain("UNIQUE_BODY_FIRST");
 db.update(item.key,undefined,1,{text:"UNIQUE_BODY_SECOND",details:"UNIQUE_DETAILS"});
 const doc=readSummaryDocument(db,file,[]);expect(doc.content).toContain("UNIQUE_BODY_SECOND");expect(doc.content).not.toContain("UNIQUE_BODY_FIRST");
 const rows=db.db.prepare("SELECT json FROM memory UNION ALL SELECT json FROM revisions").all();
 expect(JSON.stringify(rows)).not.toMatch(/UNIQUE_BODY|UNIQUE_DETAILS/u);
 expect(db.query({query:"UNIQUE_BODY_FIRST",history:true}).total).toBe(1);
 expect(db.getRevision(item.key,1)?.sources[0]?.ref).toBe("manual:fixture");
});
it("atomically applies an agent's fact edit while preserving other prose and rejecting stale edits",()=>{
 const {db,file}=setup(),item=save(db),before=readSummaryDocument(db,file,[]);
 const next=saveSummaryDocument(db,file,[],before.content.replace("简洁回答","详细解释"),before.hash);
 expect(db.get(item.key)?.text).toBe("详细解释");expect(db.get(item.key)?.revision).toBe(2);
 expect(()=>saveSummaryDocument(db,file,[],"过期覆盖",before.hash)).toThrow("changed");
 db.update(item.key,undefined,2,{text:"再作更正"});expect(readSummaryDocument(db,file,[]).content).toContain("再作更正");expect(next.hash).not.toBe(before.hash);
});
it("rejects both whole and partial edits of protected roles, even when no fact exists",()=>{
 const {db,file}=setup(),before=readSummaryDocument(db,file,[]);
 // Role edits are accepted only by the role-settings transaction.
 expect(()=>saveSummaryDocument(db,file,[],"# MEMORY\n\n## 规则\n禁止修改\n",before.hash)).toThrow("不能修改规则或人设");
 expect(fs.existsSync(file)).toBe(false);
});
it("never treats an unreadable document as empty or regenerates it from indexes",()=>{
 const {db,file}=setup();save(db);fs.unlinkSync(file);fs.mkdirSync(file);
 expect(()=>readDocument(file)).toThrow();
 expect(()=>save(db,"新事实")).toThrow();expect(fs.statSync(file).isDirectory()).toBe(true);
 expect((db.db.prepare("SELECT count(*) n FROM memory").get() as {n:number}).n).toBe(1);
});
it("does not silently cap the document at forty indexed facts",()=>{
 const {db,file}=setup();for(let i=0;i<45;i++)save(db,`用户明确偏好${i}`);
 const document=readSummaryDocument(db,file,[]);expect(document.content).toContain("用户明确偏好0");expect(document.content).toContain("用户明确偏好44");expect(db.query({limit:1}).total).toBe(45);
});
it("archiving removes current prose but retains the source index; forget removes both",()=>{
 const {db,file}=setup(),item=save(db,"ARCHIVE_UNIQUE");
 db.update(item.key,undefined,1,{lifecycle:"archived"});expect(fs.readFileSync(file,"utf8")).not.toContain("ARCHIVE_UNIQUE");
 expect(db.query({query:"ARCHIVE_UNIQUE",history:true}).total).toBe(1);expect(db.get(item.key)?.sources).toHaveLength(1);
 db.forget(item.key);expect(db.query({query:"ARCHIVE_UNIQUE",history:true}).total).toBe(0);
});
