import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import {DatabaseSync} from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { MemoryDatabase } from "./database";
import { assertCondensed } from "./policy";

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
    db.update(p.key,"p",p.revision,{lifecycle:"archived"});
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
    expect(db.query({projectId:"p",history:true,confidence:"all"}).items).toHaveLength(0);
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
});
