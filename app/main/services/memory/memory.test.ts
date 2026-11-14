import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryDatabase } from "./database";
import { migrateExperiences } from "./migration";
import { adoptDocuments, generateDocuments, previewDocuments } from "./documents";
import { evaluateLifecycle, retentionScore } from "./policy";
import type { MemoryRecord } from "../../../shared/memory";

const databases:MemoryDatabase[]=[];
const directories:string[]=[];
function setup() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"em-memory-test-")); directories.push(root);
  const db=new MemoryDatabase(path.join(root,"store","memory.sqlite")); databases.push(db);
  return {root,db};
}
function save(db:MemoryDatabase,text="项目使用现有复选框",projectId:string|undefined="p") {
  return db.save({kind:"decision",text,occurredAt:100},{projectId,source:{ref:`session:${text}`,type:"session",sessionId:"s",entryId:"e"},confirmed:true}).item;
}
afterEach(()=>{ for(const db of databases.splice(0)) db.close(); for(const dir of directories.splice(0)) fs.rmSync(dir,{recursive:true,force:true}); });

describe("memory persistence and recall boundaries",()=>{
  it("preserves scope, finds Chinese short words, hides candidates and retired items",()=>{
    const {db}=setup();
    const p=save(db), g=save(db,"全局原生控件偏好",undefined);
    save(db,"另一个项目的复选框","other");
    db.save({kind:"lesson",text:"推导：复选框应该更大"},{projectId:"p",source:{ref:"inference",type:"session"},confirmed:false});
    expect(db.query({query:"复选框",projectId:"p"}).items.map(i=>i.key)).toEqual([p.key]);
    expect(db.query({query:"原生",projectId:"p"}).items.map(i=>i.key)).toContain(g.key);
    db.update(p.key,"p",p.revision,{lifecycle:"retired"});
    expect(db.query({query:"复选框",projectId:"p"}).items).toHaveLength(0);
    expect(db.query({query:"复选框",projectId:"p",history:true}).items.map(i=>i.key)).toEqual([p.key]);
    expect(db.get(p.key,"other")).toBeUndefined();
  });
  it("only indexes archive summaries, does not refresh retention on search, and retains revision history",()=>{
    const {db}=setup();
    const item=db.save({kind:"lesson",text:"简要摘要",details:"独有细节 secretneedle"},{projectId:"p",source:{ref:"source",type:"session"},confirmed:true}).item;
    expect(db.query({query:"secretneedle",projectId:"p"}).items).toHaveLength(1);
    const archived=db.update(item.key,"p",1,{lifecycle:"archived"});
    expect(db.query({query:"secretneedle",projectId:"p"}).items).toHaveLength(0);
    expect(db.query({query:"secretneedle",projectId:"p",history:true}).items).toHaveLength(1);
    expect(db.get(item.key,"p")?.substantiveAt).toBe(item.substantiveAt);
    const updated=db.update(item.key,"p",archived.revision,{text:"修正摘要"});
    expect(()=>db.update(item.key,"p",archived.revision,{text:"过期覆盖"})).toThrow("已更新");
    expect(db.revisions(item.key,"p").map(i=>i.text)).toEqual([updated.text,item.text,item.text]);
  });
  it("forget is complete across revisions and blocks a slow background result",()=>{
    const {db}=setup();
    const item=save(db);
    const job={ref:item.sources[0]!.ref,sessionId:"s",entryId:"e",sessionFile:"fake",projectPath:"fake",timestamp:10,hash:"h",projectId:"p"};
    db.enqueue(job); const claimed=db.claim()!;
    db.forget(item.key,"p");
    expect(db.finishJob(claimed,[{input:{kind:"decision",text:item.text},context:{projectId:"p",source:item.sources[0]!,confirmed:true}}],100,"day")).toBe(false);
    expect(db.query({projectId:"p",history:true,state:"all"}).items).toHaveLength(0);
    expect(db.revisions(item.key,"p")).toHaveLength(0);
    expect(()=>db.save({kind:"decision",text:item.text},{projectId:"p",source:item.sources[0]!,confirmed:true})).toThrow("旧来源");
    expect(db.save({kind:"decision",text:item.text},{projectId:"p",source:{ref:"new-user-intent",type:"session"},confirmed:true}).existing).toBe(false);
  });
  it("keeps confirmed memories on chat deletion, with honest source markers",()=>{
    const {db}=setup(); const item=save(db);
    db.detachSession("s",false);
    expect(db.get(item.key,"p")?.sources[0]?.deleted).toBe(true);
    expect(db.revisions(item.key,"p").every(r=>r.sources.every(s=>s.deleted))).toBe(true);
    db.detachSession("s",true);
    expect(db.get(item.key,"p")).toBeUndefined();
  });
});

