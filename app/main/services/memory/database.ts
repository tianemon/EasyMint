import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { hashText, scopeKey, memoryDay } from "./codec";
export { hashText, scopeKey } from "./codec";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { MemoryConclusion, MemoryPage, MemoryQuery, MemoryRecord, MemorySource, MemorySummary, MemoryWrite } from "../../../shared/memory";
import { MEMORY_KINDS, MEMORY_TEXT_LIMIT, MEMORY_DETAILS_LIMIT, MEMORY_SUMMARY_LIMIT } from "../../../shared/memory";
import { memoryTokens } from "./policy";

export function summarize(item: MemoryRecord): MemorySummary {
  const { details: _details, legacy: _legacy, pending, sources, ...rest } = item;
  return { ...rest,pendingAt:pending?.at, sources: sources.map(({ ref, sessionId, entryId, hash, deleted, type }) => ({ ref, sessionId, entryId, hash, deleted, type })) };
}
const recordSources=(item:MemoryRecord)=>[...item.sources,...(item.pending?.patch.sources ?? [])];
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
    if (version.user_version > 2) { throw new Error("记忆数据库版本高于当前应用，请使用更新版本"); }
    let application=(this.db.prepare("PRAGMA application_id").get() as {application_id:number}).application_id;
    const populated=Boolean(this.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get());
    if(application===0 && populated)application=(this.db.prepare("PRAGMA application_id").get() as {application_id:number}).application_id;
    if((application!==0 && application!==MEMORY_APPLICATION_ID) || (application===0 && populated))throw new Error("该路径已有未识别的数据库，原件未修改，请先确认来源");
    if(version.user_version===1 && application===MEMORY_APPLICATION_ID && file!==":memory:") {
      const backup=path.join(path.dirname(file),"backups");mkdirSync(backup,{recursive:true,mode:0o700});
      this.db.prepare("VACUUM INTO ?").run(path.join(backup,`memory-v1-${Date.now()}-${randomUUID()}.sqlite`));
    }
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
    if((this.db.prepare("PRAGMA user_version").get() as {user_version:number}).user_version>2)throw new Error("记忆数据库版本已更新，当前应用停止写入");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory (key TEXT PRIMARY KEY, id TEXT NOT NULL, scope TEXT NOT NULL,
        project_id TEXT, kind TEXT NOT NULL, state TEXT NOT NULL, lifecycle TEXT NOT NULL,
        occurred_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, fingerprint TEXT NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS memory_scope ON memory(scope,project_id,state,lifecycle,occurred_at);
      CREATE INDEX IF NOT EXISTS memory_due ON memory(json_extract(json,'$.pending.at')) WHERE json_extract(json,'$.pending.at') IS NOT NULL;
      CREATE INDEX IF NOT EXISTS memory_fingerprint ON memory(scope,project_id,fingerprint);
      CREATE TABLE IF NOT EXISTS revisions (key TEXT NOT NULL, revision INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY(key,revision));
      CREATE TABLE IF NOT EXISTS blocked_sources (ref TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (ref TEXT PRIMARY KEY, json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', retry_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS usage (day TEXT PRIMARY KEY, tokens INTEGER NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS current_search USING fts5(key UNINDEXED,tokens);
      CREATE VIRTUAL TABLE IF NOT EXISTS history_search USING fts5(key UNINDEXED,revision UNINDEXED,tokens);
      PRAGMA application_id=1162693937;
      PRAGMA user_version=2;
    `);
    if(version.user_version<2) {
      for(const row of this.db.prepare("SELECT json FROM memory").all()) {
        const item=this.parse(row)!;
        if(item.kind==="activity" && item.lifecycle==="active") {item.lifecycle="archived";item.reason="已发生事件，按时间保存";}
        // Preserve ambiguous legacy manual/automatic decisions rather than resurrecting them.
        this.persist(item,false);
      }
    }
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
    if (item.state === "confirmed" && !item.mergedInto) {
      const indexed = `${item.text} ${item.tags.join(" ")} ${item.details ?? ""}`;
      this.db.prepare("INSERT INTO current_search(key,tokens) VALUES (?,?)").run(item.key,memoryTokens(indexed).join(" "));
    }
    this.setMetadata("generation", (this.metadata<number>("generation") ?? 0) + 1);
  }
  private validate(input: MemoryWrite): void {
    if (!MEMORY_KINDS.includes(input.kind) || typeof input.text !== "string" || !input.text.trim() || input.text.length > MEMORY_TEXT_LIMIT) throw new Error("记忆需提炼为600字符以内的结论；原文请保留来源定位");
    if (input.details !== undefined && (typeof input.details !== "string" || input.details.length > MEMORY_DETAILS_LIMIT)) throw new Error("必要详情限2000字符；不要拆条复制原文，请提炼并保留资料定位");
    if (input.tags && (!Array.isArray(input.tags) || input.tags.length > 20 || input.tags.some(t => typeof t !== "string" || t.length > 100))) throw new Error("记忆标签格式无效");
    if(input.summary!==undefined && (typeof input.summary!=="string" || input.summary.length>MEMORY_SUMMARY_LIMIT))throw new Error("摘要入口限160字符，请概括主题，不放设计细节");
    if(/```|(?:^|\n)\s*(?:Traceback|at \w+\s*\(|diff --git)/u.test(`${input.text}\n${input.details ?? ""}`))throw new Error("记忆只保存凝练结论，不保存代码或日志原文");
    for (const t of [input.occurredAt, input.expiresAt,input.effectiveAt]) if (t != null && (!Number.isFinite(t) || !Number.isFinite(new Date(t).getTime()))) throw new Error("记忆时间无效");
  }
  save(input: MemoryWrite, context: WriteContext): { item: MemoryRecord; existing: boolean } {
    this.validate(input);
    return this.transaction(() => {
      if (this.isBlocked(context.source.ref) || (context.source.anchorRef && this.isBlocked(context.source.anchorRef))) throw new Error("该旧来源已被遗忘或删除，不再提取");
      const now = context.now ?? Date.now();
      const candidate: MemoryRecord = { key: "", id: randomUUID(), scope: context.projectId ? "project" : "global", projectId: context.projectId,
        kind: input.kind, text: input.text.trim(), details: input.details, tags: input.tags ?? [],
        state: context.confirmed ? "confirmed" : "candidate", lifecycle: input.kind === "activity" ? "archived" : "active", revision: 1,
        createdAt: now, updatedAt: now, occurredAt: input.occurredAt ?? context.evidenceAt ?? now, timeBasis: input.occurredAt === undefined ? "recorded" : "occurred", substantiveAt: context.evidenceAt ?? now,
        expiresAt: input.expiresAt ?? undefined, effectiveAt:input.effectiveAt ?? undefined,summary:input.summary, importance: input.importance === "high" ? "high" : "normal", pinned: context.pinned === true,
        sources: [context.source] };
      const prior = this.parse(this.db.prepare("SELECT json FROM memory WHERE scope=? AND project_id IS ? AND fingerprint=? LIMIT 1").get(candidate.scope,candidate.projectId ?? null,this.fingerprint(candidate)));
      if (prior) {
        const newSource = !prior.sources.some(source => source.ref === context.source.ref);
        const anchor=context.source.anchorRef ?? context.source.ref;
        const newEvidence=!prior.sources.some(source=>(source.anchorRef ?? source.ref)===anchor);
        if (prior.state === "rejected" && !(context.confirmed && newEvidence)) return {item:prior,existing:true};
        if (newSource) prior.sources.push(context.source);
        if (context.confirmed && newEvidence && (prior.state !== "confirmed" || (prior.lifecycle!=="active" && prior.kind!=="activity") || (prior.expiresAt!==undefined && prior.expiresAt<=now))) {
          prior.state="confirmed"; prior.lifecycle=prior.kind==="activity"?"archived":"active"; prior.lowSince=undefined; prior.invalidatedAt=undefined; prior.revision++; prior.substantiveAt=Math.max(prior.substantiveAt,context.evidenceAt ?? now); prior.updatedAt=now;
          if(input.expiresAt!==undefined)prior.expiresAt=input.expiresAt ?? undefined;
          else if(prior.expiresAt!==undefined && prior.expiresAt<=now)delete prior.expiresAt;
          if(input.summary!==undefined)prior.summary=input.summary;
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
  resolve(ref:string,projectId?:string):MemoryRecord|undefined {
    let item=this.get(ref,projectId);const visited=new Set<string>();
    while(item?.mergedInto){if(visited.has(item.key))throw new Error("记忆合并引用异常");visited.add(item.key);item=this.get(item.mergedInto,projectId);}
    return item;
  }
  merge(entries:Array<{key:string;revision:number}>,projectId:string|undefined,input:MemoryWrite):MemoryRecord {
    return this.transaction(()=>{
      if(entries.length<2 || entries.length>10 || new Set(entries.map(e=>e.key)).size!==entries.length)throw new Error("一次合并需要2至10条不同记忆");
      const items=entries.map(entry=>{const item=this.get(entry.key,projectId);if(!item || item.mergedInto || item.revision!==entry.revision)throw new Error("记忆已变化，请重新读取再合并");return item;});
      const first=items[0]!;
      if(first.kind==="activity" || items.some(item=>item.kind!==first.kind || item.projectId!==first.projectId || item.state!==first.state || item.lifecycle!==first.lifecycle || item.invalidatedAt || item.kind!==input.kind))throw new Error("仅可合并同范围、类型、确认状态和用途的重复事实；独立事件不可合并");
      const sources=[...new Map(items.flatMap(item=>item.sources).map(source=>[source.ref,source])).values()];
      const merged=this.update(first.key,projectId,first.revision,{...input,sources});
      for(const item of items.slice(1)) {
        item.mergedInto=merged.key;item.lifecycle="archived";item.reason="已合并，原依据与版本保留";item.revision++;item.updatedAt=Date.now();this.persist(item);
      }
      return merged;
    });
  }
  update(ref: string, projectId: string | undefined, revision: number, patch: Partial<MemoryWrite> & Pick<Partial<MemoryRecord>, "state" | "lifecycle" | "pinned" | "reason" | "sources"> & {cancelPending?:boolean;unmerge?:boolean}, now = Date.now(), evidenceAt=now): MemoryRecord {
    return this.transaction(() => {
      const item = this.get(ref,projectId);
      if (!item) throw new Error("记忆不存在或不属于当前范围");
      if (item.revision !== revision) throw new Error("记忆已更新，请重新读取后再修改");
      const incoming=patch.sources ?? [];
      const newManual=incoming.some(source=>source.type==="manual" && !item.sources.some(old=>old.ref===source.ref));
      const editsKnowledge=["text","details","kind","tags","occurredAt","expiresAt","importance"].some(key=>Object.hasOwn(patch,key)) || patch.state==="confirmed";
      if(!newManual && editsKnowledge && incoming.some(source=>this.isBlocked(source.ref) || (source.anchorRef && this.isBlocked(source.anchorRef))))throw new Error("该旧来源已被遗忘，不可用于改写其他记忆；需要新的明确依据");
      const definedPatch=Object.fromEntries(Object.entries(patch).filter(([key,value])=>key!=="cancelPending" && key!=="unmerge" && value!==undefined && !(value===null && ["expiresAt","effectiveAt"].includes(key) && item[key as keyof MemoryRecord]===undefined)));
      if(typeof patch.effectiveAt==="number" && patch.effectiveAt>now && ["text","details","kind"].some(key=>Object.hasOwn(definedPatch,key) && JSON.stringify(item[key as keyof MemoryRecord])!==JSON.stringify(definedPatch[key]))) {
        this.validate({...item,...definedPatch} as MemoryWrite);
        const scheduled={...item,pending:{at:patch.effectiveAt,patch:definedPatch,evidenceAt},revision:item.revision+1,updatedAt:now};
        this.persist(scheduled);return scheduled;
      }
      if(!patch.cancelPending && !patch.unmerge && Object.entries(definedPatch).every(([key,value])=>JSON.stringify(item[key as keyof MemoryRecord])===JSON.stringify(value)))return item;
      const next = { ...item, ...definedPatch, key: item.key, id: item.id, projectId: item.projectId, scope: item.scope,
        revision: item.revision + 1, updatedAt: now };
      if(patch.unmerge)delete next.mergedInto;
      if(next.expiresAt===null)delete next.expiresAt;
      if(next.effectiveAt===null)delete next.effectiveAt;
      if(patch.summary===undefined && ["text","details","kind"].some(key=>Object.hasOwn(definedPatch,key) && JSON.stringify(item[key as keyof MemoryRecord])!==JSON.stringify(definedPatch[key]))) {
        next.summary=item.summary===item.text && patch.text!==undefined && patch.text.length<=MEMORY_SUMMARY_LIMIT?patch.text:"";
      }
      if(patch.cancelPending || ["text","details","kind","lifecycle","state"].some(key=>Object.hasOwn(definedPatch,key) && JSON.stringify(item[key as keyof MemoryRecord])!==JSON.stringify(definedPatch[key]))) {
        if(next.pending)next.reason=patch.reason ?? (patch.cancelPending?"用户取消尚未生效的更正":"本次更正替代了原计划");
        delete next.pending;
      }
      if(["text","details","kind","summary","effectiveAt","expiresAt"].some(key=>Object.hasOwn(definedPatch,key) && JSON.stringify(item[key as keyof MemoryRecord])!==JSON.stringify(definedPatch[key]))) {
        this.validate({...next,text:next.text===item.text && item.text.length>MEMORY_TEXT_LIMIT?"旧条目":next.text,
          details:next.details===item.details && (item.details?.length ?? 0)>MEMORY_DETAILS_LIMIT?undefined:next.details});
      }
      if (patch.text !== undefined || patch.details !== undefined || patch.state === "confirmed" || patch.lifecycle === "active" || patch.pinned === true) {
        next.substantiveAt = evidenceAt; next.lowSince = undefined;
        if(patch.state === "confirmed")next.invalidatedAt=undefined;
      }
      if (patch.lifecycle === "archived") next.archivedAt = now;
      this.persist(next as MemoryRecord); return next as MemoryRecord;
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
    if(!query.history && query.view!=="history" && query.view!=="all")clauses.push("json_extract(m.json,'$.mergedInto') IS NULL");
    if(query.view==="current")clauses.push("m.lifecycle='active' AND m.kind!='activity'");
    if(query.view==="history")clauses.push("(m.lifecycle!='active' OR m.kind='activity' OR EXISTS(SELECT 1 FROM revisions r WHERE r.key=m.key AND (json_extract(r.json,'$.text')!=json_extract(m.json,'$.text') OR coalesce(json_extract(r.json,'$.details'),'')!=coalesce(json_extract(m.json,'$.details'),''))))");
    if (query.lifecycle && query.lifecycle !== "all") { clauses.push("m.lifecycle=?"); args.push(query.lifecycle); }
    else if (!query.history && !query.view && !recent && (query.state===undefined || query.state==="confirmed")) clauses.push("m.lifecycle='active' AND m.kind!='activity'");
    if (!query.history && query.view!=="history" && query.view!=="all" && !recent && (query.state===undefined || query.state==="confirmed")) { clauses.push("(json_extract(m.json,'$.expiresAt') IS NULL OR json_extract(m.json,'$.expiresAt')>?)"); args.push(Date.now()); }
    if(!query.history && query.view!=="history" && query.view!=="all" && !recent && (query.state===undefined || query.state==="confirmed")) {clauses.push("(json_extract(m.json,'$.effectiveAt') IS NULL OR json_extract(m.json,'$.effectiveAt')<=?)");args.push(Date.now());}
    if (query.kind) { clauses.push("m.kind=?"); args.push(query.kind); }
    if (query.from !== undefined) { clauses.push("m.occurred_at>=?"); args.push(query.from); }
    if (query.to !== undefined) { clauses.push("m.occurred_at<=?"); args.push(query.to); }
    const tokens = memoryTokens(query.query ?? "", 32);
    const terms = tokens.some(t=>[...t].length>1) ? tokens.filter(t=>[...t].length>1).slice(0,16) : tokens;
    let join = "", ranking = "",historyMatch:string|undefined;
    if (terms.length) {
      const index = query.history || query.state === "candidate" || query.state === "all" ? "history_search" : "current_search";
      if(index === "history_search") {
        clauses.push("m.key IN (SELECT key FROM history_search WHERE tokens MATCH ?)");
        historyMatch=terms.map(t=>`"${t.replaceAll('"','""')}"`).join(" OR ");
        join=" JOIN (SELECT key,min(score) score FROM ranked_history GROUP BY key) matched ON matched.key=m.key";
        ranking="matched.score,";
      }
      else {join=` JOIN ${index} ON ${index}.key=m.key`;ranking=`bm25(${index}),`;clauses.push(`${index}.tokens MATCH ?`);}
      args.push(terms.map(t => `"${t.replaceAll('"','""')}"`).join(" OR "));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = (this.db.prepare(`SELECT count(*) AS n FROM memory m ${historyMatch?"":join} ${where}`).get(...args) as { n: number }).n;
    const limit = Math.max(1,Math.min(50,query.limit ?? 20)), offset = Math.max(0,query.offset ?? 0);
    const prefix=historyMatch?"WITH ranked_history AS MATERIALIZED (SELECT key,rank score FROM history_search WHERE tokens MATCH ?) ":"";
    const rows = this.db.prepare(`${prefix}SELECT m.json FROM memory m ${join} ${where} ORDER BY ${ranking} ${recent ? "" : "(m.lifecycle='active') DESC,"}m.occurred_at DESC,m.key LIMIT ? OFFSET ?`).all(...(historyMatch?[historyMatch]:[]),...args,limit,offset);
    const items=rows.map(row=>{
      const item=summarize(this.parse(row)!);
      if(query.view==="history" && !terms.length && item.lifecycle==="active") {
        const previous=this.db.prepare("SELECT revision FROM revisions WHERE key=? AND (json_extract(json,'$.text')!=? OR coalesce(json_extract(json,'$.details'),'')!=?) ORDER BY revision DESC LIMIT 1").get(item.key,item.text,this.get(item.key,item.projectId)?.details ?? "") as {revision:number}|undefined;
        if(previous)item.matchedRevision=previous.revision;
      }
      if(query.history && terms.length) {
        const match=this.db.prepare("SELECT revision FROM history_search WHERE key=? AND tokens MATCH ? ORDER BY rank,CAST(revision AS INTEGER) DESC LIMIT 1").get(item.key,terms.map(t=>`"${t.replaceAll('"','""')}"`).join(" OR ")) as {revision:number}|undefined;
        if(match && Number(match.revision)!==item.revision)item.matchedRevision=Number(match.revision);
      }
      return item;
    });
    return { items, total, ...(offset + items.length < total ? { next: offset + items.length } : {}) };
  }
  forget(ref: string, projectId?: string): { forgotten: boolean } {
    return this.transaction(() => {
      const item = this.resolve(ref,projectId);
      if (!item) return { forgotten: false };
      const related=[item];
      for(let i=0;i<related.length;i++)for(const row of this.db.prepare("SELECT json FROM memory WHERE json_extract(json,'$.mergedInto')=?").all(related[i]!.key))related.push(this.parse(row)!);
      const sources=related.flatMap(entry=>[...recordSources(entry),...this.revisions(entry.key,entry.projectId).flatMap(recordSources)]);
      for (const source of sources) {
        for(const ref of [source.ref,source.anchorRef].filter((ref):ref is string=>Boolean(ref))) {
          this.db.prepare("INSERT OR IGNORE INTO blocked_sources(ref) VALUES (?)").run(ref);
          this.db.prepare("DELETE FROM jobs WHERE ref=? OR json_extract(json,'$.anchorRef')=?").run(ref,ref);
        }
      }
      for(const entry of related){
        this.db.prepare("DELETE FROM memory WHERE key=?").run(entry.key);
        this.db.prepare("DELETE FROM revisions WHERE key=?").run(entry.key);
        this.db.prepare("DELETE FROM current_search WHERE key=?").run(entry.key);
        this.db.prepare("DELETE FROM history_search WHERE key=?").run(entry.key);
      }
      this.setMetadata("generation", (this.metadata<number>("generation") ?? 0) + 1);
      return { forgotten: true };
    });
  }
  isBlocked(ref: string): boolean { return Boolean(this.db.prepare("SELECT ref FROM blocked_sources WHERE ref=?").get(ref)); }
  detachSession(sessionId: string, clear: boolean): void {
    this.transaction(()=>{
      const rows=this.db.prepare("SELECT json FROM memory").all();
      for(const row of rows){
        const item=this.parse(row)!,current=item.sources.some(source=>source.sessionId===sessionId),pending=item.pending?.patch.sources?.some(source=>source.sessionId===sessionId);
        if(!current && !pending)continue;
        if(current && (clear || item.state!=="confirmed")){this.forget(item.key,item.projectId);continue;}
        if(pending){delete item.pending;item.reason="未生效的更正来源会话已删除，计划已取消";}
        item.sources=item.sources.map(source=>source.sessionId===sessionId?{...source,deleted:true}:source);
        item.revision++;item.updatedAt=Date.now();this.persist(item);
        for(const old of this.revisions(item.key,item.projectId)){
          old.sources=old.sources.map(source=>source.sessionId===sessionId?{...source,deleted:true}:source);
          if(old.pending?.patch.sources)old.pending.patch.sources=old.pending.patch.sources.map(source=>source.sessionId===sessionId?{...source,deleted:true}:source);
          this.db.prepare("UPDATE revisions SET json=? WHERE key=? AND revision=?").run(JSON.stringify(old),old.key,old.revision);
        }
      }
      const jobs=this.db.prepare("SELECT ref,json FROM jobs").all() as Array<{ref:string;json:string}>;
      for(const row of jobs)if((JSON.parse(row.json) as MemoryJob).sessionId===sessionId){this.db.prepare("INSERT OR IGNORE INTO blocked_sources VALUES (?)").run(row.ref);this.db.prepare("DELETE FROM jobs WHERE ref=?").run(row.ref);}
    });
  }
  invalidateSession(sessionId:string,valid:Array<{entryId:string;hash:string}>):number {
    const byId=new Map(valid.map(item=>[item.entryId,item.hash]));
    const invalid=(source:MemorySource)=>source.sessionId===sessionId && source.type==="session" && source.hash && (!source.entryId || byId.get(source.entryId)!==source.hash);
    return this.transaction(()=>{
      const rows=this.db.prepare("SELECT json FROM memory WHERE (state='confirmed' OR json_extract(json,'$.pending') IS NOT NULL) AND (EXISTS (SELECT 1 FROM json_each(json_extract(memory.json,'$.sources')) s WHERE json_extract(s.value,'$.sessionId')=?) OR EXISTS (SELECT 1 FROM json_each(json_extract(memory.json,'$.pending.patch.sources')) s WHERE json_extract(s.value,'$.sessionId')=?))").all(sessionId,sessionId);
      let count=0;
      for(const row of rows){const item=this.parse(row)!;let changed=false;
        if(item.pending?.patch.sources?.some(invalid)){delete item.pending;item.reason="计划的更正来源已撤回或修订，未自动采用";changed=true;}
        if(item.sources.some(invalid) && !item.sources.some(source=>source.type==="manual")){item.state="candidate";item.lifecycle="archived";item.invalidatedAt=Date.now();item.reason="原会话来源已撤回或修订，待复核";changed=true;}
        if(changed){item.revision++;item.updatedAt=Date.now();this.persist(item);count++;}
      }
      const jobs=this.db.prepare("SELECT json FROM jobs WHERE state IN ('pending','running') AND json_extract(json,'$.sessionId')=?").all(sessionId) as Array<{json:string}>;
      for(const row of jobs){const job=JSON.parse(row.json) as MemoryJob;if(byId.get(job.entryId)!==job.hash)this.db.prepare("UPDATE jobs SET state='skipped',lease_until=0 WHERE ref=?").run(job.ref);}
      return count;
    });
  }
  lookupSummaries(keys:string[],projectId?:string):MemorySummary[] {
    return keys.slice(0,100).map(key=>this.get(key,projectId)).filter((item):item is MemoryRecord=>Boolean(item)).map(summarize);
  }
  activateDue(now=Date.now()):{count:number;projectIds:string[]} {
    return this.transaction(()=>{
      const rows=this.db.prepare("SELECT json FROM memory WHERE json_extract(json,'$.pending.at')<=? LIMIT 100").all(now),projects=new Set<string>();
      for(const row of rows){
        const item=this.parse(row)!,pending=item.pending!;
        const blocked=pending.patch.sources?.some(source=>this.isBlocked(source.ref) || (source.anchorRef && this.isBlocked(source.anchorRef)));
        if(blocked){delete item.pending;item.reason="计划的更正来源已失效，未自动采用";item.revision++;this.persist(item);}
        else this.update(item.key,item.projectId,item.revision,{...pending.patch,cancelPending:true,reason:pending.patch.reason ?? "计划更正已按生效时间采用"},now,pending.evidenceAt);
        if(item.projectId)projects.add(item.projectId);
      }
      return {count:rows.length,projectIds:[...projects]};
    });
  }
  evaluate(now = Date.now()): {count:number;projectIds:string[]} {
    return this.transaction(()=>{
      const scheduled=this.activateDue(now);
      const rows=this.db.prepare("SELECT json FROM memory WHERE lifecycle='active' AND json_extract(json,'$.expiresAt')<=? LIMIT 200").all(now);
      const projects=new Set<string>(scheduled.projectIds);
      for(const row of rows){const item=this.parse(row)!;this.update(item.key,item.projectId,item.revision,{lifecycle:"archived",reason:"明确期限已到，保留历史"},now);if(item.projectId)projects.add(item.projectId);}
      // Keep only the small id/hash watermark for completed work; never prune user facts by age.
      this.db.exec("UPDATE jobs SET json=json_remove(json,'$.sessionFile','$.projectPath','$.timezone','$.error','$.lease') WHERE state IN ('done','skipped') AND json_extract(json,'$.sessionFile') IS NOT NULL");
      return {count:rows.length+scheduled.count,projectIds:[...projects]};
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
  projectHistory(projectId: string): Array<MemoryRecord & {historicalRevision?:boolean}> {
    const current=this.db.prepare("SELECT json FROM memory WHERE project_id=? AND (state='confirmed' OR json_extract(json,'$.invalidatedAt') IS NOT NULL) AND kind IN ('activity','decision','lesson') ORDER BY occurred_at,key").all(projectId).map(r=>this.parse(r)!);
    const result:Array<MemoryRecord & {historicalRevision?:boolean}>=[];
    for(const item of current){
      const seen=new Set([JSON.stringify([item.kind,item.text,item.details])]);
      for(const old of this.revisions(item.key,projectId)){
        const signature=JSON.stringify([old.kind,old.text,old.details]);
        if(old.state!=="confirmed" || seen.has(signature))continue;seen.add(signature);
        result.push({...old,lifecycle:"archived",historicalRevision:true,invalidatedAt:item.invalidatedAt});
      }
      result.push(item);
    }
    return result.sort((a,b)=>a.occurredAt-b.occurredAt || a.key.localeCompare(b.key) || a.revision-b.revision);
  }
}
