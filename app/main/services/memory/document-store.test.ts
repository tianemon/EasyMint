import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_SEED,
  migrateDocument,
  ensureDocument,
  readDocument,
  removeDocumentEntry,
  upsertDocumentEntry,
  writeDocument,
} from "./document-store";
import { parseEntries } from "./memory-entries";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function file(name = "MEMORY.md"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-memdoc-"));
  dirs.push(root);
  return path.join(root, "memory", name);
}

it("文件不存在时返回 null，播种只建标题不写占位句", () => {
  const target = file();
  expect(readDocument(target)).toBeNull();
  expect(ensureDocument(target)).toBe(DOCUMENT_SEED);
  expect(readDocument(target)).toBe(DOCUMENT_SEED);
  expect(readDocument(target)).not.toMatch(/暂无/u);
});

it("首次写入自动建目录与文件，条目落成索引格式", () => {
  const target = file();
  const result = upsertDocumentEntry(target, { key: "global/abc", text: "别先给方案再问", dbRevision: 3 });
  expect(result.changed).toBe(true);
  expect(readDocument(target)).toContain("- 别先给方案再问 <!-- memory:global/abc r:3 -->");
  expect(fs.statSync(target).mode & 0o777).toBe(0o600);
});

it("同一 key 覆盖正文，文件里不出现重复条目", () => {
  const target = file();
  upsertDocumentEntry(target, { key: "k1", text: "先给结论", dbRevision: 1 });
  upsertDocumentEntry(target, { key: "k1", text: "先给结论，再问细节", dbRevision: 2 });
  const entries = parseEntries(readDocument(target)!);
  expect(entries).toHaveLength(1);
  expect(entries[0]!.text).toBe("先给结论，再问细节");
  expect(entries[0]!.dbRevision).toBe(2);
});

it("内容未变时不重复落盘", () => {
  const target = file();
  upsertDocumentEntry(target, { key: "k1", text: "同一条", dbRevision: 1 });
  const before = fs.statSync(target).mtimeMs;
  const again = upsertDocumentEntry(target, { key: "k1", text: "同一条", dbRevision: 1 });
  expect(again.changed).toBe(false);
  expect(fs.statSync(target).mtimeMs).toBe(before);
});

it("删除按 key 精确移除，其余内容原样保留", () => {
  const target = file();
  writeDocument(target, "# MEMORY\n\n> 手写说明\n\n- A <!-- m:k1 -->\n- B <!-- m:k2 -->\n");
  expect(removeDocumentEntry(target, "k1").changed).toBe(true);
  const text = readDocument(target)!;
  expect(text).toContain("> 手写说明");
  expect(text).toContain("- B <!-- m:k2 -->");
  expect(text).not.toContain("- A ");
  expect(removeDocumentEntry(target, "不存在").changed).toBe(false);
});

it("拒绝符号链接与非普通文件，拒绝超限内容", () => {
  const target = file();
  const root = path.dirname(path.dirname(target));
  fs.mkdirSync(root, { recursive: true });
  const real = path.join(root, "real.md");
  fs.writeFileSync(real, "# MEMORY\n");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(real, target);
  expect(() => writeDocument(target, DOCUMENT_SEED)).toThrow(/符号链接/u);
  fs.unlinkSync(target);
  expect(() => writeDocument(target, "x".repeat(DOCUMENT_MAX_BYTES + 1))).toThrow(/大小上限/u);
});

it("旧版多节摘要迁移成单节条目，先备份并丢掉占位句", () => {
  const target = file();
  const legacy = `# 记忆摘要\n\n## 关于用户\n暂无已确认摘要。\n\n## 当期关注\n\n- 真条目 A <!-- memory:k1 r:1 -->\n\n## 近期项目\n暂无项目入口。\n`;
  writeDocument(target, legacy.replace("当期关注", "当前关注"));
  const backupDir = path.join(path.dirname(path.dirname(target)), "backups");
  const result = migrateDocument(target, backupDir, Date.UTC(2026, 10, 16));
  expect(result.migrated).toBe(true);
  expect(fs.readFileSync(result.backup!, "utf8")).toContain("## 关于用户");
  const migrated = readDocument(target)!;
  expect(migrated).not.toContain("## 关于用户");
  expect(migrated).not.toContain("暂无");
  expect(migrated).toContain("真条目 A");
});

it("新结构不再被判定为需要迁移", () => {
  const target = file();
  writeDocument(target, `${DOCUMENT_SEED}- A <!-- memory:k1 r:1 -->\n`);
  expect(migrateDocument(target, path.join(path.dirname(target), "backups")).migrated).toBe(false);
});