describe("lossless legacy migration",()=>{
  it("backs up original bytes, imports indexed, archived and orphan bodies, and preserves conflicts",()=>{
    const {root,db}=setup(); const dir=path.join(root,"experiences"), backups=path.join(root,"backups");
    fs.mkdirSync(path.join(dir,"archive"),{recursive:true});
    const raw=Buffer.from("# 旧规则\r\n\r\n完整正文\r\n");
    fs.writeFileSync(path.join(dir,"one.md"),raw);
    fs.writeFileSync(path.join(dir,"orphan.md"),"没有索引的正文");
    fs.writeFileSync(path.join(dir,"archive","old.md"),"旧归档正文");
    fs.writeFileSync(path.join(dir,"index.json"),JSON.stringify({items:[{id:"old-id",title:"旧规则",file:"one.md",kind:"convention",tags:["ui"],createdAt:10,updatedAt:20},{id:"missing-id",title:"缺失",file:"missing.md"}]}));
    fs.writeFileSync(path.join(dir,"archive","index.json"),"[]");
    const report=migrateExperiences(db,dir,backups,"p");
    expect(report.imported).toBe(4); expect(report.missing).toEqual(["missing.md"]);
    expect(fs.readFileSync(path.join(dir,"one.md"))).toEqual(raw);
    expect(fs.readFileSync(path.join(report.backup,"one.md"))).toEqual(raw);
    expect(db.get("old-id","p")?.details).toBe(raw.toString());
    expect(db.get("old-id","p")?.state).toBe("candidate");
    expect(db.query({projectId:"p"}).items).toHaveLength(0);
    expect(migrateExperiences(db,dir,backups,"p").imported).toBe(0);
    fs.writeFileSync(path.join(dir,"one.md"),"后来变化的旧正文");
    const changed=migrateExperiences(db,dir,backups,"p");
    expect(changed.conflicts).toBe(1);
    expect(db.get("old-id","p")?.details).toBe(raw.toString());
    expect(db.query({projectId:"p",history:true,state:"all",limit:50}).total).toBe(5);
  });
  it("never rewrites a damaged index and still preserves orphan files",()=>{
    const {root,db}=setup(); const dir=path.join(root,"broken"); fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir,"index.json"),"{broken"); fs.writeFileSync(path.join(dir,"body.md"),"有价值的旧正文");
    const report=migrateExperiences(db,dir,path.join(root,"backups"));
    expect(report.errors).toHaveLength(1); expect(report.imported).toBe(1);
    expect(fs.readFileSync(path.join(dir,"index.json"),"utf8")).toBe("{broken");
  });
});

