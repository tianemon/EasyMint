import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MemoryMigrationReport, MemoryRecord } from "../../../shared/memory";
import { MemoryDatabase, hashText, scopeKey } from "./database";

interface Snapshot { root: string; files: Record<string, string>; hash: string }
function inventory(directory: string): Record<string,string> {
  const files: Record<string,string> = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir,entry.name), rel = path.relative(directory,full);
      if (entry.isSymbolicLink()) throw new Error(`迁移不跟随符号链接：${rel}`);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files[rel] = hashText(fs.readFileSync(full).toString("base64"));
    }
  };
  walk(directory); return files;
}
/** Byte-preserving snapshot, verified before returning; the source is never renamed or removed. */
export function snapshotDirectory(directory: string, backupRoot: string): Snapshot {
  const files = inventory(directory), hash = hashText(JSON.stringify(files));
  fs.mkdirSync(backupRoot,{recursive:true,mode:0o700});
  const root = path.join(backupRoot,`${hash.slice(0,16)}-${randomUUID()}`);
  fs.mkdirSync(root,{mode:0o700});
  for (const file of Object.keys(files)) {
    const target = path.join(root,file);
    fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    fs.copyFileSync(path.join(directory,file),target,fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target,0o600);
  }
  if (JSON.stringify(inventory(root)) !== JSON.stringify(files) || JSON.stringify(inventory(directory)) !== JSON.stringify(files)) {
    throw new Error("迁移期间源文件发生变化或备份校验失败，原件和备份均保留，请重试");
  }
  return { root,files,hash };
}
export function migrateExperiences(db: MemoryDatabase, directory: string, backupRoot: string, projectId?: string): MemoryMigrationReport {
  const report: MemoryMigrationReport = { directory,backup:"",imported:0,unchanged:0,conflicts:0,missing:[],errors:[] };
  if (!fs.existsSync(directory)) return report;
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error("经验目录为符号链接，未自动迁移；原件保留");
  const files = inventory(directory), version = hashText(JSON.stringify(files));
  const metaKey = `migration:${scopeKey(projectId)}:${path.resolve(directory)}`;
  const prior = db.metadata<{hash:string;report:MemoryMigrationReport}>(metaKey);
  if (prior?.hash === version) return { ...prior.report,imported:0,unchanged:prior.report.imported+prior.report.unchanged+prior.report.conflicts,conflicts:0 };
  const snapshot = snapshotDirectory(directory,backupRoot);
  report.backup = snapshot.root;
  const referenced = new Set<string>();
  const records: MemoryRecord[] = [];
  const readRows = (file: string, archived: boolean) => {
    if (!fs.existsSync(path.join(snapshot.root,file))) return;
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(path.join(snapshot.root,file),"utf8"));
      const rows = archived ? raw : (raw as {items?: unknown})?.items;
      if (!Array.isArray(rows)) throw new Error("索引格式无效");
      for (const value of rows) {
        const row = value as Record<string,unknown>;
        if (!row || typeof row !== "object" || typeof row.id !== "string" || typeof row.file !== "string") {
          report.errors.push(`${file}有无效条目，完整原始索引已备份`); continue;
        }
        const relative = path.join(archived ? "archive" : "",row.file);
        if (path.isAbsolute(row.file) || relative.split(/[\\/]/).includes("..") || !Object.hasOwn(snapshot.files,relative)) {
          report.missing.push(relative); records.push(makeRecord(row,relative,undefined,archived)); continue;
        }
        referenced.add(relative);
        records.push(makeRecord(row,relative,fs.readFileSync(path.join(snapshot.root,relative),"utf8"),archived));
      }
    } catch (error) { report.errors.push(`${file}：${(error as Error).message}；原件及备份保留`); }
  };
  const makeRecord = (row: Record<string,unknown>, relative: string, body: string | undefined, archived: boolean): MemoryRecord => {
    const now = Date.now(), contentHash = snapshot.files[relative] ?? hashText(`missing:${relative}`);
    const id = String(row.id), title = typeof row.title === "string" ? row.title : path.basename(relative,".md");
    const createdAt = typeof row.createdAt === "number" && Number.isFinite(row.createdAt) && Number.isFinite(new Date(row.createdAt).getTime()) ? row.createdAt : now;
    const updatedAt = typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) && Number.isFinite(new Date(row.updatedAt).getTime()) ? row.updatedAt : createdAt;
    return { key:`${scopeKey(projectId)}/${id}`,id,scope:projectId ? "project" : "global",projectId,
      kind:row.kind === "temporary" ? "attention" : "lesson",text:title,details:body,
      tags:Array.isArray(row.tags) ? row.tags.filter((t):t is string => typeof t === "string") : [],
      state:"candidate",lifecycle:archived ? "retired" : "archived",revision:1,createdAt,updatedAt,occurredAt:createdAt,timeBasis:"recorded",substantiveAt:now,
      archivedAt:now,pinned:false,importance:"normal",reason:body === undefined ? "旧索引的正文缺失，保留元数据与完整索引备份" : "已保留旧经验，待复核；未自动升级成用户约束",
      sources:[{ref:`legacy:${path.resolve(directory,relative)}:${contentHash}`,type:"legacy",anchorRef:`legacy-id:${scopeKey(projectId)}:${id}`}],
      legacy:{...row,originalId:id,originalFile:relative,contentHash,backup:path.join(snapshot.root,relative)} };
  };
  readRows("index.json",false); readRows(path.join("archive","index.json"),true);
  // Archives may have fallen out of the old capped index. Preserve every orphan Markdown as well.
  for (const file of Object.keys(snapshot.files)) {
    if (!file.endsWith(".md") || referenced.has(file)) continue;
    const row = { id:`legacy-${hashText(file).slice(0,24)}`,title:path.basename(file,".md"),file };
    records.push(makeRecord(row,file,fs.readFileSync(path.join(snapshot.root,file),"utf8"),file.startsWith(`archive${path.sep}`)));
  }
  db.transaction(() => {
    for (const record of records) {
      const result = db.importLegacy(record);
      if (result === "imported") report.imported++;
      else if (result === "unchanged") report.unchanged++;
      else report.conflicts++;
    }
    db.setMetadata(metaKey,{ hash:snapshot.hash,report });
  });
  return report;
}
