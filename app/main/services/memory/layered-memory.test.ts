import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import {MemoryDatabase} from "./database";
import {estimateMemoryTokens} from "./context";
const fixtures:Array<{root:string;db:MemoryDatabase}>=[];
function setup(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"em-layered-")),db=new MemoryDatabase(path.join(root,"memory","memory.sqlite"));fixtures.push({root,db});return {root,db,main:path.join(root,"memory","MEMORY.md")};}
afterEach(()=>{vi.restoreAllMocks();for(const {db,root} of fixtures.splice(0)){if(db.db.isOpen)db.close();fs.rmSync(root,{recursive:true,force:true});}});
const nov=(day:number)=>Date.UTC(2026,10,day,12);
it("keeps the complete main file below 8k, moves condensed details by memory date, and retrieves them by ID",()=>{
 const {db,main,root}=setup();const saved=[];
 for(let i=0;i<20;i++)saved.push(db.save({kind:"activity",text:`项目阶段${i}的验证结论`,details:`条件${i}。${"已经提炼的必要条件和限定背景。".repeat(90)}`},{projectId:"p",confirmed:true,now:nov(10),source:{type:"manual",ref:`source-${i}`}}).item);
 expect(estimateMemoryTokens(fs.readFileSync(main,"utf8"))).toBeLessThanOrEqual(8000);
 const first=db.get(saved[0]!.key,"p")!;expect(first.details).toContain("限定背景");expect(first.memoryDate).toBe("2026-11-10");
 const file=path.join(root,"memory","deep","2026-11-10","MEMORY.md");expect(fs.existsSync(file)).toBe(true);expect(fs.readFileSync(file,"utf8")).toContain(saved[0]!.key);expect(fs.readFileSync(file,"utf8")).not.toContain("memory-body");
 const rows=db.db.prepare("SELECT json FROM memory UNION ALL SELECT json FROM revisions").all();expect(JSON.stringify(rows)).not.toContain("已经提炼的必要条件");
});
it("corrects the same deep record with a new memory date and preserves a meaningful old version",()=>{
 const {db,main,root}=setup(),old=db.save({kind:"decision",text:"原决定",details:"当时的条件"},{projectId:"p",confirmed:true,now:nov(10),source:{type:"manual",ref:"decision"}}).item;
 const view=db.scopeDocument("p");db.editDocument("# MEMORY\n",view.hash,"p");expect(db.get(old.key,"p")?.text).toBe("原决定");expect(db.get(old.key,"p")?.lifecycle).toBe("active");
 const next=db.update(old.key,"p",1,{text:"经新依据更正的决定",details:"更新后的条件"},nov(20));expect(next.key).toBe(old.key);expect(db.get(old.key,"p")?.memoryDate).toBe("2026-11-20");expect(fs.readFileSync(main,"utf8")).toContain("2026-11-20");expect(db.getRevision(old.key,1,"p")?.text).toBe("原决定");expect(fs.existsSync(path.join(root,"memory","deep","2026-11-10","MEMORY.md"))).toBe(true);
});
it("stores experiences separately, queries by family and forgets current/history bodies",()=>{
 const {db,main,root}=setup(),item=db.save({kind:"lesson",text:"缓存条件下的验证方法",details:"适用：本项目。\n\n做法：新进程对照。\n\n验证：两组结果不同。\n\n边界：该加载模块。"},{confirmed:true,projectId:"p",source:{type:"manual",ref:"method"}}).item;
 expect(fs.existsSync(main)?fs.readFileSync(main,"utf8"):"").not.toContain(item.text);expect(db.query({family:"memory",projectId:"p"}).total).toBe(0);expect(db.query({family:"experience",projectId:"p"}).total).toBe(1);
 db.update(item.key,"p",1,{details:"新验证后的边界"});expect(db.getRevision(item.key,1,"p")?.details).toContain("两组结果");db.forget(item.key,"p");expect(db.query({family:"experience",projectId:"p",history:true}).total).toBe(0);
 const files=fs.readdirSync(path.join(root,"experiences"),{recursive:true}).filter(file=>String(file).endsWith(".md"));expect(files).toHaveLength(0);
});
it("scopes summary reads and merges local edits without touching another project",()=>{
 const {db,main}=setup();const a=db.save({kind:"activity",text:"A项目的事实"},{projectId:"a",confirmed:true,source:{type:"manual",ref:"a"}}).item;
 const b=db.save({kind:"activity",text:"B项目的私有事实"},{projectId:"b",confirmed:true,source:{type:"manual",ref:"b"}}).item;
 const view=db.scopeDocument("a");expect(view.content).not.toContain(b.text);db.editDocument(view.content.replace(a.text,"A项目更精炼的表达"),view.hash,"a");expect(db.get(a.key,"a")?.text).toBe("A项目更精炼的表达");expect(db.get(b.key,"b")?.text).toBe(b.text);expect(fs.readFileSync(main,"utf8")).toContain(b.text);
 expect(()=>db.editDocument(view.content,view.hash,"a")).toThrow("changed");
});
it("keeps routine deadlines independent of write-time capacity checkpoints",()=>{
 const {db}=setup(),start=nov(17),first=db.ensureRoutine(start);db.finishRoutine(start);db.save({kind:"activity",text:"10点59分写入"},{confirmed:true,now:start+59*60000,source:{type:"manual",ref:"late"}});
 expect(first.nextDueAt).toBe(start+3600000);expect(db.ensureRoutine(start+59*60000).nextDueAt).toBe(start+3600000);expect(db.metadata<{tokens:number}>("capacityCheckpoint")?.tokens).toBeLessThan(8000);
});
it("recovers a partially installed multi-file move before exposing the committed index",()=>{
 const {db,main,root}=setup(),item=db.save({kind:"activity",text:"必须保留的原始核心",details:"凝练详情"},{confirmed:true,now:nov(10),source:{type:"manual",ref:"recover"}}).item;
 const before=db.scopeDocument(),rename=fs.renameSync;let reject=true;
 vi.spyOn(fs,"renameSync").mockImplementation((from,to)=>{if(String(to)===main&&reject)throw new Error("synthetic installation interruption");return rename(from,to);});
 expect(()=>db.editDocument("# MEMORY\n",before.hash)).toThrow("synthetic");expect(fs.existsSync(path.join(root,"memory","index-commit.json"))).toBe(true);reject=false;
 // Any subsequent transaction first completes the already-prepared operation.
 db.evaluate();expect(db.get(item.key)?.text).toBe(item.text);expect(db.get(item.key)?.details).toBe("凝练详情");expect(db.get(item.key)?.lifecycle).toBe("active");expect(fs.readFileSync(main,"utf8")).not.toContain(item.text);expect(fs.existsSync(path.join(root,"memory","index-commit.json"))).toBe(false);
});

it("preserves new-format Markdown when the qualification database is missing",()=>{
 const {db,main,root}=setup();db.save({kind:"activity",text:"MUST_PRESERVE_NEW_FORMAT_BODY"},{confirmed:true,source:{type:"manual",ref:"safe"}});db.close();const original=fs.readFileSync(main,"utf8"),file=path.join(root,"memory","memory.sqlite");fs.renameSync(file,`${file}.saved`);
 expect(()=>new MemoryDatabase(file)).toThrow("正文已保留");expect(fs.readFileSync(main,"utf8")).toBe(original);expect(()=>new MemoryDatabase(file)).toThrow("正文已保留");expect(fs.readFileSync(main,"utf8")).toBe(original);
});