describe("lifecycle and deterministic project documents",()=>{
  it("high importance eventually decays; pins survive, and expiration stops current recall",()=>{
    const {db}=setup(); const base=save(db);
    const item={...base,createdAt:0,substantiveAt:0,importance:"high"} as MemoryRecord;
    const later=3*365*86_400_000;
    expect(retentionScore(item,later)).toBeLessThan(0.35);
    const low=evaluateLifecycle(item,later)!;
    const archived=evaluateLifecycle(low,later+31*86_400_000)!;
    expect(archived.lifecycle).toBe("archived");
    expect(evaluateLifecycle(archived,later+212*86_400_000)?.lifecycle).toBe("retired");
    expect(evaluateLifecycle({...item,pinned:true},later)).toBeNull();
    db.save({kind:"attention",text:"过去的临时提醒",expiresAt:1},{projectId:"p",source:{ref:"expired",type:"manual"},confirmed:true});
    expect(db.query({query:"提醒",projectId:"p"}).items).toHaveLength(0);
  });
  it("preserves old navigation and daily files, retains retired history, and stops on human edits",()=>{
    const {root,db}=setup(); const project=path.join(root,"project"), docs=path.join(project,"private_docs");
    fs.mkdirSync(path.join(docs,"开发记录"),{recursive:true});
    const original="原有导航与重要决定\n"; fs.writeFileSync(path.join(docs,"开发记录.md"),original);
    fs.writeFileSync(path.join(docs,"开发记录","2026-01-01.md"),"旧日期日志不可丢失");
    const event=save(db,"已讨论，尚未实施");
    const preview=previewDocuments(project,docs);
    const adopted=adoptDocuments(db,"p",project,docs,preview.hash,path.join(root,"backups"));
    expect(adopted.error).toBeUndefined();
    expect(fs.readFileSync(path.join(docs,adopted.legacy!),"utf8")).toBe(original);
    expect(fs.readFileSync(path.join(docs,"开发记录","2026-01-01.md"),"utf8")).toBe("旧日期日志不可丢失");
    db.update(event.key,"p",event.revision,{lifecycle:"retired"}); generateDocuments(db,"p",project);
    expect(fs.readFileSync(path.join(docs,"开发记录.md"),"utf8")).not.toContain(event.text);
    expect(fs.readFileSync(path.join(docs,"开发记录","1970-01-em.md"),"utf8")).toContain(event.text);
    fs.writeFileSync(path.join(docs,"开发记录.md"),"用户自行编辑"); save(db,"新的项目活动");
    expect(generateDocuments(db,"p",project).error).toContain("外部修改");
    expect(fs.readFileSync(path.join(docs,"开发记录.md"),"utf8")).toBe("用户自行编辑");
  });
});

describe("historical integrity and recovery",()=>{
  it("finds superseded wording only in history and points to the matching revision",()=>{
    const {db}=setup();const item=save(db,"obsoleteunique 决定A");
    db.update(item.key,"p",item.revision,{text:"replacementunique 决定B"});
    expect(db.query({projectId:"p",query:"obsoleteunique"}).total).toBe(0);
    const history=db.query({projectId:"p",query:"obsoleteunique",history:true});
    expect(history.total).toBe(1);expect(history.items[0]?.matchedRevision).toBe(1);
    expect(db.getRevision(item.key,1,"p")?.text).toBe(item.text);
  });
  it("forget blocks sources from every revision, including an old queued conclusion",()=>{
    const {db}=setup();
    const item=db.save({kind:"preference",text:"原偏好"},{source:{ref:"user:s:u1",type:"session",sessionId:"s",entryId:"u1"},confirmed:true}).item;
    db.update(item.key,undefined,1,{text:"新偏好",sources:[{ref:"user:s:u2",type:"session",sessionId:"s",entryId:"u2"}]});
    db.enqueue({ref:"conclusion:s:a1",anchorRef:"user:s:u1",sessionId:"s",entryId:"a1",sessionFile:"fake",projectPath:"fake",timestamp:100,hash:"old"});
    const claimed=db.claim()!;db.forget(item.key);
    expect(db.isBlocked("user:s:u1")).toBe(true);expect(db.isBlocked("user:s:u2")).toBe(true);
    expect(db.finishJob(claimed,[],0,"day")).toBe(false);
    expect(db.status().pending).toBe(0);
  });
  it("keeps invalidated project events as labeled history without exposing them as current work",()=>{
    const {root,db}=setup();const project=path.join(root,"project");fs.mkdirSync(project);
    const item=db.save({kind:"decision",text:"已撤回的项目决定",occurredAt:100},{projectId:"p",source:{ref:"conclusion:s:a",type:"session",sessionId:"s",entryId:"a",hash:"old"},confirmed:true}).item;
    const dir=path.join(project,"docs"),preview=previewDocuments(project,dir);adoptDocuments(db,"p",project,dir,preview.hash,path.join(root,"backups"));
    expect(db.invalidateSession("s",[])).toBe(1);generateDocuments(db,"p",project);
    expect(db.query({projectId:"p"}).items).toHaveLength(0);
    expect(db.query({projectId:"p",query:"撤回",history:true}).items[0]?.key).toBe(item.key);
    expect(fs.readFileSync(path.join(dir,"开发记录.md"),"utf8")).not.toContain(item.text);
    const history=fs.readFileSync(path.join(dir,"开发记录","1970-01-em.md"),"utf8");
    expect(history).toContain(item.text);expect(history).toContain("仅作历史记录");
  });
  it("resumes a projection interrupted after file rename but before metadata completion",()=>{
    const {root,db}=setup();const project=path.join(root,"project");fs.mkdirSync(project);
    const item=save(db,"旧事件");const dir=path.join(project,"docs"),preview=previewDocuments(project,dir);
    const before=adoptDocuments(db,"p",project,dir,preview.hash,path.join(root,"backups"));
    db.update(item.key,"p",1,{text:"新事件"});const after=generateDocuments(db,"p",project);
    const pending=Object.fromEntries(Object.keys(after.hashes).map(file=>[file,{before:before.hashes[file],after:after.hashes[file]!}]));
    db.setMetadata("documents:p",{...before,pending});
    const recovered=generateDocuments(db,"p",project);
    expect(recovered.error).toBeUndefined();expect(recovered.hashes).toEqual(after.hashes);
    expect(fs.readFileSync(path.join(dir,"开发记录.md"),"utf8")).toContain("新事件");
  });
});

