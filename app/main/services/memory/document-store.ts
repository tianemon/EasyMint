/**
 * MEMORY.md 的落盘层：唯一的写入口。
 *
 * 约束：
 * - 原子写（临时文件 + rename），权限 0600，拒绝符号链接与超限文件。
 * - 只通过 upsert/remove 改条目行，文件其它内容（标题、说明、用户段落）不动。
 * - 同步实现：写入是低频事件（用户说"记住"、后台产出），不值得异步复杂度。
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { removeEntry, upsertEntry } from "./memory-entries";

export const DOCUMENT_MAX_BYTES = 128 * 1024;
export const DOCUMENT_SEED = "# MEMORY\n\n";

function assertWritableTarget(file: string): void {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return;
  if (stat.isSymbolicLink()) throw new Error("MEMORY.md 不能是符号链接");
  if (!stat.isFile()) throw new Error("MEMORY.md 必须是普通文件");
}

export function readDocument(file: string): string | null {
  try {
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat || stat.isSymbolicLink() || !stat.isFile()) return null;
    if (stat.size > DOCUMENT_MAX_BYTES) return null;
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function writeDocument(file: string, content: string): void {
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

export interface EntryWrite {
  key: string;
  text: string;
  /** 索引里的记录版本；传了才写成 memory:key r:N 标记。 */
  dbRevision?: number;
}

/** 写入/覆盖一条；返回文件是否真的变化，避免无谓落盘。 */
export function upsertDocumentEntry(file: string, entry: EntryWrite): { changed: boolean } {
  if (!entry.text.trim()) throw new Error("条目正文为空");
  const current = readDocument(file) ?? DOCUMENT_SEED;
  const next = upsertEntry(current, entry);
  if (next === current) return { changed: false };
  writeDocument(file, next);
  return { changed: true };
}

export function removeDocumentEntry(file: string, key: string): { changed: boolean } {
  const current = readDocument(file);
  if (!current) return { changed: false };
  const next = removeEntry(current, key);
  if (next === current) return { changed: false };
  writeDocument(file, next);
  return { changed: true };
}

