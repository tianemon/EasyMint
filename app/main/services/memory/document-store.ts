/**
 * Markdown 受控读取与共享文档锁。
 * 生产记忆/经验写入由 MemoryDatabase + MemoryFileStore 的可恢复事务统一负责；
 * 角色迁移只借用此锁读取快照，实际旧角色段清理由同一记忆事务完成。
 * 下方单文件条目 helper 供历史格式/隔离夹具构造，不作为绕过索引的业务写入口。
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {createRequire} from "node:module";
import {roleSnapshot} from "../../../shared/memory-doc";
import type {MemoryKind} from "../../../shared/memory";
import { removeEntry, upsertEntry } from "./memory-entries";

export const DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
export const DOCUMENT_SEED = "# MEMORY\n\n";
const lockfile=createRequire(path.join(__dirname,"memory-doc-lock.cjs"))("proper-lockfile") as {lockSync(file:string,options:{realpath:boolean;stale:number}):()=>void};
const lockSleeper=new Int32Array(new SharedArrayBuffer(4));
/** All document writers, including the role editor and worker, share this lock. */
export function documentTransaction<T>(file:string,run:(current:string|null,write:(next:string)=>void)=>T):T {
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});let release:(()=>void)|undefined;
  for(let attempt=0;attempt<10;attempt++){
    try{release=lockfile.lockSync(file,{realpath:false,stale:30000});break;}
    catch(error){if((error as NodeJS.ErrnoException).code!=="ELOCKED" || attempt===9)throw error;Atomics.wait(lockSleeper,0,0,20);}
  }
  if(!release)throw new Error("MEMORY.md 当前被占用，请重试");
  try{return run(readDocument(file),next=>writeDocumentUnlocked(file,next));}finally{release();}
}

function assertWritableTarget(file: string): void {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return;
  if (stat.isSymbolicLink()) throw new Error("MEMORY.md 不能是符号链接");
  if (!stat.isFile()) throw new Error("MEMORY.md 必须是普通文件");
}

export function readDocument(file: string): string | null {
  try {
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat) return null;
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("MEMORY.md 必须是普通文件，不能是符号链接");
    if (stat.size > DOCUMENT_MAX_BYTES) throw new Error("MEMORY.md 超出安全读取大小，原文件已保留");
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if((error as NodeJS.ErrnoException).code==="ENOENT")return null;
    throw error;
  }
}

function writeDocumentUnlocked(file: string, content: string): void {
  if (Buffer.byteLength(content, "utf8") > DOCUMENT_MAX_BYTES) throw new Error("MEMORY.md 超出大小上限");
  assertWritableTarget(file);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  let created = false;
  try {
    const fd = fs.openSync(temporary, "wx", 0o600);
    created = true;
    try {
      fs.writeFileSync(fd, content);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, file);
  } finally {
    if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
export function writeDocument(file:string,content:string):void {documentTransaction(file,(_current,write)=>write(content));}

export interface EntryWrite {
  key: string;
  text: string;
  /** 索引里的记录版本；传了才写成 memory:key r:N 标记。 */
  dbRevision?: number;
  kind?:MemoryKind;
  details?:string;
  summary?:string;
  pending?:boolean;
}

/** 写入/覆盖一条；返回文件是否真的变化，避免无谓落盘。 */
export function upsertDocumentEntry(file: string, entry: EntryWrite): { changed: boolean } {
  if (!entry.text.trim()) throw new Error("条目正文为空");
  return documentTransaction(file,(saved,write)=>{
    const current=saved ?? DOCUMENT_SEED,next=upsertEntry(current,entry);
    if(roleSnapshot(current)!==roleSnapshot(next))throw new Error("记忆写入不能改变规则或人设");
    if(next===current)return {changed:false};write(next);return {changed:true};
  });
}

export function removeDocumentEntry(file: string, key: string): { changed: boolean } {
  return documentTransaction(file,(current,write)=>{
    if(!current)return {changed:false};const next=removeEntry(current,key);
    if(roleSnapshot(current)!==roleSnapshot(next))throw new Error("记忆移除不能改变规则或人设");
    if(next===current)return {changed:false};write(next);return {changed:true};
  });
}
