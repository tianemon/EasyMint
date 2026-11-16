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

it("restores a repeated explicitly confirmed preference and avoids empty editor revisions",()=>{
  const {db}=setup();
  const first=db.save({kind:"preference",text:"回答简洁"},{source:{type:"session",ref:"u:1",role:"user"},confirmed:true}).item;
  const unchanged=db.update(first.key,undefined,1,{text:first.text,sources:first.sources});
  expect(unchanged.revision).toBe(1);expect(db.revisions(first.key)).toHaveLength(1);
  db.update(first.key,undefined,1,{lifecycle:"retired"});
  const restored=db.save({kind:"preference",text:"回答简洁"},{source:{type:"session",ref:"u:2",role:"user"},confirmed:true}).item;
  expect(restored.key).toBe(first.key);expect(restored.lifecycle).toBe("active");
});
it("merges only compatible facts atomically, preserves aliases, and forgets all merged revisions",()=>{
  const {db}=setup();const first=save(db,"项目控件沿用既有风格"),second=save(db,"所有项目控件保持一致");
  const merged=db.merge([{key:first.key,revision:1},{key:second.key,revision:1}],"p",{kind:"decision",text:"本项目控件沿用既有风格并保持一致"});
  expect(db.resolve(second.key,"p")?.key).toBe(merged.key);
  expect(db.revisions(second.key,"p")).toHaveLength(2);
  expect(db.query({projectId:"p"}).items.map(i=>i.key)).toEqual([merged.key]);
  expect(()=>db.merge([{key:merged.key,revision:1},{key:second.key,revision:1}],"p",{kind:"decision",text:"不应覆盖"})).toThrow("变化");
  db.forget(second.key,"p");
  expect(db.get(first.key,"p")).toBeUndefined();expect(db.revisions(second.key,"p")).toHaveLength(0);
});
it("keeps independent activities in history and searches their condensed details",()=>{
  const {db}=setup();
  const a=db.save({kind:"activity",text:"通过构建",details:"条件 unique-history-condition"},{projectId:"p",source:{ref:"event:1",type:"session"},confirmed:true}).item;
  const b=db.save({kind:"activity",text:"通过构建"},{projectId:"p",source:{ref:"event:2",type:"session"},confirmed:true}).item;
  expect(a.key).not.toBe(b.key);expect(db.query({projectId:"p"}).total).toBe(0);
  expect(db.query({projectId:"p",scope:"recent"}).total).toBe(2);
  expect(db.query({projectId:"p",view:"history",history:true,query:"unique-history-condition"}).total).toBe(1);
  expect(()=>db.merge([{key:a.key,revision:1},{key:b.key,revision:1}],"p",{kind:"activity",text:"通过构建"})).toThrow("独立事件");
});