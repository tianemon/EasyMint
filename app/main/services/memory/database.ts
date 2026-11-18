import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { hashText, scopeKey, memoryDay } from "./codec";
export { hashText, scopeKey } from "./codec";
import fs,{ mkdirSync } from "node:fs";
import path from "node:path";
import type { MemoryConclusion, MemoryPage, MemoryQuery, MemoryRecord, MemorySource, MemorySummary, MemoryWrite } from "../../../shared/memory";
import { MEMORY_TEXT_LIMIT, MEMORY_DETAILS_LIMIT, MEMORY_SUMMARY_LIMIT } from "../../../shared/memory";
import { memoryTokens, validateMemoryWrite } from "./policy";
import {assertNoUnindexedBodies,cleanupLegacyGlobal,cleanupLegacyProject,memoryHome} from "./first-launch";
import { CONVERSATION_CONFIG_FILE } from "../../../shared/collaboration";
import { assertPromptStoreEntries, storeSchema } from "../prompt-config-schema";
import {MemoryFileStore,type FileCommit} from "./file-store";
import {estimateMemoryTokens} from "./context";
import {roleSnapshot} from "../../../shared/memory-doc";
import {DOCUMENT_SEED,documentTransaction,readDocument} from "./document-store";
import {parseEntries,upsertEntry,removeEntry,type MemoryEntry} from "./memory-entries";

export function summarize(item: MemoryRecord): MemorySummary {
  const { details: _details, pending, sources, ...rest } = item;
  return { ...rest,pendingAt:pending?.at, sources: sources.map(source=>({...source})) };
}
const recordSources=(item:MemoryRecord)=>[...item.sources,...(item.pending?.patch.sources ?? [])];
export interface WriteContext { projectId?: string; source: MemorySource; confirmed: boolean; pinned?: boolean; now?: number; evidenceAt?:number }
export interface MemoryAnalysisWrite { input:MemoryWrite; context:WriteContext; target?:{key:string;revision:number} }
export interface MemoryCaptureTicket {ref:string;generation:string}
export interface MemoryJob extends MemoryConclusion { attempts: number; retryAt: number; generation?:string; lease?: string; cursor?: number; error?:string }
type IndexedRecord=MemoryRecord & {bodyFile?:string;bodyKey?:string;shallow?:boolean;shallowHash?:string};
export const MEMORY_CAPACITY=8000;
export const MEMORY_SOFT_CAPACITY=6500;
export const MEMORY_COMPACT_TARGET=5500;
const MEMORY_APPLICATION_ID=0x454d4d31;
const LEGACY_MISSING_MODEL = "该会话未配置后台分析可用的模型";
export class MemoryDatabase {
  readonly db: DatabaseSync;
  private inTransaction = false;
  readonly documentFile:string|undefined;
  private documentValue=DOCUMENT_SEED;
  private entriesCache=new Map<string,{text:string;entries:Map<string,MemoryEntry>}>();
  private readonly files:MemoryFileStore;
  private readonly journalFile:string|undefined;

