import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { hashText, scopeKey, memoryDay } from "./codec";
export { hashText, scopeKey } from "./codec";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { MemoryConclusion, MemoryPage, MemoryQuery, MemoryRecord, MemorySource, MemorySummary, MemoryWrite } from "../../../shared/memory";
import { MEMORY_KINDS } from "../../../shared/memory";
import { evaluateLifecycle, memoryTokens, type LifecycleSnapshot } from "./policy";

export function summarize(item: MemoryRecord): MemorySummary {
  const { details: _details, legacy: _legacy, sources, ...rest } = item;
  return { ...rest, sources: sources.map(({ ref, sessionId, entryId, hash, deleted, type }) => ({ ref, sessionId, entryId, hash, deleted, type })) };
}
export interface WriteContext { projectId?: string; source: MemorySource; confirmed: boolean; pinned?: boolean; now?: number; evidenceAt?:number }
export interface MemoryAnalysisWrite { input:MemoryWrite; context:WriteContext; target?:{key:string;revision:number} }
export interface MemoryJob extends MemoryConclusion { attempts: number; retryAt: number; lease?: string; cursor?: number; error?:string }
const MEMORY_APPLICATION_ID=0x454d4d31;
export class MemoryDatabase {
  readonly db: DatabaseSync;
  private inTransaction = false;
  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    let setupTransaction=false;
    try {
    this.db.exec("PRAGMA busy_timeout=5000");
    const version = this.db.prepare("PRAGMA user_version").get() as { user_version: number };
    if (version.user_version > 1) { throw new Error("记忆数据库版本高于当前应用，请使用更新版本"); }
    let application=(this.db.prepare("PRAGMA application_id").get() as {application_id:number}).application_id;
    const populated=Boolean(this.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get());
    if(application===0 && populated)application=(this.db.prepare("PRAGMA application_id").get() as {application_id:number}).application_id;
    if((application!==0 && application!==MEMORY_APPLICATION_ID) || (application===0 && populated))throw new Error("该路径已有未识别的数据库，原件未修改，请先确认来源");
    // WAL changes may return SQLITE_BUSY immediately when two fresh connections switch modes.
    // Retry only that initialization step, off the UI thread; normal writes use SQLite transactions.
    for(let attempt=0;;attempt++) {
      try {this.db.exec("PRAGMA journal_mode=WAL");break;}
      catch(error) {
        const code=(error as {errcode?:number}).errcode;
        if((code!==5 && code!==6)||attempt>=7)throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20*(attempt+1));
      }
    }
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON; BEGIN IMMEDIATE");setupTransaction=true;
    if((this.db.prepare("PRAGMA user_version").get() as {user_version:number}).user_version>1)throw new Error("记忆数据库版本已更新，当前应用停止写入");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory (key TEXT PRIMARY KEY, id TEXT NOT NULL, scope TEXT NOT NULL,
        project_id TEXT, kind TEXT NOT NULL, state TEXT NOT NULL, lifecycle TEXT NOT NULL,
        occurred_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, fingerprint TEXT NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS memory_scope ON memory(scope,project_id,state,lifecycle,occurred_at);
      CREATE INDEX IF NOT EXISTS memory_fingerprint ON memory(scope,project_id,fingerprint);
      CREATE TABLE IF NOT EXISTS revisions (key TEXT NOT NULL, revision INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY(key,revision));
      CREATE TABLE IF NOT EXISTS blocked_sources (ref TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (ref TEXT PRIMARY KEY, json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', retry_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS usage (day TEXT PRIMARY KEY, tokens INTEGER NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS current_search USING fts5(key UNINDEXED,tokens);
      CREATE VIRTUAL TABLE IF NOT EXISTS history_search USING fts5(key UNINDEXED,revision UNINDEXED,tokens);
      PRAGMA application_id=1162693937;
      PRAGMA user_version=1;
    `);
    this.db.exec("COMMIT");setupTransaction=false;
    } catch(error) {
      if(setupTransaction)this.db.exec("ROLLBACK");
      this.db.close();throw error;
    }
  }
  close(): void { this.db.close(); }
  transaction<T>(fn: () => T): T {
    if (this.inTransaction) return fn();
    this.db.exec("BEGIN IMMEDIATE"); this.inTransaction = true;
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
    finally { this.inTransaction = false; }
  }
  private parse(row: unknown): MemoryRecord | undefined {
    return row ? JSON.parse((row as { json: string }).json) as MemoryRecord : undefined;
  }
  metadata<T>(key: string): T | undefined {
    const row = this.db.prepare("SELECT json FROM metadata WHERE key=?").get(key) as { json: string } | undefined;
    return row ? JSON.parse(row.json) as T : undefined;
  }
  setMetadata(key: string, value: unknown): void {
    this.db.prepare("INSERT INTO metadata(key,json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json").run(key, JSON.stringify(value));
  }
  private fingerprint(item: Pick<MemoryRecord, "kind" | "text" | "details" | "occurredAt" | "timeBasis" | "sources">): string {
    return hashText(JSON.stringify([item.kind, item.text.trim(), item.details ?? "", ["activity", "decision"].includes(item.kind) ? (item.timeBasis === "recorded" ? (item.sources[0]?.anchorRef ?? item.sources[0]?.ref) : item.occurredAt) : null]));
  }
  private persist(item: MemoryRecord, keepRevision = true): void {
    this.db.prepare(`INSERT INTO memory(key,id,scope,project_id,kind,state,lifecycle,occurred_at,updated_at,fingerprint,json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET state=excluded.state,lifecycle=excluded.lifecycle,
      kind=excluded.kind,occurred_at=excluded.occurred_at,updated_at=excluded.updated_at,fingerprint=excluded.fingerprint,json=excluded.json`).run(
      item.key,item.id,item.scope,item.projectId ?? null,item.kind,item.state,item.lifecycle,item.occurredAt,item.updatedAt,this.fingerprint(item),JSON.stringify(item));
    if (keepRevision) this.db.prepare("INSERT OR IGNORE INTO revisions VALUES (?,?,?)").run(item.key,item.revision,JSON.stringify(item));
    this.db.prepare("DELETE FROM current_search WHERE key=?").run(item.key);
    this.db.prepare("DELETE FROM history_search WHERE key=? AND revision=?").run(item.key,item.revision);
    this.db.prepare("INSERT INTO history_search(key,revision,tokens) VALUES (?,?,?)").run(item.key,item.revision,memoryTokens(`${item.text} ${(item.tags ?? []).join(" ")} ${item.details ?? ""}`).join(" "));
    if (item.state === "confirmed" && item.lifecycle !== "retired") {
      const indexed = `${item.text} ${item.tags.join(" ")} ${item.lifecycle === "active" ? item.details ?? "" : ""}`;
      this.db.prepare("INSERT INTO current_search(key,tokens) VALUES (?,?)").run(item.key,memoryTokens(indexed).join(" "));
    }
    this.setMetadata("generation", (this.metadata<number>("generation") ?? 0) + 1);
  }
  private validate(input: MemoryWrite): void {
    if (!MEMORY_KINDS.includes(input.kind) || typeof input.text !== "string" || !input.text.trim() || input.text.length > 6_000) throw new Error("记忆短正文不能为空且不能超过6000字符；长内容请放详情，不会自动截断");
    if (input.details !== undefined && (typeof input.details !== "string" || input.details.length > 200_000)) throw new Error("记忆详情不能超过200000字符，请拆分保存");
    if (input.tags && (!Array.isArray(input.tags) || input.tags.length > 20 || input.tags.some(t => typeof t !== "string" || t.length > 100))) throw new Error("记忆标签格式无效");
    for (const t of [input.occurredAt, input.expiresAt]) if (t !== undefined && (!Number.isFinite(t) || !Number.isFinite(new Date(t).getTime()))) throw new Error("记忆时间无效");
  }
  save(input: MemoryWrite, context: WriteContext): { item: MemoryRecord; existing: boolean } {
    this.validate(input);
    return this.transaction(() => {
      if (this.isBlocked(context.source.ref) || (context.source.anchorRef && this.isBlocked(context.source.anchorRef))) throw new Error("该旧来源已被遗忘或删除，不再提取");
      const now = context.now ?? Date.now();
      const candidate: MemoryRecord = { key: "", id: randomUUID(), scope: context.projectId ? "project" : "global", projectId: context.projectId,
        kind: input.kind, text: input.text.trim(), details: input.details, tags: input.tags ?? [],
        state: context.confirmed ? "confirmed" : "candidate", lifecycle: "active", revision: 1,
        createdAt: now, updatedAt: now, occurredAt: input.occurredAt ?? context.evidenceAt ?? now, timeBasis: input.occurredAt === undefined ? "recorded" : "occurred", substantiveAt: context.evidenceAt ?? now,
        expiresAt: input.expiresAt, importance: input.importance === "high" ? "high" : "normal", pinned: context.pinned === true,
        sources: [context.source] };
      const prior = this.parse(this.db.prepare("SELECT json FROM memory WHERE scope=? AND project_id IS ? AND fingerprint=? LIMIT 1").get(candidate.scope,candidate.projectId ?? null,this.fingerprint(candidate)));
      if (prior) {
        const newSource = !prior.sources.some(source => source.ref === context.source.ref);
        const anchor=context.source.anchorRef ?? context.source.ref;
        const newEvidence=!prior.sources.some(source=>(source.anchorRef ?? source.ref)===anchor);
        if (prior.state === "rejected" && !(context.confirmed && newEvidence)) return {item:prior,existing:true};
        if (newSource) prior.sources.push(context.source);
        if (context.confirmed && newEvidence && prior.state !== "confirmed") {
          prior.state="confirmed"; prior.lifecycle="active"; prior.lowSince=undefined; prior.invalidatedAt=undefined; prior.revision++; prior.substantiveAt=Math.max(prior.substantiveAt,context.evidenceAt ?? now); prior.updatedAt=now;
          this.persist(prior);
        } else if (newSource) {
          if(context.confirmed && context.source.role==="user" && newEvidence)prior.substantiveAt=Math.max(prior.substantiveAt,context.evidenceAt ?? now);
          if(context.pinned)prior.pinned=true;
          this.persist(prior,false);
        }
        return {item:prior,existing:true};
      }

      candidate.key = `${scopeKey(candidate.projectId)}/${candidate.id}`;
      this.persist(candidate);
      return { item: candidate, existing: false };
    });
  }
  get(ref: string, projectId?: string): MemoryRecord | undefined {
    const rows = this.db.prepare("SELECT json FROM memory WHERE (key=? OR id=?) AND (project_id IS NULL OR project_id=?)").all(ref,ref,projectId ?? null);
    if (rows.length > 1) throw new Error("记忆ID存在歧义，请使用完整key");
    return this.parse(rows[0]);
  }
  revisions(ref: string, projectId?: string): MemoryRecord[] {
    const item = this.get(ref,projectId);
    return item ? this.db.prepare("SELECT json FROM revisions WHERE key=? ORDER BY revision DESC").all(item.key).map(r => this.parse(r)!) : [];
  }
  getRevision(ref:string,revision:number,projectId?:string):MemoryRecord|undefined {
    const item=this.get(ref,projectId);
    return item?this.parse(this.db.prepare("SELECT json FROM revisions WHERE key=? AND revision=?").get(item.key,revision)):undefined;
  }
  update(ref: string, projectId: string | undefined, revision: number, patch: Partial<MemoryWrite> & Pick<Partial<MemoryRecord>, "state" | "lifecycle" | "pinned" | "reason" | "sources">, now = Date.now(), evidenceAt=now): MemoryRecord {
    return this.transaction(() => {
      const item = this.get(ref,projectId);
      if (!item) throw new Error("记忆不存在或不属于当前范围");
      if (item.revision !== revision) throw new Error("记忆已更新，请重新读取后再修改");
      const incoming=patch.sources ?? [];
      const newManual=incoming.some(source=>source.type==="manual" && !item.sources.some(old=>old.ref===source.ref));
      const editsKnowledge=["text","details","kind","tags","occurredAt","expiresAt","importance"].some(key=>Object.hasOwn(patch,key)) || patch.state==="confirmed";
      if(!newManual && editsKnowledge && incoming.some(source=>this.isBlocked(source.ref) || (source.anchorRef && this.isBlocked(source.anchorRef))))throw new Error("该旧来源已被遗忘，不可用于改写其他记忆；需要新的明确依据");
      const definedPatch=Object.fromEntries(Object.entries(patch).filter(([,value])=>value!==undefined));
      const next = { ...item, ...definedPatch, key: item.key, id: item.id, projectId: item.projectId, scope: item.scope,
        revision: item.revision + 1, updatedAt: now };
      this.validate(next);
      if (patch.text !== undefined || patch.details !== undefined || patch.state === "confirmed" || patch.lifecycle === "active" || patch.pinned === true) {
        next.substantiveAt = evidenceAt; next.lowSince = undefined;
        if(patch.state === "confirmed")next.invalidatedAt=undefined;
      }
      if (patch.lifecycle === "archived") next.archivedAt = now;
      this.persist(next); return next;
    });
  }
  query(query: MemoryQuery = {}): MemoryPage {
    const clauses: string[] = []; const args: Array<string | number | null> = [];
    const recent = query.scope === "recent";
    if (recent) clauses.push("m.kind IN ('activity','decision')");
    else if (query.scope === "project") { clauses.push("m.project_id=?"); args.push(query.projectId ?? "__none__"); }
    else if (query.scope === "global") clauses.push("m.project_id IS NULL");
    else { clauses.push("(m.project_id IS NULL OR m.project_id=?)"); args.push(query.projectId ?? null); }
    if (query.history && query.state===undefined) clauses.push("(m.state='confirmed' OR json_extract(m.json,'$.invalidatedAt') IS NOT NULL)");
    else if (query.state !== "all") { clauses.push("m.state=?"); args.push(query.state ?? "confirmed"); }
    if (query.lifecycle && query.lifecycle !== "all") { clauses.push("m.lifecycle=?"); args.push(query.lifecycle); }
    else if (!query.history) clauses.push("m.lifecycle!='retired'");
    if (!query.history) { clauses.push("(json_extract(m.json,'$.expiresAt') IS NULL OR json_extract(m.json,'$.expiresAt')>?)"); args.push(Date.now()); }
    if (query.kind) { clauses.push("m.kind=?"); args.push(query.kind); }
    if (query.from !== undefined) { clauses.push("m.occurred_at>=?"); args.push(query.from); }
    if (query.to !== undefined) { clauses.push("m.occurred_at<=?"); args.push(query.to); }
    const tokens = memoryTokens(query.query ?? "", 32);
    const terms = tokens.some(t=>[...t].length>1) ? tokens.filter(t=>[...t].length>1).slice(0,16) : tokens;
    let join = "", ranking = "";
    if (terms.length) {
      const index = query.history || query.state === "candidate" || query.state === "all" ? "history_search" : "current_search";
      if(index === "history_search") clauses.push("m.key IN (SELECT key FROM history_search WHERE tokens MATCH ?)");
      else {join=` JOIN ${index} ON ${index}.key=m.key`;ranking=`bm25(${index}),`;clauses.push(`${index}.tokens MATCH ?`);}
      args.push(terms.map(t => `"${t.replaceAll('"','""')}"`).join(" OR "));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = (this.db.prepare(`SELECT count(*) AS n FROM memory m ${join} ${where}`).get(...args) as { n: number }).n;
    const limit = Math.max(1,Math.min(50,query.limit ?? 20)), offset = Math.max(0,query.offset ?? 0);
    const rows = this.db.prepare(`SELECT m.json FROM memory m ${join} ${where} ORDER BY ${ranking} ${recent ? "" : "(m.lifecycle='active') DESC,"}m.occurred_at DESC,m.key LIMIT ? OFFSET ?`).all(...args,limit,offset);
    const items=rows.map(row=>{
      const item=summarize(this.parse(row)!);
      if(query.history && terms.length) {
        const match=this.db.prepare("SELECT revision FROM history_search WHERE key=? AND tokens MATCH ? ORDER BY CAST(revision AS INTEGER) DESC LIMIT 1").get(item.key,terms.map(t=>`"${t.replaceAll('"','""')}"`).join(" OR ")) as {revision:number}|undefined;
        if(match && Number(match.revision)!==item.revision)item.matchedRevision=Number(match.revision);
      }
      return item;
    });
    return { items, total, ...(offset + items.length < total ? { next: offset + items.length } : {}) };
  }
  forget(ref: string, projectId?: string): { forgotten: boolean } {
    return this.transaction(() => {
      const item = this.get(ref,projectId);
      if (!item) return { forgotten: false };
      const sources=[...item.sources,...this.revisions(item.key,item.projectId).flatMap(revision=>revision.sources)];
      for (const source of sources) {
        for(const ref of [source.ref,source.anchorRef].filter((ref):ref is string=>Boolean(ref))) {
          this.db.prepare("INSERT OR IGNORE INTO blocked_sources(ref) VALUES (?)").run(ref);
          this.db.prepare("DELETE FROM jobs WHERE ref=? OR json_extract(json,'$.anchorRef')=?").run(ref,ref);
        }
      }
      this.db.prepare("DELETE FROM memory WHERE key=?").run(item.key);
      this.db.prepare("DELETE FROM revisions WHERE key=?").run(item.key);
      this.db.prepare("DELETE FROM current_search WHERE key=?").run(item.key);
      this.db.prepare("DELETE FROM history_search WHERE key=?").run(item.key);
      this.setMetadata("generation", (this.metadata<number>("generation") ?? 0) + 1);
      return { forgotten: true };
    });
  }
  isBlocked(ref: string): boolean { return Boolean(this.db.prepare("SELECT ref FROM blocked_sources WHERE ref=?").get(ref)); }
  detachSession(sessionId: string, clear: boolean): void {
    this.transaction(() => {
      const rows = this.db.prepare("SELECT json FROM memory WHERE EXISTS (SELECT 1 FROM json_each(json_extract(memory.json,'$.sources')) s WHERE json_extract(s.value,'$.sessionId')=?)").all(sessionId);
      for (const row of rows) {
        const item = this.parse(row)!;
        if (clear || item.state !== "confirmed") this.forget(item.key,item.projectId);
        else {
          item.sources = item.sources.map(s => s.sessionId === sessionId ? { ...s, deleted: true } : s);
          item.revision++; item.updatedAt = Date.now(); this.persist(item);
          // Historical source indicators must not pretend the original chat is still accessible.
          for (const old of this.revisions(item.key,item.projectId)) {
            old.sources = old.sources.map(s => s.sessionId === sessionId ? { ...s, deleted: true } : s);
            this.db.prepare("UPDATE revisions SET json=? WHERE key=? AND revision=?").run(JSON.stringify(old),old.key,old.revision);
          }
        }
      }
      const jobs = this.db.prepare("SELECT ref,json FROM jobs").all() as Array<{ref:string;json:string}>;
      for (const job of jobs) if ((JSON.parse(job.json) as MemoryJob).sessionId === sessionId) {
        this.db.prepare("INSERT OR IGNORE INTO blocked_sources VALUES (?)").run(job.ref);
        this.db.prepare("DELETE FROM jobs WHERE ref=?").run(job.ref);
      }
    });
  }
  invalidateSession(sessionId: string, valid: Array<{entryId:string;hash:string}>): number {
    const byId = new Map(valid.map(item=>[item.entryId,item.hash]));
    return this.transaction(()=>{
      const rows = this.db.prepare("SELECT json FROM memory WHERE state='confirmed' AND EXISTS (SELECT 1 FROM json_each(json_extract(memory.json,'$.sources')) s WHERE json_extract(s.value,'$.sessionId')=?)").all(sessionId);
      let count=0;
      for (const row of rows) {
        const item=this.parse(row)!;
        const invalid=item.sources.some(source=>source.sessionId===sessionId && source.type==='session' && source.hash && (!source.entryId || byId.get(source.entryId)!==source.hash));
        if (invalid && !item.sources.some(source=>source.type==='manual')) {
          item.state='candidate'; item.invalidatedAt=Date.now(); item.reason='原会话来源已撤回或修订，待复核'; item.revision++; item.updatedAt=Date.now(); this.persist(item); count++;
        }
      }
      const jobs=this.db.prepare("SELECT json FROM jobs WHERE state IN ('pending','running') AND json_extract(json,'$.sessionId')=?").all(sessionId) as Array<{json:string}>;
      for(const row of jobs){const job=JSON.parse(row.json) as MemoryJob;if(byId.get(job.entryId)!==job.hash)this.db.prepare("UPDATE jobs SET state='skipped',lease_until=0 WHERE ref=?").run(job.ref);}
      return count;
    });
  }
  lookupSummaries(keys:string[],projectId?:string):MemorySummary[] {
    return keys.slice(0,100).map(key=>this.get(key,projectId)).filter((item):item is MemoryRecord=>Boolean(item)).map(summarize);
  }
  evaluate(now = Date.now()): {count:number;projectIds:string[]} {
    return this.transaction(() => {
      const cursor=this.metadata<string>("evaluationCursor") ?? "";
      const rows=this.db.prepare(`SELECT key,state,lifecycle,json_extract(json,'$.pinned') pinned,
        json_extract(json,'$.createdAt') createdAt,json_extract(json,'$.substantiveAt') substantiveAt,
        json_extract(json,'$.importance') importance,json_extract(json,'$.expiresAt') expiresAt,
        json_extract(json,'$.lowSince') lowSince,json_extract(json,'$.archivedAt') archivedAt,
        json_extract(json,'$.reason') reason FROM memory WHERE key>? AND lifecycle!='retired' ORDER BY key LIMIT 200`).all(cursor) as unknown as Array<LifecycleSnapshot>;
      let count=0; const projectIds=new Set<string>();
      for (const row of rows) {
        const snapshot={...row,pinned:Boolean(row.pinned),expiresAt:row.expiresAt ?? undefined,lowSince:row.lowSince ?? undefined,archivedAt:row.archivedAt ?? undefined};
        const next=evaluateLifecycle(snapshot,now); if(!next) continue;
        const item=this.parse(this.db.prepare("SELECT json FROM memory WHERE key=?").get(row.key))!;
        const changed=item.lifecycle!==next.lifecycle;
        item.lifecycle=next.lifecycle; item.lowSince=next.lowSince; item.archivedAt=next.archivedAt; item.reason=next.reason;
        if(changed) {item.updatedAt=now;item.revision++;this.persist(item);count++;if(item.projectId)projectIds.add(item.projectId);}
        else this.db.prepare("UPDATE memory SET json=? WHERE key=?").run(JSON.stringify(item),item.key);
      }
      this.setMetadata("evaluationCursor",rows.length===200?rows.at(-1)!.key:"");
      return {count,projectIds:[...projectIds]};
    });
  }
  projectEventCount(projectId:string):number {
    return (this.db.prepare("SELECT count(*) n FROM memory WHERE project_id=? AND state='confirmed' AND kind IN ('activity','decision','lesson')").get(projectId) as {n:number}).n;
  }
  enqueue(conclusion: MemoryConclusion): void {
    if (this.isBlocked(conclusion.ref) || (conclusion.anchorRef && this.isBlocked(conclusion.anchorRef))) return;
    const existing = this.db.prepare("SELECT json,state FROM jobs WHERE ref=?").get(conclusion.ref) as {json:string;state:string} | undefined;
    if (existing && (JSON.parse(existing.json) as MemoryJob).hash === conclusion.hash) return;
    this.db.prepare("INSERT INTO jobs(ref,json) VALUES (?,?) ON CONFLICT(ref) DO UPDATE SET json=excluded.json,state='pending',retry_at=0,lease_until=0").run(conclusion.ref,JSON.stringify({...conclusion,attempts:0,retryAt:0}));
  }
  claim(now = Date.now(), projectId?: string | null): MemoryJob | undefined {
    return this.transaction(() => {
      const filter=projectId===undefined?"":" AND json_extract(json,'$.projectId') IS ?";
      const args:Array<number|string|null>=[now,now,...(projectId===undefined?[]:[projectId])];
      const row = this.db.prepare(`SELECT json FROM jobs WHERE (state='pending' OR (state='running' AND lease_until<?)) AND retry_at<=?${filter} ORDER BY retry_at,ref LIMIT 1`).get(...args) as {json:string}|undefined;
      if (!row) return;
      const job = JSON.parse(row.json) as MemoryJob;
      job.lease = randomUUID();
      this.db.prepare("UPDATE jobs SET state='running',json=?,lease_until=? WHERE ref=?").run(JSON.stringify(job),now+300_000,job.ref);
      return job;
    });
  }
  finishBatch(jobs:Array<{job:MemoryJob;nextCursor?:number}>,items:MemoryAnalysisWrite[],tokens:number,day:string):string[] {
    return this.transaction(()=>{
      this.addUsage(tokens,day);
      const valid=new Map<string,{job:MemoryJob;nextCursor?:number}>();
      for(const entry of jobs) {
        const job=entry.job,current=this.db.prepare("SELECT json,state FROM jobs WHERE ref=?").get(job.ref) as {json:string;state:string}|undefined;
        if(current?.state==='running' && (JSON.parse(current.json) as MemoryJob).lease===job.lease && !this.isBlocked(job.ref) && !(job.anchorRef && this.isBlocked(job.anchorRef))) valid.set(job.ref,entry);
      }
      for(const item of items) if(valid.has(item.context.source.ref)) {
        const target=item.target ? this.get(item.target.key,item.context.projectId) : undefined;
        if(item.target && target && target.projectId===item.context.projectId && target.kind===item.input.kind && item.context.confirmed
          && item.target.revision===target.revision && (item.context.evidenceAt ?? Date.now())>=target.substantiveAt) {
          this.update(target.key,item.context.projectId,target.revision,{...item.input,state:"confirmed",sources:[item.context.source],pinned:target.pinned || item.context.pinned===true},Date.now(),item.context.evidenceAt);
        } else this.save(item.input,item.target?{...item.context,confirmed:false}:item.context);
      }
      for(const {job,nextCursor} of valid.values()) {
        if(nextCursor===undefined) this.db.prepare("UPDATE jobs SET state='done',lease_until=0 WHERE ref=?").run(job.ref);
        else {job.cursor=nextCursor;job.attempts=0;this.db.prepare("UPDATE jobs SET state='pending',json=?,retry_at=?,lease_until=0 WHERE ref=?").run(JSON.stringify(job),Date.now()+60_000,job.ref);}
      }
      return [...valid.keys()];
    });
  }
  finishJob(job: MemoryJob, items: Array<{ input: MemoryWrite; context: WriteContext }>, tokens: number, day: string): boolean {
    return this.finishBatch([{job}],items,tokens,day).includes(job.ref);
  }
  skipJob(job:MemoryJob):void {
    const current=this.db.prepare("SELECT json,state FROM jobs WHERE ref=?").get(job.ref) as {json:string;state:string}|undefined;
    if(current?.state==="running" && (JSON.parse(current.json) as MemoryJob).lease===job.lease)this.db.prepare("UPDATE jobs SET state='skipped',lease_until=0 WHERE ref=?").run(job.ref);
  }
  retryFailed():number {
    return this.transaction(()=>{
      const rows=this.db.prepare("SELECT json FROM jobs WHERE state='failed' ORDER BY retry_at LIMIT 20").all() as Array<{json:string}>;
      let count=0;
      for(const row of rows){const job=JSON.parse(row.json) as MemoryJob;if(this.isBlocked(job.ref)||(job.anchorRef&&this.isBlocked(job.anchorRef)))continue;
        job.attempts=0;this.db.prepare("UPDATE jobs SET state='pending',json=?,retry_at=0,lease_until=0 WHERE ref=?").run(JSON.stringify(job),job.ref);count++;}
      return count;
    });
  }
  releaseJob(job: MemoryJob, tokens: number, day: string): void {
    this.transaction(()=>{
      this.addUsage(tokens,day);
      const current=this.db.prepare("SELECT json,state FROM jobs WHERE ref=?").get(job.ref) as {json:string;state:string}|undefined;
      if(current?.state==='running' && (JSON.parse(current.json) as MemoryJob).lease===job.lease) this.db.prepare("UPDATE jobs SET state='pending',retry_at=?,lease_until=0 WHERE ref=?").run(Date.now()+60_000,job.ref);
    });
  }
  failJob(job: MemoryJob, tokens: number, day: string, retry = true, reason?:string): void {
    this.transaction(() => {
      this.addUsage(tokens,day);
      const current = this.db.prepare("SELECT json,state FROM jobs WHERE ref=?").get(job.ref) as {json:string;state:string} | undefined;
      if (current?.state !== "running" || (JSON.parse(current.json) as MemoryJob).lease !== job.lease) return;
      job.attempts++;if(reason)job.error=reason.slice(0,2000);
      this.db.prepare("UPDATE jobs SET state=?,json=?,retry_at=?,lease_until=0 WHERE ref=?").run(retry && job.attempts < 3 ? "pending" : "failed",JSON.stringify(job),Date.now()+job.attempts*300_000,job.ref);
    });
  }
  reserveUsage(tokens:number,day:string,limit:number):boolean {
    return this.transaction(()=>{
      const current=(this.db.prepare("SELECT tokens FROM usage WHERE day=?").get(day) as {tokens:number}|undefined)?.tokens ?? 0;
      const reserve=Math.max(0,Math.round(tokens));
      if(current+reserve>limit)return false;
      this.addUsage(reserve,day);return true;
    });
  }
  addUsage(tokens: number, day: string): void {
    if(!Number.isFinite(tokens))throw new Error("计量调整无效");
    const adjustment=Math.round(tokens);
    this.db.prepare("INSERT INTO usage(day,tokens) VALUES (?,max(0,?)) ON CONFLICT(day) DO UPDATE SET tokens=max(0,tokens+?)").run(day,adjustment,adjustment);
  }
  status(day = memoryDay()): {count:number;pending:number;failed:number;usedTokens:number;lastError?:string} {
    const count = (this.db.prepare("SELECT count(*) n FROM memory").get() as {n:number}).n;
    const pending = (this.db.prepare("SELECT count(*) n FROM jobs WHERE state IN ('pending','running')").get() as {n:number}).n;
    const usedTokens = (this.db.prepare("SELECT tokens FROM usage WHERE day=?").get(day) as {tokens:number} | undefined)?.tokens ?? 0;
    const failed=(this.db.prepare("SELECT count(*) n FROM jobs WHERE state='failed'").get() as {n:number}).n;
    const last=this.db.prepare("SELECT json_extract(json,'$.error') error FROM jobs WHERE state='failed' ORDER BY retry_at DESC LIMIT 1").get() as {error?:string}|undefined;
    return { count,pending,failed,usedTokens,lastError:last?.error };
  }
  importLegacy(item: MemoryRecord): "imported" | "unchanged" | "conflict" {
    return this.transaction(() => {
      if (item.sources.some(s => this.isBlocked(s.ref) || (s.anchorRef && this.isBlocked(s.anchorRef)))) return "unchanged";
      const old = this.parse(this.db.prepare("SELECT json FROM memory WHERE key=?").get(item.key));
      if (old && old.legacy?.contentHash === item.legacy?.contentHash) return "unchanged";
      if (old) {
        item.id = `${item.id}~${String(item.legacy?.contentHash).slice(0,12)}`;
        item.key = `${scopeKey(item.projectId)}/${item.id}`;
        if (this.db.prepare("SELECT key FROM memory WHERE key=?").get(item.key)) return "unchanged";
        item.reason = "旧资料出现不同正文，保留为冲突副本，未覆盖现有记忆";
      }
      this.persist(item); return old ? "conflict" : "imported";
    });
  }
  projectHistory(projectId: string): MemoryRecord[] {
    return this.db.prepare("SELECT json FROM memory WHERE project_id=? AND (state='confirmed' OR json_extract(json,'$.invalidatedAt') IS NOT NULL) AND kind IN ('activity','decision','lesson') ORDER BY occurred_at,key").all(projectId).map(r => this.parse(r)!);
  }
}