it("does not promote a rejected inference when another assistant conclusion repeats the same user evidence",()=>{
  const {db}=setup();
  const original=db.save({kind:"lesson",text:"未获认可的通用规则"},{source:{ref:"conclusion:s:a1",anchorRef:"user:s:u",type:"session"},confirmed:false}).item;
  db.update(original.key,undefined,1,{state:"rejected"});
  const repeated=db.save({kind:"lesson",text:original.text},{source:{ref:"conclusion:s:a2",anchorRef:"user:s:u",type:"session"},confirmed:true});
  expect(repeated.item.state).toBe("rejected");
  const fresh=db.save({kind:"lesson",text:original.text},{source:{ref:"conclusion:s:a3",anchorRef:"user:s:new",type:"session"},confirmed:true});
  expect(fresh.item.state).toBe("confirmed");
});


it("guards updates against forgotten evidence while accepting a new manual confirmation",()=>{
  const {db}=setup(),forgotten=save(db,"待遗忘来源"),survivor=save(db,"另一项决定");
  db.forget(forgotten.key,"p");
  expect(()=>db.update(survivor.key,"p",survivor.revision,{text:"复活遗忘内容",sources:[...survivor.sources,...forgotten.sources]})).toThrow("旧来源");
  expect(db.get(survivor.key,"p")?.text).toBe("另一项决定");
  const next=db.update(survivor.key,"p",survivor.revision,{text:"用户重新明确确认",sources:[...survivor.sources,...forgotten.sources,{type:"manual",ref:"manual:new-confirmation"}],state:"confirmed"});
  expect(next.text).toBe("用户重新明确确认");
});
it("atomically reserves daily quota and reconciles actual usage with a signed adjustment",()=>{
  const {db,root}=setup(),other=new MemoryDatabase(path.join(root,"store","memory.sqlite"));databases.push(other);
  expect(db.reserveUsage(800,"day",1000)).toBe(true);
  expect(other.reserveUsage(300,"day",1000)).toBe(false);
  db.releaseJob({ref:"missing"} as any,-670,"day");
  expect(other.status("day").usedTokens).toBe(130);
  expect(other.reserveUsage(300,"day",1000)).toBe(true);
});