  constructor(file: string, recordingStartedAt=Date.now()) {
    this.documentFile=file===":memory:"?undefined:path.join(path.dirname(file),"MEMORY.md");
    this.files=new MemoryFileStore(this.documentFile?path.dirname(this.documentFile):undefined);
    this.journalFile=file===":memory:"?undefined:path.join(path.dirname(file),"index-commit.json");
    if(file!==":memory:"){
      const root=path.dirname(file),home=memoryHome(root);
      for(const target of [...new Set([home,root,file,`${file}-wal`,`${file}-shm`])]){const stat=fs.lstatSync(target,{throwIfNoEntry:false});if(stat?.isSymbolicLink()||stat&&(target===home||target===root?!stat.isDirectory():!stat.isFile()))throw new Error("记忆数据库及目录必须是普通路径，不能跟随链接");}
      mkdirSync(root,{recursive:true,mode:0o700});
    }
    this.db=new DatabaseSync(file);let setupTransaction=false;
    try{
      this.db.exec("PRAGMA busy_timeout=5000");
      const inspect=()=>{
        const version=(this.db.prepare("PRAGMA user_version").get() as {user_version:number}).user_version;
        if(version>5)throw new Error("记忆数据库版本高于当前应用，请使用更新版本");
        const application=(this.db.prepare("PRAGMA application_id").get() as {application_id:number}).application_id;
        const populated=Boolean(this.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get());
        if((application!==0&&application!==MEMORY_APPLICATION_ID)||(application===0&&(populated||version>0)))throw new Error("该路径已有未识别的数据库，原件未修改，请先确认来源");
        if(version===0&&populated)throw new Error("记忆索引资格状态不完整，正文已保留；请恢复数据库后重试");
        return version;
      };
      inspect();
      for(let attempt=0;;attempt++){
        try{this.db.exec("PRAGMA journal_mode=WAL");break;}
        catch(error){const code=(error as {errcode?:number}).errcode;if((code!==5&&code!==6)||attempt>=7)throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20*(attempt+1));}
      }
      const initialize=(current:string|null,write:(next:string)=>void)=>{
        this.db.exec("PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON; BEGIN IMMEDIATE");setupTransaction=true;
        const version=inspect();
        if(version===5){
          const epoch=this.metadata<number>("recordingStartedAt");
          if(this.metadata<number>("bodylessFormat")!==4||typeof epoch!=="number"||!Number.isFinite(epoch)||epoch<0||!Number.isFinite(new Date(epoch).getTime()))throw new Error("记忆索引缺失或资格状态不完整，正文已保留；请恢复数据库后重试");
          this.db.exec("COMMIT");setupTransaction=false;
          this.recoverDocument();this.documentValue=this.files.read("MEMORY.md") ?? DOCUMENT_SEED;return;
        }
        if(typeof recordingStartedAt!=="number"||!Number.isFinite(recordingStartedAt)||recordingStartedAt<0||!Number.isFinite(new Date(recordingStartedAt).getTime()))throw new Error("首次记忆记录起点无效，未清理旧数据");
        if(this.documentFile){
          const root=path.dirname(this.documentFile);
          if(version===0)assertNoUnindexedBodies(root);
          if(roleSnapshot(current ?? DOCUMENT_SEED)!==roleSnapshot(DOCUMENT_SEED)){
            let ready=false;
            try {
              const config = storeSchema.parse(JSON.parse(readDocument(path.join(memoryHome(root), CONVERSATION_CONFIG_FILE)) ?? "null"));
              assertPromptStoreEntries(config);
              ready = config.rolesInJson === true;
            }
            catch{/* 未核实角色真源时必须先保留旧MD。 */}
            if(!ready)throw new Error("旧记忆仍有人设或规则，角色配置尚未确认保存；未清理旧记忆，请先恢复角色配置");
          }
        }
        this.db.exec("DROP TABLE IF EXISTS memory; DROP TABLE IF EXISTS revisions; DROP TABLE IF EXISTS blocked_sources; DROP TABLE IF EXISTS metadata; DROP TABLE IF EXISTS jobs; DROP TABLE IF EXISTS usage; DROP TABLE IF EXISTS search_tokens; DROP TABLE IF EXISTS current_search; DROP TABLE IF EXISTS history_search");
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory (key TEXT PRIMARY KEY, id TEXT NOT NULL, scope TEXT NOT NULL,
        project_id TEXT, kind TEXT NOT NULL, confidence TEXT NOT NULL, lifecycle TEXT NOT NULL,
        occurred_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, fingerprint TEXT NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS memory_scope ON memory(scope,project_id,confidence,lifecycle,occurred_at);
      CREATE INDEX IF NOT EXISTS memory_due ON memory(json_extract(json,'$.pending.at')) WHERE json_extract(json,'$.pending.at') IS NOT NULL;
      CREATE INDEX IF NOT EXISTS memory_fingerprint ON memory(scope,project_id,fingerprint);
      CREATE TABLE IF NOT EXISTS revisions (key TEXT NOT NULL, revision INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY(key,revision));
      CREATE TABLE IF NOT EXISTS blocked_sources (ref TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (ref TEXT PRIMARY KEY, json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', retry_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS usage (day TEXT PRIMARY KEY, tokens INTEGER NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS current_search USING fts5(key UNINDEXED,tokens);
      CREATE VIRTUAL TABLE IF NOT EXISTS history_search USING fts5(key UNINDEXED,revision UNINDEXED,tokens);
        `);
        this.db.exec("CREATE TABLE IF NOT EXISTS search_tokens(key TEXT NOT NULL,revision INTEGER NOT NULL,tokens TEXT NOT NULL,PRIMARY KEY(key,revision))");
        if(this.documentFile){cleanupLegacyGlobal(path.dirname(this.documentFile));if(current!==null&&current!==DOCUMENT_SEED)write(DOCUMENT_SEED);}
        this.documentValue=DOCUMENT_SEED;
        this.setMetadata("bodylessFormat",4);this.setMetadata("recordingStartedAt",recordingStartedAt);
        this.db.exec(`PRAGMA application_id=${MEMORY_APPLICATION_ID}; PRAGMA user_version=5; COMMIT`);setupTransaction=false;
      };
      if(this.documentFile)documentTransaction(this.documentFile,initialize);else initialize(null,()=>{});
    }catch(error){if(setupTransaction)this.db.exec("ROLLBACK");this.db.close();throw error;}
  }
  close(): void { this.db.close(); }
  private bodyEntries(file="MEMORY.md"):Map<string,MemoryEntry> {
    const text=file==="MEMORY.md" && this.inTransaction?this.documentValue:this.files.read(file) ?? DOCUMENT_SEED;
    const cached=this.entriesCache.get(file);if(cached?.text===text)return cached.entries;
    const entries=new Map(parseEntries(text).map(entry=>[entry.key,entry]));this.entriesCache.set(file,{text,entries});return entries;
  }
  private entryMeta(item:MemoryRecord):MemoryEntry["meta"] {return {kind:item.kind,scope:item.scope,projectId:item.projectId,lifecycle:item.lifecycle,confidence:item.confidence,...(item.sources[0]?{source:item.sources[0].ref}:{})};}
  private replaceBody(key:string,body:Pick<MemoryRecord,"text"|"details"|"summary"|"kind"|"revision"> & Partial<MemoryRecord>,pending=false,file="MEMORY.md"):void {
    const current=file==="MEMORY.md"?this.documentValue:this.files.read(file) ?? (body.kind==="lesson"?"# 经验\n\n":DOCUMENT_SEED);
    const next=upsertEntry(removeEntry(current,key),{key,text:body.text,details:body.details,summary:body.summary,kind:body.kind,dbRevision:body.revision,pending,memoryDate:body.memoryDate,...(body.scope&&body.sources?{meta:this.entryMeta(body as MemoryRecord)}:{})});
    if(file==="MEMORY.md")this.documentValue=next;else this.files.stage(file,next);this.entriesCache.delete(file);
  }
  private removeBody(key:string,file="MEMORY.md"):void {
    const current=file==="MEMORY.md"?this.documentValue:this.files.read(file);if(current===null)return;
    const next=removeEntry(current,key);
    if(file==="MEMORY.md")this.documentValue=next;
    else this.files.stage(file,file.startsWith("../experiences/")&&!parseEntries(next).length?null:next);
    this.entriesCache.delete(file);
  }
  private bodyHash(body:{text:string;details?:string;summary?:string}):string {return hashText(JSON.stringify([body.text,body.details ?? null,body.summary ?? null]));}
  private clearJournal():void {if(this.journalFile)try{fs.unlinkSync(this.journalFile);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")console.warn("[memory] 提交恢复记录稍后清理",error);}}
  private writeJournal(commit:FileCommit):void {
    if(!this.journalFile)return;const temporary=`${this.journalFile}.${randomUUID()}.tmp`;
    try{const fd=fs.openSync(temporary,"wx",0o600);try{fs.writeFileSync(fd,JSON.stringify(commit));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temporary,this.journalFile);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  }
  private recoverDocument():void {
    if(!this.journalFile || !fs.existsSync(this.journalFile))return;
    const journal=JSON.parse(fs.readFileSync(this.journalFile,"utf8")) as FileCommit;
    if(!Array.isArray(journal.files))throw new Error("旧的未完成记忆提交需要原版本恢复，材料未覆盖");
    this.files.install(journal);
    this.db.exec("BEGIN IMMEDIATE");
    try{
      if(this.metadata<string>("documentCommit")!==journal.id){
        const allowed=new Set(["memory","revisions","blocked_sources","metadata","jobs","usage","search_tokens"]);
        if(!this.db.applyChangeset(Buffer.from(journal.changes,"base64"),{filter:table=>allowed.has(table)}))throw new Error("记忆索引事务无法恢复，正文与恢复记录均已保留");
      }
      this.rebuildSearch();this.db.exec("COMMIT");
    }catch(error){this.db.exec("ROLLBACK");throw error;}
    this.files.cleanup(journal);this.clearJournal();
  }
  private rebuildSearch():void {
    this.db.exec("DELETE FROM current_search; DELETE FROM history_search");
    for(const row of this.db.prepare("SELECT key,revision,tokens FROM search_tokens").all() as Array<{key:string;revision:number;tokens:string;confidence?:string}>){
      this.db.prepare("INSERT INTO history_search(key,revision,tokens) VALUES (?,?,?)").run(row.key,row.revision,row.tokens);
    }
    for(const row of this.db.prepare("SELECT t.key,t.tokens FROM search_tokens t JOIN memory m ON m.key=t.key AND t.revision=json_extract(m.json,'$.revision') WHERE m.confidence='confirmed'").all() as Array<{key:string;tokens:string}>)this.db.prepare("INSERT INTO current_search(key,tokens) VALUES (?,?)").run(row.key,row.tokens);
  }
  transaction<T>(fn:()=>T):T {
    if(this.inTransaction)return fn();
    const run=():T=>{
      this.recoverDocument();this.files.begin();this.documentValue=this.files.read("MEMORY.md") ?? DOCUMENT_SEED;this.entriesCache.clear();
      this.db.exec("BEGIN IMMEDIATE");const session=this.db.createSession();this.inTransaction=true;let journal:FileCommit|undefined,prepared=false;let result:T;
      try{
        result=fn();
        if(this.documentValue!==(this.files.read("MEMORY.md") ?? DOCUMENT_SEED)){
          this.enforceCapacity(MEMORY_CAPACITY);this.files.stage("MEMORY.md",this.documentValue);
          this.setMetadata("capacityCheckpoint",{checkedAt:Date.now(),contentVersion:hashText(this.documentValue),tokens:estimateMemoryTokens(this.documentValue)});
        }
        if(this.files.changed() && this.journalFile){
          const id=randomUUID();this.setMetadata("documentCommit",id);journal=this.files.prepare(id,Buffer.from(session.changeset()).toString("base64"));
          this.writeJournal(journal);prepared=true;this.files.install(journal);
        }
        this.db.exec("COMMIT");
        if(!this.journalFile)this.files.applyVirtual();
        if(journal){this.files.cleanup(journal);this.clearJournal();}
        return result;
      }catch(error){
        try{this.db.exec("ROLLBACK");}catch{/* Recovery checks the durable commit id. */}
        if(prepared){this.inTransaction=false;this.recoverDocument();return result!;}
        if(journal)this.files.cleanup(journal);throw error;
      }finally{session.close();this.inTransaction=false;this.files.begin();this.entriesCache.clear();}
    };
    return this.documentFile?documentTransaction(this.documentFile,()=>run()):run();
  }
  private parse(row:unknown):MemoryRecord|undefined {
    if(!row)return;
    const stored=JSON.parse((row as {json:string}).json) as IndexedRecord & {bodyHash?:string};
    const body=this.bodyEntries(stored.bodyFile ?? "MEMORY.md").get(stored.bodyKey ?? stored.key);
    const accepted=body && this.bodyHash(body)===stored.bodyHash?body:undefined;
    const item={...stored,text:accepted?.text ?? "",details:accepted?.details,summary:accepted?.summary};
    if(item.pending){const p=item.pending;const future=this.bodyEntries(p.bodyFile ?? "MEMORY.md").get(p.bodyKey ?? `${item.key}!pending`);if(future)item.pending={...p,patch:{...p.patch,text:future.text,details:future.details,summary:future.summary}};}
    return item;
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
  private recordJson(item:IndexedRecord):string {
    const {text,details,summary,pending,...metadata}=item;
    return JSON.stringify({...metadata,bodyHash:text?hashText(JSON.stringify([text,details ?? null,summary ?? null])):(item as MemoryRecord & {bodyHash?:string}).bodyHash ?? hashText(""),...(pending?{pending:{...pending,patch:Object.fromEntries(Object.entries(pending.patch).filter(([key])=>!["text","details","summary"].includes(key)))}}:{})});
  }
  private deepFile(item:MemoryRecord):string {return `deep/${item.memoryDate ?? memoryDay(new Date(item.createdAt))}/MEMORY.md`;}
  private archiveBody(item:MemoryRecord):void {
    if(!item.text)return;const old=item as IndexedRecord;
    const file=item.kind==="lesson"?`../experiences/history/${item.id}-r${item.revision}.md`:this.deepFile(item),key=`${item.key}!r${item.revision}`;
    this.replaceBody(key,item,false,file);
    this.db.prepare("UPDATE revisions SET json=? WHERE key=? AND revision=?").run(this.recordJson({...old,bodyFile:file,bodyKey:key}),item.key,item.revision);
  }
  private persist(item:MemoryRecord,keepRevision=true,now=Date.now()):void {
    const indexed=item as IndexedRecord;
    item.text=item.text.trim().replace(/[\r\n]+/gu," ");if(item.summary!==undefined&&(!item.summary.trim()||item.summary.trim()===item.text))delete item.summary;if(item.details!==undefined&&!item.details.trim())delete item.details;item.memoryDate ??= memoryDay(new Date(item.createdAt));
    const previous=this.db.prepare("SELECT json FROM memory WHERE key=?").get(item.key) as {json:string}|undefined;
    const old=previous?JSON.parse(previous.json) as IndexedRecord:undefined;
    const active=item.confidence==="confirmed"&&item.lifecycle==="active"&&!item.invalidatedAt;
    let file=indexed.bodyFile ?? (item.kind==="lesson"?`../experiences/${item.id}.md`:"MEMORY.md"),key=indexed.bodyKey ?? item.key;
    if(!active && item.text && item.kind!=="lesson"){file=this.deepFile(item);key=`${item.key}!r${item.revision}`;}
    if(item.kind==="lesson")file=`../experiences/${item.id}.md`;
    if(old?.bodyFile && (old.bodyFile!==file || old.bodyKey!==key) && old.bodyFile==="MEMORY.md")this.removeBody(old.bodyKey ?? item.key);
    indexed.bodyFile=file;indexed.bodyKey=key;
    if(item.text){
      this.replaceBody(key,item,Boolean(item.effectiveAt && item.effectiveAt>now),file);
      if(file!=="MEMORY.md"){
        if(active && item.kind!=="lesson" && indexed.shallow!==false)this.replaceBody(item.key,{...item,text:item.summary || item.text,details:undefined,summary:undefined},Boolean(item.effectiveAt&&item.effectiveAt>now));
        else this.removeBody(item.key);
      }
    }else this.removeBody(item.key);
    const root=this.bodyEntries().get(item.key);indexed.shallowHash=root?this.bodyHash(root):undefined;
    if(item.pending){
      const pending=item.pending;pending.bodyFile=this.deepFile(item);pending.bodyKey=`${item.key}!pending!r${item.revision}`;
      this.replaceBody(pending.bodyKey,{...item,...pending.patch,expiresAt:pending.patch.expiresAt ?? undefined,effectiveAt:pending.patch.effectiveAt ?? undefined,revision:item.revision+1},true,pending.bodyFile);
    }else if(old?.pending){this.removeBody(old.pending.bodyKey ?? `${item.key}!pending`,old.pending.bodyFile ?? "MEMORY.md");}
    const json=this.recordJson(item);
    this.db.prepare(`INSERT INTO memory(key,id,scope,project_id,kind,confidence,lifecycle,occurred_at,updated_at,fingerprint,json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET confidence=excluded.confidence,lifecycle=excluded.lifecycle,
      kind=excluded.kind,occurred_at=excluded.occurred_at,updated_at=excluded.updated_at,fingerprint=excluded.fingerprint,json=excluded.json`).run(item.key,item.id,item.scope,item.projectId ?? null,item.kind,item.confidence,item.lifecycle,item.occurredAt,item.updatedAt,this.fingerprint(item),json);
    if(keepRevision)this.db.prepare("INSERT OR REPLACE INTO revisions VALUES (?,?,?)").run(item.key,item.revision,json);
    const tokens=item.text?memoryTokens(`${item.text} ${item.tags.join(" ")} ${item.details ?? ""}`).join(" "):(this.db.prepare("SELECT tokens FROM search_tokens WHERE key=? ORDER BY revision DESC LIMIT 1").get(item.key) as {tokens?:string}|undefined)?.tokens ?? "";
    this.db.prepare("INSERT OR REPLACE INTO search_tokens VALUES (?,?,?)").run(item.key,item.revision,tokens);
    this.db.prepare("DELETE FROM current_search WHERE key=?").run(item.key);this.db.prepare("DELETE FROM history_search WHERE key=? AND revision=?").run(item.key,item.revision);
    this.db.prepare("INSERT INTO history_search(key,revision,tokens) VALUES (?,?,?)").run(item.key,item.revision,tokens);
    if(item.confidence==="confirmed")this.db.prepare("INSERT INTO current_search(key,tokens) VALUES (?,?)").run(item.key,tokens);
    this.setMetadata("generation",(this.metadata<number>("generation") ?? 0)+1);
  }
  private moveToDeep(item:MemoryRecord,keepShallow:boolean):void {
    const indexed=item as IndexedRecord;indexed.bodyFile=this.deepFile(item);indexed.bodyKey=`${item.key}!r${item.revision}`;indexed.shallow=keepShallow;
    this.removeBody(item.key);this.persist(indexed,true);
  }
  private enforceCapacity(limit:number):void {
    if(estimateMemoryTokens(this.documentValue)<=limit)return;
    const entries=parseEntries(this.documentValue),records=entries.flatMap(entry=>{const item=this.get(entry.key);if(item)return [item];const match=/^project:([^/]+)\//u.exec(entry.key);const project=match?this.get(entry.key,match[1]):undefined;return project?[project]:[];})
      .filter(item=>item.kind!=="lesson").sort((a,b)=>Number(a.pinned)-Number(b.pinned)||Number(a.importance==="high")-Number(b.importance==="high")||(a.memoryDate ?? "").localeCompare(b.memoryDate ?? "")||a.createdAt-b.createdAt);
    for(const item of records){if(estimateMemoryTokens(this.documentValue)<=limit)break;if(item.details)this.moveToDeep(item,true);}
    for(const item of records){if(estimateMemoryTokens(this.documentValue)<=limit)break;this.moveToDeep(this.get(item.key,item.projectId) ?? item,false);}
    if(estimateMemoryTokens(this.documentValue)>MEMORY_CAPACITY)throw new Error("主记忆包含无法自动整理的内容，原件保留，未覆盖");
  }
  checkCapacity(force=false,now=Date.now()):{tokens:number;needsCompaction:boolean} {
    const prior=this.metadata<{checkedAt:number;tokens:number}>("capacityCheckpoint");
    if(!force && prior && now-prior.checkedAt>=0 && now-prior.checkedAt<3600000)return {tokens:prior.tokens,needsCompaction:prior.tokens>=MEMORY_SOFT_CAPACITY};
    return this.transaction(()=>{const tokens=estimateMemoryTokens(this.documentValue);this.setMetadata("capacityCheckpoint",{checkedAt:now,contentVersion:hashText(this.documentValue),tokens});return {tokens,needsCompaction:tokens>=MEMORY_SOFT_CAPACITY};});
  }
  compact():{tokens:number} {return this.transaction(()=>{this.enforceCapacity(MEMORY_COMPACT_TARGET);return {tokens:estimateMemoryTokens(this.documentValue)};});}
  cleanupLegacyProjects(projects:Array<{id:string;path:string}>):{warnings:string[]} {
    const warnings:string[]=[];
    for(const project of projects){const checkpoint=`projectCleanup:v1:${project.id}`;if(this.metadata<boolean>(checkpoint))continue;
      const result=cleanupLegacyProject(project.path);warnings.push(...result.warnings);if(!result.warnings.length)this.transaction(()=>this.setMetadata(checkpoint,true));
    }
    return {warnings};
  }
  sourceEntryIds(sessionId:string):string[] {
    const ids=new Set<string>();
    for(const row of this.db.prepare("SELECT json FROM memory WHERE EXISTS(SELECT 1 FROM json_each(json_extract(memory.json,'$.sources')) s WHERE json_extract(s.value,'$.sessionId')=? OR json_extract(s.value,'$.ownerSessionId')=?) OR EXISTS(SELECT 1 FROM json_each(json_extract(memory.json,'$.pending.patch.sources')) s WHERE json_extract(s.value,'$.sessionId')=? OR json_extract(s.value,'$.ownerSessionId')=?)").all(sessionId,sessionId,sessionId,sessionId)){
      const item=JSON.parse((row as {json:string}).json) as MemoryRecord;
      for(const source of recordSources(item)){if(source.sessionId===sessionId){if(source.entryId)ids.add(source.entryId);for(const entry of source.evidence ?? [])ids.add(entry.entryId);}if(source.ownerSessionId===sessionId&&source.ownerEntryId)ids.add(source.ownerEntryId);}
    }
    for(const row of this.db.prepare("SELECT json FROM jobs WHERE (json_extract(json,'$.sessionId')=? OR json_extract(json,'$.execution.permissionSessionId')=?) AND state IN ('pending','running')").all(sessionId,sessionId) as Array<{json:string}>){const job=JSON.parse(row.json) as MemoryJob;if(job.sessionId===sessionId)ids.add(job.entryId);if(job.execution?.permissionSessionId===sessionId)ids.add(job.execution.ownerEntryId);}
    return [...ids];
  }
  ensureRoutine(now=Date.now()):{lastRunAt:number;nextDueAt:number} {
    return this.transaction(()=>{const prior=this.metadata<{lastRunAt:number;nextDueAt:number}>("routineCheckpoint");if(prior&&Number.isFinite(prior.nextDueAt)&&prior.nextDueAt<=now+3600000)return prior;const next={lastRunAt:0,nextDueAt:now+3600000};this.setMetadata("routineCheckpoint",next);return next;});
  }
  cancelCapture(tickets:MemoryCaptureTicket[]):void {this.transaction(()=>{for(const ticket of tickets)this.db.prepare("UPDATE jobs SET state='skipped',lease_until=0 WHERE ref=? AND json_extract(json,'$.generation')=? AND state IN ('pending','running')").run(ticket.ref,ticket.generation);});}
  finishRoutine(now=Date.now()):{lastRunAt:number;nextDueAt:number} {return this.transaction(()=>{const next={lastRunAt:now,nextDueAt:now+3600000};this.setMetadata("routineCheckpoint",next);return next;});}
  submissionsForRound(job:MemoryConclusion):Array<{key:string;revision:number;kind:string;text:string}> {
    const anchors=new Set((job.userEntryIds ?? []).map(id=>`user:${job.sessionId}:${id}`));if(job.anchorRef)anchors.add(job.anchorRef);
    return this.db.prepare("SELECT json FROM memory WHERE confidence='confirmed'").all().flatMap(row=>{const raw=JSON.parse((row as {json:string}).json) as MemoryRecord;if(raw.sources.some(source=>source.sessionId===job.sessionId&&source.submissionId&&[source.anchorRef,...(source.anchorRefs ?? [])].some(ref=>ref&&anchors.has(ref)))){const item=this.parse(row)!;return [{key:item.key,revision:item.revision,kind:item.kind,text:item.text}];}return [];});
  }
  save(input: MemoryWrite, context: WriteContext): { item: MemoryRecord; existing: boolean } {
    validateMemoryWrite(input);
    return this.transaction(() => {
      if ([context.source.ref,context.source.anchorRef,...(context.source.anchorRefs ?? [])].some(ref=>ref&&this.isBlocked(ref))) throw new Error("该旧来源已被遗忘或删除，不再提取");
      const now = context.now ?? Date.now();
      const candidate: MemoryRecord = { key: "", id: randomUUID(), scope: context.projectId ? "project" : "global", projectId: context.projectId,
        kind: input.kind, text: input.text.trim(), details: input.details, tags: input.tags ?? [],
        confidence: context.confirmed ? "confirmed" : "unconfirmed", lifecycle: "active", revision: 1,
        createdAt: now, updatedAt: now, memoryDate:memoryDay(new Date(now)), occurredAt: input.occurredAt ?? context.evidenceAt ?? now, timeBasis: input.occurredAt === undefined ? "recorded" : "occurred", substantiveAt: context.evidenceAt ?? now,
        expiresAt: input.expiresAt ?? undefined, effectiveAt:input.effectiveAt ?? undefined,summary:input.summary, importance: input.importance === "high" ? "high" : "normal", pinned: context.pinned === true,
        sources: [context.source] };
      if(context.source.submissionId){const same=this.db.prepare("SELECT json FROM memory WHERE EXISTS(SELECT 1 FROM json_each(json_extract(memory.json,'$.sources')) s WHERE json_extract(s.value,'$.ref')=?) AND project_id IS ?").get(context.source.ref,context.projectId ?? null);if(same)return {item:this.parse(same)!,existing:true};}
      const prior = this.parse(this.db.prepare("SELECT json FROM memory WHERE scope=? AND project_id IS ? AND fingerprint=? LIMIT 1").get(candidate.scope,candidate.projectId ?? null,this.fingerprint(candidate)));
      if (prior) {
        const newSource = !prior.sources.some(source => source.ref === context.source.ref);
        const anchor=context.source.anchorRef ?? context.source.ref;
        const newEvidence=!prior.sources.some(source=>(source.anchorRef ?? source.ref)===anchor);
                if (newSource) prior.sources.push(context.source);
        if (context.confirmed && newEvidence && (prior.confidence !== "confirmed" || (prior.lifecycle!=="active" && prior.kind!=="activity") || (prior.expiresAt!==undefined && prior.expiresAt<=now))) {
          prior.text=candidate.text;prior.details=candidate.details;prior.summary=candidate.summary;prior.confidence="confirmed"; prior.lifecycle="active"; prior.invalidatedAt=undefined; prior.revision++; prior.substantiveAt=Math.max(prior.substantiveAt,context.evidenceAt ?? now); prior.updatedAt=now;
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
  update(ref: string, projectId: string | undefined, revision: number, patch: Partial<MemoryWrite> & Pick<Partial<MemoryRecord>, "confidence" | "lifecycle" | "pinned" | "reason" | "sources"> & {cancelPending?:boolean}, now = Date.now(), evidenceAt=now): MemoryRecord {
    return this.transaction(() => {
      const item = this.get(ref,projectId);
      if (!item) throw new Error("记忆不存在或不属于当前范围");
      if (item.revision !== revision) throw new Error("记忆已更新，请重新读取后再修改");
      const incoming=patch.sources ?? [];
      const newManual=incoming.some(source=>source.type==="manual" && !item.sources.some(old=>old.ref===source.ref));
      const editsKnowledge=["text","details","kind","tags","occurredAt","expiresAt","importance"].some(key=>Object.hasOwn(patch,key)) || patch.confidence==="confirmed";
      if(!newManual && editsKnowledge && incoming.some(source=>this.isBlocked(source.ref) || (source.anchorRef && this.isBlocked(source.anchorRef))))throw new Error("该旧来源已被遗忘，不可用于改写其他记忆；需要新的明确依据");
      const definedPatch=Object.fromEntries(Object.entries(patch).filter(([key,value])=>key!=="cancelPending" && value!==undefined && !(value===null && ["expiresAt","effectiveAt"].includes(key) && item[key as keyof MemoryRecord]===undefined)));
      if(typeof patch.effectiveAt==="number" && patch.effectiveAt>now && ["text","details","kind"].some(key=>Object.hasOwn(definedPatch,key) && JSON.stringify(item[key as keyof MemoryRecord])!==JSON.stringify(definedPatch[key]))) {
        validateMemoryWrite({...item,...definedPatch} as MemoryWrite);
        const scheduled={...item,memoryDate:memoryDay(new Date(now)),pending:{at:patch.effectiveAt,patch:definedPatch,evidenceAt},revision:item.revision+1,updatedAt:now};
        this.persist(scheduled,true,now);return scheduled;
      }
      if(!patch.cancelPending && Object.entries(definedPatch).every(([key,value])=>JSON.stringify(item[key as keyof MemoryRecord])===JSON.stringify(value)))return item;
      if(patch.lifecycle==="active" && !item.text && typeof patch.text!=="string")throw new Error("该条已归档，正文请先按来源读取并整理后再恢复");
      const semantic=["text","details","kind","occurredAt","effectiveAt","expiresAt"].some(key=>Object.hasOwn(definedPatch,key)&&JSON.stringify(item[key as keyof MemoryRecord])!==JSON.stringify(definedPatch[key]));
      if(semantic || patch.lifecycle==="archived" || patch.confidence==="unconfirmed")this.archiveBody(item);
      const next = { ...item, ...definedPatch,...(semantic?{memoryDate:memoryDay(new Date(now)),bodyFile:undefined,bodyKey:undefined,shallow:true}:{}), key: item.key, id: item.id, projectId: item.projectId, scope: item.scope,
        revision: item.revision + 1, updatedAt: now };
      if(next.expiresAt===null)delete next.expiresAt;
      if(next.effectiveAt===null)delete next.effectiveAt;
      if(patch.summary===undefined && ["text","details","kind"].some(key=>Object.hasOwn(definedPatch,key) && JSON.stringify(item[key as keyof MemoryRecord])!==JSON.stringify(definedPatch[key]))) {
        next.summary=item.summary===item.text && patch.text!==undefined && patch.text.length<=MEMORY_SUMMARY_LIMIT?patch.text:"";
      }
      if(patch.cancelPending || ["text","details","kind","lifecycle","confidence"].some(key=>Object.hasOwn(definedPatch,key) && JSON.stringify(item[key as keyof MemoryRecord])!==JSON.stringify(definedPatch[key]))) {
        if(next.pending)next.reason=patch.reason ?? (patch.cancelPending?"用户取消尚未生效的更正":"本次更正替代了原计划");
        delete next.pending;
      }
      if(["text","details","kind","summary","effectiveAt","expiresAt"].some(key=>Object.hasOwn(definedPatch,key) && JSON.stringify(item[key as keyof MemoryRecord])!==JSON.stringify(definedPatch[key]))) {
        validateMemoryWrite({...next,text:next.text===item.text && item.text.length>MEMORY_TEXT_LIMIT?"旧条目":next.text,
          details:next.details===item.details && (item.details?.length ?? 0)>MEMORY_DETAILS_LIMIT?undefined:next.details});
      }
      if (patch.text !== undefined || patch.details !== undefined || patch.confidence === "confirmed" || patch.lifecycle === "active" || patch.pinned === true) {
        next.substantiveAt = evidenceAt;
        if(patch.confidence === "confirmed")next.invalidatedAt=undefined;
      }
      if (patch.lifecycle === "archived") next.archivedAt = now;
      this.persist(next as MemoryRecord,true,now); return next as MemoryRecord;
    });
  }
  query(query: MemoryQuery = {}): MemoryPage {
    const clauses: string[] = []; const args: Array<string | number | null> = [];
    if(query.family==="memory")clauses.push("m.kind!='lesson'");else if(query.family==="experience")clauses.push("m.kind='lesson'");
    const recent = query.scope === "recent";
    if (recent) clauses.push("m.kind IN ('activity','decision')");
    else if (query.scope === "project") { clauses.push("m.project_id=?"); args.push(query.projectId ?? "__none__"); }
    else if (query.scope === "global") clauses.push("m.project_id IS NULL");
    else { clauses.push("(m.project_id IS NULL OR m.project_id=?)"); args.push(query.projectId ?? null); }
    if (query.history && query.confidence===undefined) clauses.push("(m.confidence='confirmed' OR json_extract(m.json,'$.invalidatedAt') IS NOT NULL)");
    else if (query.confidence !== "all") { clauses.push("m.confidence=?"); args.push(query.confidence ?? "confirmed"); }
    if(query.view==="current")clauses.push("m.lifecycle='active'");
    if(query.view==="history")clauses.push("(m.lifecycle!='active' OR EXISTS(SELECT 1 FROM revisions r WHERE r.key=m.key AND (json_extract(r.json,'$.bodyHash')!=json_extract(m.json,'$.bodyHash'))))");
    if (query.lifecycle && query.lifecycle !== "all") { clauses.push("m.lifecycle=?"); args.push(query.lifecycle); }
    else if (!query.history && !query.view && !recent && (query.confidence===undefined || query.confidence==="confirmed")) clauses.push("m.lifecycle='active'");
    if (!query.history && query.view!=="history" && query.view!=="all" && !recent && (query.confidence===undefined || query.confidence==="confirmed")) { clauses.push("(json_extract(m.json,'$.expiresAt') IS NULL OR json_extract(m.json,'$.expiresAt')>?)"); args.push(Date.now()); }
    if(!query.history && query.view!=="history" && query.view!=="all" && !recent && (query.confidence===undefined || query.confidence==="confirmed")) {clauses.push("(json_extract(m.json,'$.effectiveAt') IS NULL OR json_extract(m.json,'$.effectiveAt')<=?)");args.push(Date.now());}
    if (query.kind) { clauses.push("m.kind=?"); args.push(query.kind); }
    if (query.from !== undefined) { clauses.push("m.occurred_at>=?"); args.push(query.from); }
    if (query.to !== undefined) { clauses.push("m.occurred_at<=?"); args.push(query.to); }
    const tokens = memoryTokens(query.query ?? "", 32);
    const terms = tokens.some(t=>[...t].length>1) ? tokens.filter(t=>[...t].length>1).slice(0,16) : tokens;
    let join = "", ranking = "",historyMatch:string|undefined;
    if (terms.length) {
      const index = query.history || query.confidence === "unconfirmed" || query.confidence === "all" ? "history_search" : "current_search";
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
        const previous=this.db.prepare("SELECT revision FROM revisions WHERE key=? AND json_extract(json,'$.bodyHash')!=? ORDER BY revision DESC LIMIT 1").get(item.key,(JSON.parse((row as {json:string}).json) as {bodyHash:string}).bodyHash) as {revision:number}|undefined;
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
      const item = this.get(ref,projectId);
      if (!item) return { forgotten: false };
      const related=[item];
      const sources=related.flatMap(entry=>[...recordSources(entry),...this.revisions(entry.key,entry.projectId).flatMap(recordSources)]);
      for (const source of sources) {
        for(const ref of [source.ref,source.anchorRef,...(source.anchorRefs ?? [])].filter((ref):ref is string=>Boolean(ref))) {
          this.db.prepare("INSERT OR IGNORE INTO blocked_sources(ref) VALUES (?)").run(ref);
          this.db.prepare("DELETE FROM jobs WHERE ref=? OR json_extract(json,'$.anchorRef')=? OR EXISTS (SELECT 1 FROM json_each(json_extract(jobs.json,'$.userEntryIds')) u WHERE 'user:'||json_extract(jobs.json,'$.sessionId')||':'||u.value=?)").run(ref,ref,ref);
        }
      }
      for(const entry of related){
        const variants=[entry,...this.revisions(entry.key,entry.projectId)] as IndexedRecord[];
        for(const variant of variants){if(variant.bodyFile)this.removeBody(variant.bodyKey ?? variant.key,variant.bodyFile);if(variant.pending)this.removeBody(variant.pending.bodyKey ?? `${variant.key}!pending`,variant.pending.bodyFile ?? "MEMORY.md");}
        this.removeBody(entry.key);this.removeBody(`${entry.key}!pending`);
        this.db.prepare("DELETE FROM search_tokens WHERE key=?").run(entry.key);
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
        const item=this.parse(row)!,current=item.sources.some(source=>source.sessionId===sessionId||source.ownerSessionId===sessionId),pending=item.pending?.patch.sources?.some(source=>source.sessionId===sessionId||source.ownerSessionId===sessionId);
        if(!current && !pending)continue;
        if(current && (clear || item.confidence!=="confirmed")){this.forget(item.key,item.projectId);continue;}
        if(pending){delete item.pending;item.reason="未生效的更正来源会话已删除，计划已取消";}
        item.sources=item.sources.map(source=>(source.sessionId===sessionId||source.ownerSessionId===sessionId)?{...source,deleted:true}:source);
        item.revision++;item.updatedAt=Date.now();this.persist(item);
        for(const old of this.revisions(item.key,item.projectId)){
          old.sources=old.sources.map(source=>(source.sessionId===sessionId||source.ownerSessionId===sessionId)?{...source,deleted:true}:source);
          if(old.pending?.patch.sources)old.pending.patch.sources=old.pending.patch.sources.map(source=>(source.sessionId===sessionId||source.ownerSessionId===sessionId)?{...source,deleted:true}:source);
          this.db.prepare("UPDATE revisions SET json=? WHERE key=? AND revision=?").run(this.recordJson(old),old.key,old.revision);
        }
      }
      const jobs=this.db.prepare("SELECT ref,json FROM jobs").all() as Array<{ref:string;json:string}>;
      for(const row of jobs)if(((JSON.parse(row.json) as MemoryJob).sessionId===sessionId||(JSON.parse(row.json) as MemoryJob).execution?.permissionSessionId===sessionId)){this.db.prepare("INSERT OR IGNORE INTO blocked_sources VALUES (?)").run(row.ref);this.db.prepare("DELETE FROM jobs WHERE ref=?").run(row.ref);}
    });
  }
  invalidateSession(sessionId:string,valid:Array<{entryId:string;hash:string}>,knownEntryIds?:string[]):number {
    const byId=new Map(valid.map(item=>[item.entryId,item.hash]));
    // New facts/jobs may arrive while the caller reads sources; absence is only
    // evidence against IDs included in that caller's observed catalog.
    const known=knownEntryIds?new Set(knownEntryIds):undefined,observed=(id:string|undefined)=>known===undefined||Boolean(id&&known.has(id));
    const invalid=(source:MemorySource)=>source.type==="session" && ((source.sessionId===sessionId && ((source.hash && observed(source.entryId) && (!source.entryId || byId.get(source.entryId)!==source.hash)) || source.evidence?.some(entry=>observed(entry.entryId)&&byId.get(entry.entryId)!==entry.hash))) || source.ownerSessionId===sessionId && source.ownerEntryId && observed(source.ownerEntryId) && byId.get(source.ownerEntryId)!==source.ownerHash);
    return this.transaction(()=>{
      const rows=this.db.prepare("SELECT json FROM memory WHERE confidence='confirmed' OR json_extract(json,'$.pending') IS NOT NULL").all();
      let count=0;
      for(const row of rows){const item=this.parse(row)!;let changed=false;
        if(item.pending?.patch.sources?.some(invalid)){delete item.pending;item.reason="计划的更正来源已撤回或修订，未自动采用";changed=true;}
        if(item.sources.some(invalid) && !item.sources.some(source=>source.type==="manual")){item.confidence="unconfirmed";item.lifecycle="archived";item.invalidatedAt=Date.now();item.reason="原会话来源已撤回或修订，待复核";changed=true;}
        if(changed){item.revision++;item.updatedAt=Date.now();this.persist(item);count++;}
      }
      const jobs=this.db.prepare("SELECT json FROM jobs WHERE state IN ('pending','running') AND (json_extract(json,'$.sessionId')=? OR json_extract(json,'$.execution.permissionSessionId')=?)").all(sessionId,sessionId) as Array<{json:string}>;
      for(const row of jobs){const job=JSON.parse(row.json) as MemoryJob;if(job.sessionId===sessionId&&observed(job.entryId)&&byId.get(job.entryId)!==job.hash||job.execution?.permissionSessionId===sessionId&&observed(job.execution.ownerEntryId)&&byId.get(job.execution.ownerEntryId)!==job.execution.ownerHash)this.db.prepare("UPDATE jobs SET state='skipped',lease_until=0 WHERE ref=?").run(job.ref);}
      return count;
    });
  }
  scopeDocument(projectId?:string):{content:string;hash:string} {
    const current=this.inTransaction?this.documentValue:this.files.read("MEMORY.md") ?? DOCUMENT_SEED;let content=DOCUMENT_SEED;
    for(const entry of parseEntries(current)){
      const row=this.db.prepare("SELECT json FROM memory WHERE key=? AND (project_id IS NULL OR project_id=?)").get(entry.key,projectId ?? null) as {json:string}|undefined;
      if(!row)continue;const item=JSON.parse(row.json) as IndexedRecord & {bodyHash:string};
      if(item.kind==="lesson"||item.confidence!=="confirmed"||item.lifecycle!=="active"||item.invalidatedAt||item.revision!==entry.dbRevision||item.effectiveAt!==undefined&&item.effectiveAt>Date.now()||item.expiresAt!==undefined&&item.expiresAt<=Date.now())continue;
      if((item.shallowHash ?? item.bodyHash)!==this.bodyHash(entry))continue;
      content=upsertEntry(content,{...entry,kind:item.kind});
    }
    return {content,hash:hashText(content)};
  }
  editDocument(content:string,expectedHash:string,projectId?:string):{content:string;hash:string} {
    this.transaction(()=>{
      const scoped=this.scopeDocument(projectId);
      if(roleSnapshot(scoped.content)!==roleSnapshot(content))throw new Error("记忆维护不能修改规则或人设；请使用角色设置");
      if(scoped.hash!==expectedHash)throw new Error("MEMORY.md changed. Reopen it before saving.");
      for(const line of content.split("\n"))if(line.trim()&&!/^(?:#{1,6}\s|[-*]\s|  (?:详情：|摘要：|> |<!-- memory-(?:body|meta) ))/u.test(line))throw new Error("仅支持保留ID的条目维护；新增事实请通过save/update提交");
      const before=new Map(parseEntries(scoped.content).map(entry=>[entry.key,entry])),after=new Map(parseEntries(content).map(entry=>[entry.key,entry]));
      for(const [key,entry] of after){
        const prior=before.get(key);if(!prior)throw new Error("新的事实请先通过save/update保存，不能改写其他项目或未确认事实");
        if(JSON.stringify(prior)===JSON.stringify(entry))continue;
        if(prior.dbRevision!==entry.dbRevision||prior.memoryDate!==entry.memoryDate||JSON.stringify(prior.meta)!==JSON.stringify(entry.meta))throw new Error("条目ID、版本、日期和来源由程序维护，不能通过整理改写");
        const item=this.get(key,projectId)!;
        const details=prior.details===undefined&&entry.details===undefined?item.details:entry.details;
        validateMemoryWrite({...item,text:entry.text,details,summary:entry.summary});
        this.persist({...item,text:entry.text,details,summary:entry.summary,revision:item.revision+1,updatedAt:Date.now()});
      }
      for(const [key] of before)if(!after.has(key)){const item=this.get(key,projectId);if(item)this.moveToDeep(item,false);}
    });
    // Capacity downshift runs after the callback; return the committed document.
    return this.scopeDocument(projectId);
  }
  lookupReferences(keys:string[],projectId?:string):Array<MemoryRecord & {bodyHash:string}> {
    const out:Array<MemoryRecord & {bodyHash:string}>=[];
    for(let offset=0;offset<keys.length;offset+=500){const part=keys.slice(offset,offset+500);if(!part.length)continue;
      const rows=this.db.prepare(`SELECT json FROM memory WHERE key IN (${part.map(()=>"?").join(",")}) AND (project_id IS NULL OR project_id=?)`).all(...part,projectId ?? null) as Array<{json:string}>;
      out.push(...rows.map(row=>JSON.parse(row.json) as MemoryRecord & {bodyHash:string}));
    }return out;
  }
  lookupSummaries(keys:string[],projectId?:string):MemorySummary[] {
    return keys.map(key=>this.get(key,projectId)).filter((item):item is MemoryRecord=>Boolean(item)).map(summarize);
  }
  activateDue(now=Date.now()):{count:number;projectIds:string[]} {
    return this.transaction(()=>{
      for(const row of this.db.prepare("SELECT json FROM memory WHERE json_extract(json,'$.effectiveAt')<=? AND json_extract(json,'$.pending') IS NULL AND confidence='confirmed' AND lifecycle='active'").all(now)){
        const item=this.parse(row)!;if(this.bodyEntries().get(item.key)?.pending && item.text)this.persist(item,true,now);
      }

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
    return (this.db.prepare("SELECT count(*) n FROM memory WHERE project_id=? AND confidence='confirmed' AND kind IN ('activity','decision','lesson')").get(projectId) as {n:number}).n;
  }
  enqueue(conclusion: MemoryConclusion): MemoryCaptureTicket|undefined {
    return this.transaction(()=>{
      if (this.isBlocked(conclusion.ref) || (conclusion.anchorRef && this.isBlocked(conclusion.anchorRef)) || conclusion.userEntryIds?.some(id=>this.isBlocked(`user:${conclusion.sessionId}:${id}`))) return;
      const existing = this.db.prepare("SELECT json,state FROM jobs WHERE ref=?").get(conclusion.ref) as {json:string;state:string} | undefined;
      if (existing && (JSON.parse(existing.json) as MemoryJob).hash === conclusion.hash) return;
      const generation=randomUUID();
      this.db.prepare("INSERT INTO jobs(ref,json) VALUES (?,?) ON CONFLICT(ref) DO UPDATE SET json=excluded.json,state='pending',retry_at=0,lease_until=0").run(conclusion.ref,JSON.stringify({...conclusion,generation,attempts:0,retryAt:0}));
      return {ref:conclusion.ref,generation};
    });
  }
  /**
   * 领取一条任务。按会话过滤时，同一场会话的结论会按时间顺序连续取出，
   * 保证一批里看到的是"一段脉络"而不是随机散点。
   */
  claim(now = Date.now(), projectId?: string | null, sessionId?: string | null): MemoryJob | undefined {
    return this.transaction(() => {
      const filters:string[]=[];const args:Array<number|string|null>=[now,now];
      if(projectId!==undefined){filters.push(" AND json_extract(json,'$.projectId') IS ?");args.push(projectId);}
      if(sessionId!==undefined){filters.push(" AND json_extract(json,'$.sessionId') IS ?");args.push(sessionId);}
      const filter=filters.join("");
      const row = this.db.prepare(`SELECT json FROM jobs WHERE (state='pending' OR (state='running' AND lease_until<?)) AND retry_at<=?${filter} ORDER BY (SELECT max(json_extract(j.json,'$.timestamp')) FROM jobs j WHERE json_extract(j.json,'$.sessionId')=json_extract(jobs.json,'$.sessionId') AND j.state IN ('pending','running')) DESC,json_extract(json,'$.timestamp'),ref LIMIT 1`).get(...args) as {json:string}|undefined;
      if (!row) return;
      const job = JSON.parse(row.json) as MemoryJob;
      job.lease = randomUUID();
      this.db.prepare("UPDATE jobs SET state='running',json=?,lease_until=? WHERE ref=?").run(JSON.stringify(job),now+300_000,job.ref);
      return job;
    });
  }
  finishBatch(jobs:Array<{job:MemoryJob;nextCursor?:number}>,items:MemoryAnalysisWrite[],tokens:number,day:string):{refs:string[];saved:MemoryRecord[]} {
    return this.transaction(()=>{
      this.addUsage(tokens,day);
      const valid=new Map<string,{job:MemoryJob;nextCursor?:number}>();
      for(const entry of jobs) {
        const job=entry.job,current=this.db.prepare("SELECT json,state FROM jobs WHERE ref=?").get(job.ref) as {json:string;state:string}|undefined;
        if(current?.state==='running' && (JSON.parse(current.json) as MemoryJob).lease===job.lease && !this.isBlocked(job.ref) && !(job.anchorRef && this.isBlocked(job.anchorRef))) valid.set(job.ref,entry);
      }
      const saved:MemoryRecord[]=[];
      for(const item of items) if(valid.has(item.context.source.ref)) {
        const target=item.target ? this.get(item.target.key,item.context.projectId) : undefined;
        if(item.target && target && target.projectId===item.context.projectId && target.kind===item.input.kind && item.context.confirmed
          && item.target.revision===target.revision && (item.context.evidenceAt ?? Date.now())>=target.substantiveAt) {
          saved.push(this.update(target.key,item.context.projectId,target.revision,{...item.input,confidence:"confirmed",sources:[item.context.source],pinned:target.pinned || item.context.pinned===true},Date.now(),item.context.evidenceAt));
        } else {if(item.target)throw new Error("目标记忆已变化，请重新分析后更正");saved.push(this.save(item.input,item.context).item);}
      }
      for(const {job,nextCursor} of valid.values()) {
        if(nextCursor===undefined) this.db.prepare("UPDATE jobs SET state='done',lease_until=0 WHERE ref=?").run(job.ref);
        else {job.cursor=nextCursor;job.attempts=0;this.db.prepare("UPDATE jobs SET state='pending',json=?,retry_at=?,lease_until=0 WHERE ref=?").run(JSON.stringify(job),Date.now()+60_000,job.ref);}
      }
      return {refs:[...valid.keys()],saved};
    });
  }
  finishJob(job: MemoryJob, items: Array<{ input: MemoryWrite; context: WriteContext }>, tokens: number, day: string): boolean {
    return this.finishBatch([{job}],items,tokens,day).refs.includes(job.ref);
  }
  skipJob(job:MemoryJob):void {
    const current=this.db.prepare("SELECT json,state FROM jobs WHERE ref=?").get(job.ref) as {json:string;state:string}|undefined;
    if(current?.state==="running" && (JSON.parse(current.json) as MemoryJob).lease===job.lease)this.db.prepare("UPDATE jobs SET state='skipped',lease_until=0 WHERE ref=?").run(job.ref);
  }
  /**
   * 失败任务的自愈：每小时最多复活一次，且每个任务最多复活 3 次。
   * 防止"一次模型抖动"让一条任务永久卡在 failed，也防止坏任务无限烧调用。
   */
  reviveFailed(limit = 5):number {
    return this.transaction(()=>{
      const now = Date.now();
      const rows=this.db.prepare(`SELECT json FROM jobs WHERE state='failed'
        AND (coalesce(json_extract(json,'$.revived'),0)<3 OR json_extract(json,'$.error')=?)
        AND coalesce(json_extract(json,'$.terminal'),0)=0 AND retry_at<=?
        AND NOT EXISTS(SELECT 1 FROM blocked_sources b WHERE b.ref=jobs.ref OR b.ref=json_extract(jobs.json,'$.anchorRef'))
        ORDER BY retry_at LIMIT ?`).all(LEGACY_MISSING_MODEL,now,limit) as Array<{json:string}>;
      let count=0;
      for(const row of rows){
        const job=JSON.parse(row.json) as MemoryJob & {revived?:number};
        if(this.isBlocked(job.ref)||(job.anchorRef&&this.isBlocked(job.anchorRef))) continue;
        const legacy = job.error === LEGACY_MISSING_MODEL;
        // The old resolver could count repeated missing-model errors without ever calling a model.
        if (legacy) {
          delete job.error;
          job.revived = 0;
          job.attempts = 0;
        } else {
          job.revived = (job.revived ?? 0) + 1;
          job.attempts = 2;
        }
        job.retryAt = now + (legacy ? 0 : 60_000);
        this.db.prepare("UPDATE jobs SET state='pending',json=?,retry_at=?,lease_until=0 WHERE ref=?").run(JSON.stringify(job),job.retryAt,job.ref);
        count++;
      }
      return count;
    });
  }
  nextRunAt(failedNotBefore=Date.now()):number|undefined {
    const row=this.db.prepare("SELECT min(at) at FROM (SELECT CASE WHEN state='running' THEN max(retry_at,lease_until) WHEN state='failed' THEN max(retry_at,?) ELSE retry_at END at FROM jobs WHERE state IN ('pending','running') OR (state='failed' AND coalesce(json_extract(json,'$.revived'),0)<3 AND coalesce(json_extract(json,'$.terminal'),0)=0))").get(failedNotBefore) as {at:number|null};return row.at ?? undefined;
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
  releaseJob(job: MemoryJob, tokens: number, day: string, delayMs=60_000): void {
    this.transaction(()=>{
      this.addUsage(tokens,day);
      const current=this.db.prepare("SELECT json,state FROM jobs WHERE ref=?").get(job.ref) as {json:string;state:string}|undefined;
      if(current?.state==='running' && (JSON.parse(current.json) as MemoryJob).lease===job.lease) this.db.prepare("UPDATE jobs SET state='pending',retry_at=?,lease_until=0 WHERE ref=?").run(Date.now()+Math.max(0,delayMs),job.ref);
    });
  }
  failJob(job: MemoryJob, tokens: number, day: string, retry = true, reason?:string): void {
    this.transaction(() => {
      this.addUsage(tokens,day);
      const current = this.db.prepare("SELECT json,state FROM jobs WHERE ref=?").get(job.ref) as {json:string;state:string} | undefined;
      if (current?.state !== "running" || (JSON.parse(current.json) as MemoryJob).lease !== job.lease) return;
      job.attempts++;if(!retry)(job as MemoryJob & {terminal?:boolean}).terminal=true;if(reason)job.error=reason.slice(0,2000);
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
  status(day = memoryDay()): {count:number;pending:number;failed:number;usedTokens:number;lastError?:string;recordingStartedAt?:number} {
    const count = (this.db.prepare("SELECT count(*) n FROM memory").get() as {n:number}).n;
    const pending = (this.db.prepare("SELECT count(*) n FROM jobs WHERE state IN ('pending','running')").get() as {n:number}).n;
    const usedTokens = (this.db.prepare("SELECT tokens FROM usage WHERE day=?").get(day) as {tokens:number} | undefined)?.tokens ?? 0;
    const failed=(this.db.prepare("SELECT count(*) n FROM jobs WHERE state='failed'").get() as {n:number}).n;
    const last=this.db.prepare("SELECT json_extract(json,'$.error') error FROM jobs WHERE state='failed' ORDER BY retry_at DESC LIMIT 1").get() as {error?:string}|undefined;
    return { count,pending,failed,usedTokens,lastError:last?.error,recordingStartedAt:this.metadata<number>("recordingStartedAt") };
  }


}
