/**
 * Experience Service — AI 自沉淀经验库（索引 + 原文分离，模型上下文有限：能索引的就索引）。
 *
 * 存储（每条原文一个 markdown 文件，索引单独一份）：
 *   全局： ~/.easymint/experiences/{index.json, <短id>-<标题>.md, archive/}
 *   项目： <项目>/.easymint/experiences/{index.json, <短id>-<标题>.md, archive/}
 *
 * 两条铁律：
 *  - **注入的只有索引**（标题 + 文件名 + 标签 + 计数），正文从不进注入——模型判断相关时用 read 读原文；
 *  - **作用域由所在目录决定**（不落字段，避免「字段与位置不一致」的第二真相源）。
 *
 * 其它口径：
 *  - `tags` 决定注入时机：空 = 通用（本机环境/工作方式，常驻注入）；带技术栈/平台标签 = 只在与当前
 *    项目技术栈匹配时注入（Flutter 经验不会出现在 React 项目里）
 *  - `kind`：principle（与具体项目无关的通用知识）/ convention（项目内约定）/ temporary（临时，过时应退役）
 *  - 退役与容量淘汰都把原文移进 archive/（含理由，可回溯），不直接删
 *  - 索引损坏改名存证后重建；原文缺失进体检候选
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

export type ExperienceKind = "principle" | "convention" | "temporary";
/** 作用域 = 条目落在哪个目录（项目级 / 全局） */
export type ExperienceScope = "project" | "global";

/** 索引条目——注入与检索只碰这个结构，正文在 file 指向的 markdown 里 */
export interface ExperienceIndexEntry {
  id: string;
  /** 一句话说明（索引展示与检索的主字段） */
  title: string;
  /** 原文文件名（相对索引所在目录） */
  file: string;
  /** 技术栈/平台标签（如 flutter、electron、macos）；**空数组 = 通用条目，常驻注入** */
  tags: string[];
  kind: ExperienceKind;
  createdAt: number;
  updatedAt: number;
  /** search_experiences 命中次数（模型主动检索 = 被用上的证据） */
  usageCount?: number;
  lastUsedAt?: number;
  /** 被注入进系统提示词（送达模型上下文）的次数 */
  injectedCount?: number;
  lastInjectedAt?: number;
}

/** 检索结果：索引条目 + 命中片段（便于模型判断要不要读原文） */
export interface ExperienceHit extends ExperienceIndexEntry {
  scope: ExperienceScope;
  excerpt?: string;
}

/** 档案条目（退役/淘汰时写入 archive/index.json） */
export interface ArchivedExperience {
  id: string;
  title: string;
  file: string;
  kind: ExperienceKind;
  tags: string[];
  createdAt: number;
  retiredAt: number;
  retiredReason: string;
}

export interface ExperienceReviewItem {
  shortIds: string[];
  reason: string;
}

interface IndexFile {
  version: number;
  updatedAt: number;
  items: ExperienceIndexEntry[];
}

const GLOBAL_DIR = path.join(os.homedir(), ".easymint", "experiences");
const INDEX_VERSION = 1;
/** 每库条目上限：索引会随条数增长（注入成本），条数收敛是设计的一部分 */
const MAX_ITEMS = 100;
const MAX_ARCHIVE = 200;
const SEARCH_LIMIT = 10;
const REVIEW_LIMIT = 5;
const SHORT_ID_LEN = 8;
/** 常驻额度：本项目条目、全局通用条目、全局技术栈匹配条目各一份额度（索引行很短，但总额度仍是设计的一部分） */
const INJECT_PROJECT_LIMIT = 4;
const INJECT_COMMON_LIMIT = 4;
const INJECT_STACK_LIMIT = 3;
const TITLE_MAX = 60;
const TEMPORARY_STALE_DAYS = 14;

export function shortId(id: string): string {
  return id.slice(0, SHORT_ID_LEN);
}

export function normalizeKind(kind: unknown): ExperienceKind {
  return kind === "principle" || kind === "temporary" ? kind : "convention";
}

const KIND_LABEL: Record<ExperienceKind, string> = { principle: "原则", convention: "约定", temporary: "临时" };

export function kindLabel(kind: unknown): string {
  return KIND_LABEL[normalizeKind(kind)];
}

export function storeDir(scope: ExperienceScope, projectPath?: string): string {
  return scope === "global" || !projectPath ? GLOBAL_DIR : path.join(projectPath, ".easymint", "experiences");
}

/** 档案目录（退役/淘汰的原文与理由落这里） */
export function archiveDir(scope: ExperienceScope, projectPath?: string): string {
  return path.join(storeDir(scope, projectPath), "archive");
}

/** 当前会话可见的两个库目录（项目库可能还没建） */
export function listStoreDirs(projectPath?: string): Array<{ scope: ExperienceScope; dir: string }> {
  const dirs: Array<{ scope: ExperienceScope; dir: string }> = [];
  if (projectPath) dirs.push({ scope: "project", dir: storeDir("project", projectPath) });
  dirs.push({ scope: "global", dir: GLOBAL_DIR });
  return dirs;
}

function indexPath(dir: string): string {
  return path.join(dir, "index.json");
}

/** 文件名：短 id 打头（稳定、可读、改标题不换文件名）+ 标题前几个「汉字/字母/数字」词组。
 *  按词组累加而不是直接截断——否则文件名会断在半个词上（如「…包内满幅-运」） */
function makeFileName(id: string, title: string): string {
  const parts = title.match(/[\p{Script=Han}A-Za-z0-9]+/gu) ?? [];
  const picked: string[] = [];
  let len = 0;
  for (const p of parts) {
    if (picked.length > 0 && len + p.length > 20) break;
    picked.push(p);
    len += p.length;
    if (len >= 12) break;
  }
  return `${shortId(id)}-${picked.join("-") || "experience"}.md`;
}

export function bodyPath(scope: ExperienceScope, projectPath: string | undefined, entry: { file: string }): string {
  return path.join(storeDir(scope, projectPath), entry.file);
}

function stamp(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function renderBody(title: string, body: string, entry: { id: string; createdAt: number; updatedAt: number }): string {
  const meta = `<!-- id ${shortId(entry.id)} · 记录 ${stamp(entry.createdAt)} · 更新 ${stamp(entry.updatedAt)} -->`;
  return `# ${title}\n\n${body.trim()}\n\n${meta}\n`;
}

/** 损坏文件改名存证（不静默丢弃） */
function quarantine(file: string): void {
  try {
    renameSync(file, `${file}.corrupt-${Date.now()}`);
    console.warn(`[experience] 文件损坏，已改名存证后重建: ${file}`);
  } catch (e) {
    console.warn(`[experience] 文件损坏且改名存证失败（按空处理）: ${file}`, (e as Error).message);
  }
}

function normalizeEntry(raw: unknown): ExperienceIndexEntry | null {
  const e = raw as Partial<ExperienceIndexEntry> | null;
  if (!e || typeof e !== "object" || typeof e.id !== "string" || typeof e.title !== "string" || typeof e.file !== "string") return null;
  return {
    id: e.id,
    title: e.title,
    file: e.file,
    tags: Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === "string") : [],
    kind: normalizeKind(e.kind),
    createdAt: typeof e.createdAt === "number" ? e.createdAt : Date.now(),
    updatedAt: typeof e.updatedAt === "number" ? e.updatedAt : Date.now(),
    usageCount: e.usageCount,
    lastUsedAt: e.lastUsedAt,
    injectedCount: e.injectedCount,
    lastInjectedAt: e.lastInjectedAt,
  };
}

function loadIndex(dir: string): ExperienceIndexEntry[] {
  const file = indexPath(dir);
  if (!existsSync(file)) return [];
  try {
    const data = JSON.parse(readFileSync(file, "utf-8")) as Partial<IndexFile>;
    if (!Array.isArray(data.items)) return [];
    return data.items.map(normalizeEntry).filter((e): e is ExperienceIndexEntry => e !== null);
  } catch {
    // 读路径遇到损坏就地留底：否则下一次写入会把整库索引静默覆盖掉
    quarantine(file);
    return [];
  }
}

function saveIndex(dir: string, items: ExperienceIndexEntry[]): void {
  mkdirSync(dir, { recursive: true });
  const payload: IndexFile = { version: INDEX_VERSION, updatedAt: Date.now(), items };
  const tmp = indexPath(dir) + ".tmp";
  writeFileSync(tmp, JSON.stringify(payload, null, 2));
  renameSync(tmp, indexPath(dir));
}

/** 两个库的索引合并读出（读取侧唯一入口——作用域只能从这里得到） */
function loadScoped(projectPath?: string): ExperienceHit[] {
  const out: ExperienceHit[] = [];
  for (const { scope, dir } of listStoreDirs(projectPath)) {
    for (const e of loadIndex(dir)) out.push({ ...e, scope });
  }
  return out;
}

export function readExperienceBody(scope: ExperienceScope, projectPath: string | undefined, entry: { file: string }): string | null {
  const p = bodyPath(scope, projectPath, entry);
  return existsSync(p) ? readFileSync(p, "utf-8") : null;
}

/** 价值分：kind 权重 + 命中次数 + 新鲜度 + 项目级加成（注入排序与容量淘汰共用） */
function valueScore(e: ExperienceIndexEntry, scope: ExperienceScope): number {
  const kind = normalizeKind(e.kind);
  const kindW = kind === "principle" ? 3 : kind === "temporary" ? 1 : 2;
  const used = Math.min(e.usageCount ?? 0, 4);
  const ageDays = (Date.now() - e.updatedAt) / 86400000;
  const fresh = ageDays < 30 ? 2 : ageDays < 90 ? 1 : 0;
  return kindW + used + fresh + (scope === "project" ? 1 : 0);
}

export type ResolveResult =
  | { ok: true; entry: ExperienceHit; dir: string }
  | { ok: false; reason: "not_found" | "too_short" | "ambiguous"; count?: number };

/** 按 ref（完整 uuid 或 ≥8 字符前缀）定位；前缀命中多条报歧义而不是猜 */
export function resolveExperience(projectPath: string | undefined, ref: string): ResolveResult {
  const id = ref.trim();
  if (!id) return { ok: false, reason: "not_found" };
  const all = loadScoped(projectPath);
  const exact = all.find((e) => e.id === id);
  if (exact) return { ok: true, entry: exact, dir: storeDir(exact.scope, projectPath) };
  if (id.length < SHORT_ID_LEN) return { ok: false, reason: "too_short" };
  const prefixed = all.filter((e) => e.id.startsWith(id));
  if (prefixed.length === 0) return { ok: false, reason: "not_found" };
  if (prefixed.length > 1) return { ok: false, reason: "ambiguous", count: prefixed.length };
  const hit = prefixed[0]!;
  return { ok: true, entry: hit, dir: storeDir(hit.scope, projectPath) };
}

export function resolveErrorText(ref: string, r: { reason: "not_found" | "too_short" | "ambiguous"; count?: number }): string {
  if (r.reason === "too_short") return `id「${ref}」太短：至少给 ${SHORT_ID_LEN} 个字符（短 id 见检索结果或注入索引）`;
  if (r.reason === "ambiguous") return `id「${ref}」命中 ${r.count ?? 2} 条，请给更长的 id`;
  return `未找到经验「${ref}」（可能已退役或被容量淘汰）`;
}

/** 退役/淘汰通用：原文移进 archive/ + 档案登记（可回溯），返回是否成功 */
function moveToArchive(scope: ExperienceScope, projectPath: string | undefined, entry: ExperienceIndexEntry, reason: string): void {
  const dir = storeDir(scope, projectPath);
  const adir = archiveDir(scope, projectPath);
  mkdirSync(adir, { recursive: true });
  const src = path.join(dir, entry.file);
  const dst = path.join(adir, entry.file);
  if (existsSync(src)) renameSync(src, dst);
  const log = path.join(adir, "index.json");
  let rows: ArchivedExperience[] = [];
  if (existsSync(log)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(log, "utf-8"));
      if (Array.isArray(parsed)) rows = parsed as ArchivedExperience[];
    } catch {
      quarantine(log);
    }
  }
  rows.push({
    id: entry.id,
    title: entry.title,
    file: entry.file,
    kind: normalizeKind(entry.kind),
    tags: entry.tags,
    createdAt: entry.createdAt,
    retiredAt: Date.now(),
    retiredReason: reason,
  });
  writeFileSync(log, JSON.stringify(rows.slice(-MAX_ARCHIVE), null, 2));
}

/** 容量淘汰：超出上限时按**价值分最低**移入档案（protect 里的条目永不被淘汰） */
function trimCapacity(
  dir: string,
  scope: ExperienceScope,
  projectPath: string | undefined,
  items: ExperienceIndexEntry[],
  protect: Set<string>,
): ExperienceIndexEntry[] {
  if (items.length <= MAX_ITEMS) return items;
  const ranked = items
    .map((e, i) => ({ i, score: valueScore(e, scope) }))
    .filter((r) => !protect.has(items[r.i]!.id))
    .sort((a, b) => a.score - b.score);
  const drop = new Set(ranked.slice(0, items.length - MAX_ITEMS).map((r) => r.i));
  for (const e of items.filter((_, i) => drop.has(i))) {
    moveToArchive(scope, projectPath, e, `容量淘汰（${MAX_ITEMS} 条上限，价值分最低）`);
  }
  return items.filter((_, i) => !drop.has(i));
}

/** 追加一条经验：写原文文件 + 登记索引。返回落库的索引条目与它的作用域 */
export function appendExperience(
  input: { title: string; body: string; tags?: string[]; kind?: ExperienceKind },
  target: { scope?: ExperienceScope; projectPath?: string },
): { entry: ExperienceIndexEntry; scope: ExperienceScope } {
  const scope: ExperienceScope = target.scope === "global" || !target.projectPath ? "global" : "project";
  const dir = storeDir(scope, target.projectPath);
  const id = randomUUID();
  const now = Date.now();
  const entry: ExperienceIndexEntry = {
    id,
    title: input.title.trim().slice(0, TITLE_MAX),
    file: makeFileName(id, input.title.trim()),
    tags: [...new Set((input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))],
    kind: normalizeKind(input.kind),
    createdAt: now,
    updatedAt: now,
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, entry.file), renderBody(entry.title, input.body, entry));
  saveIndex(dir, trimCapacity(dir, scope, target.projectPath, [...loadIndex(dir), entry], new Set([entry.id])));
  return { entry, scope };
}

function patchEntry(entry: ExperienceIndexEntry, patch: { title?: string; tags?: string[]; kind?: ExperienceKind }): void {
  if (patch.title !== undefined && patch.title.trim()) entry.title = patch.title.trim().slice(0, TITLE_MAX);
  if (patch.tags !== undefined) entry.tags = [...new Set(patch.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (patch.kind !== undefined) entry.kind = normalizeKind(patch.kind);
  entry.updatedAt = Date.now();
}

/** 改写已有条目（纠错/补全/合并）：正文重写文件、索引同步；作用域不变（换作用域用 moveExperience） */
export function updateExperience(
  projectPath: string | undefined,
  ref: string,
  patch: { title?: string; body?: string; tags?: string[]; kind?: ExperienceKind },
): { ok: true; entry: ExperienceIndexEntry } | { ok: false; error: string } {
  const found = resolveExperience(projectPath, ref);
  if (!found.ok) return { ok: false, error: resolveErrorText(ref, found) };
  const items = loadIndex(found.dir);
  const hit = items.find((e) => e.id === found.entry.id);
  if (!hit) return { ok: false, error: `未找到经验 ${shortId(ref)}` };
  patchEntry(hit, patch);
  if (patch.body !== undefined) {
    writeFileSync(path.join(found.dir, hit.file), renderBody(hit.title, patch.body, hit));
  } else if (patch.title !== undefined) {
    // 只改标题也要刷新原文里的标题行（正文保持不变）
    const old = readExperienceBody(found.entry.scope, projectPath, hit);
    if (old !== null) writeFileSync(path.join(found.dir, hit.file), renderBody(hit.title, stripHeader(old), hit));
  }
  saveIndex(found.dir, items);
  return { ok: true, entry: hit };
}

/** 去掉原文文件的首行标题与尾部元信息注释，取回纯正文 */
export function stripHeader(raw: string): string {
  return raw
    .replace(/^#\s+.*\n+/, "")
    .replace(/\n*<!--\s*id\s[^>]*-->\s*$/m, "")
    .trim();
}

/** 移动条目到另一作用域：原文文件与索引项一起搬，保留 id 与计数（不留双份） */
export function moveExperience(
  projectPath: string | undefined,
  ref: string,
  targetScope: ExperienceScope,
): { ok: true; entry: ExperienceIndexEntry; scope: ExperienceScope } | { ok: false; error: string } {
  const found = resolveExperience(projectPath, ref);
  if (!found.ok) return { ok: false, error: resolveErrorText(ref, found) };
  if (!projectPath && targetScope === "project") return { ok: false, error: "当前会话没有项目路径，无法移到项目库" };
  if (found.entry.scope === targetScope) return { ok: true, entry: found.entry, scope: targetScope };
  const toDir = storeDir(targetScope, projectPath);
  mkdirSync(toDir, { recursive: true });
  const src = path.join(found.dir, found.entry.file);
  // 写序：先搬原文、再登记目标库、最后从源库摘掉——任一步失败最多留一份副本，不会两边都丢
  if (existsSync(src)) renameSync(src, path.join(toDir, found.entry.file));
  const moved: ExperienceIndexEntry = { ...found.entry, updatedAt: Date.now() };
  delete (moved as Partial<ExperienceHit>).scope;
  delete (moved as Partial<ExperienceHit>).excerpt;
  saveIndex(toDir, trimCapacity(toDir, targetScope, projectPath, [...loadIndex(toDir), moved], new Set([moved.id])));
  saveIndex(found.dir, loadIndex(found.dir).filter((e) => e.id !== moved.id));
  return { ok: true, entry: moved, scope: targetScope };
}

/** 退役（删除）一批条目：原文与理由进 archive（可回溯），不弹确认 */
export function retireExperiences(
  projectPath: string | undefined,
  refs: string[],
  reason: string,
): { retired: Array<{ id: string; title: string; scope: ExperienceScope }>; failures: Array<{ ref: string; error: string }> } {
  const retired: Array<{ id: string; title: string; scope: ExperienceScope }> = [];
  const failures: Array<{ ref: string; error: string }> = [];
  for (const ref of refs) {
    const found = resolveExperience(projectPath, ref);
    if (!found.ok) {
      failures.push({ ref, error: resolveErrorText(ref, found) });
      continue;
    }
    moveToArchive(found.entry.scope, projectPath, found.entry, reason.trim() || "未给理由");
    // 两个库都按 id 摘一遍：同 id 双份（手工拷贝会产生）只摘一份会让条目继续出现在检索与注入里
    for (const { dir } of listStoreDirs(projectPath)) {
      const items = loadIndex(dir);
      const next = items.filter((e) => e.id !== found.entry.id);
      if (next.length !== items.length) saveIndex(dir, next);
    }
    retired.push({ id: found.entry.id, title: found.entry.title, scope: found.entry.scope });
  }
  return { retired, failures };
}

// ── 项目技术栈探测（决定带标签的条目是否该出现在本项目的注入里） ──

function readIfExists(p: string): string {
  return existsSync(p) ? readFileSync(p, "utf-8") : "";
}

const PKG_KEYWORDS: Array<[RegExp, string]> = [
  [/(^|[^a-z])react([^a-z]|$)/i, "react"],
  [/(^|[^a-z])vue([^a-z]|$)/i, "vue"],
  [/svelte/i, "svelte"],
  [/(^|[^a-z])next([^a-z]|$)/i, "nextjs"],
  [/nuxt/i, "nuxt"],
  [/electron/i, "electron"],
  [/vite/i, "vite"],
  [/tailwind/i, "tailwind"],
  [/typescript/i, "typescript"],
  [/express/i, "express"],
  [/nestjs/i, "nestjs"],
];

/** 当前项目的技术栈/平台标签（与条目 tags 取交集）——启发式：读标志文件 + 关键词，不做依赖解析 */
export function detectProjectStacks(projectPath?: string): string[] {
  if (!projectPath) return [];
  const tags = new Set<string>();
  if (process.platform === "darwin") tags.add("macos");
  if (process.platform === "win32") tags.add("windows");
  if (process.platform === "linux") tags.add("linux");

  const has = (f: string): boolean => existsSync(path.join(projectPath, f));
  const read = (f: string): string => readIfExists(path.join(projectPath, f));

  const pkg = read("package.json");
  if (pkg) {
    tags.add("node");
    for (const [re, tag] of PKG_KEYWORDS) if (re.test(pkg)) tags.add(tag);
  }
  if (has("pubspec.yaml")) {
    tags.add("flutter");
    tags.add("dart");
  }
  if (has("pom.xml")) {
    tags.add("java");
    tags.add("maven");
    if (/spring/i.test(read("pom.xml"))) tags.add("spring");
  }
  if (has("build.gradle") || has("build.gradle.kts")) {
    tags.add("gradle");
    tags.add("java");
    const g = read("build.gradle") + read("build.gradle.kts");
    if (/kotlin/i.test(g)) tags.add("kotlin");
    if (/android/i.test(g)) tags.add("android");
  }
  if (has("Cargo.toml")) tags.add("rust");
  if (has("go.mod")) tags.add("go");
  if (has("requirements.txt") || has("pyproject.toml") || has("setup.py")) {
    tags.add("python");
    const py = read("requirements.txt") + read("pyproject.toml");
    if (/django/i.test(py)) tags.add("django");
    if (/flask/i.test(py)) tags.add("flask");
    if (/fastapi/i.test(py)) tags.add("fastapi");
  }
  if (has("composer.json")) tags.add("php");
  if (has("Gemfile")) tags.add("ruby");
  if (has("Package.swift")) {
    tags.add("swift");
    tags.add("apple");
  }
  return [...tags];
}

// ── 检索（索引 + 原文全文，返回命中片段供模型判断要不要读原文） ──

const KIND_LABEL_ALL = KIND_LABEL;
/** 查询切词：按空白与常见中英文标点切分，丢弃长度 < 2 的片段、去重、限 12 个；
 *  无空格的中文长串（≥4 字）额外补 2-gram（「图标圆角」若当成一个词，命中不到分开写的条目）。 */
const TOKEN_SEP = /[\s,，、。;；:：!！?？\\|(){}'"“”‘’~@#$%^&*+=<>—–_\-/\[\]]+/;
const CJK_RUN = /[\u4e00-\u9fff]{4,}/g;

function tokenize(query: string): string[] {
  const tokens = query.toLowerCase().split(TOKEN_SEP).map((t) => t.trim()).filter((t) => t.length >= 2);
  const grams: string[] = [];
  for (const run of query.match(CJK_RUN) ?? []) {
    for (let i = 0; i + 2 <= run.length; i += 1) grams.push(run.slice(i, i + 2));
  }
  return [...new Set([...tokens, ...grams])].slice(0, 12);
}

/** 关键词检索：标题/标签命中权重 2、正文命中权重 1；按总分排序（同分看命中次数与更新时间）。
 *  opts.touch=true 时命中条目记 usageCount/lastUsedAt——仅供模型主动检索的工具使用
 *  （自动回递等内部调用不 touch，防自增强反馈环）；计数写盘失败不影响检索结果。 */
export function searchExperiences(
  query: string,
  projectPath?: string,
  opts?: { touch?: boolean },
): { hits: ExperienceHit[]; total: number } {
  const q = query.trim().toLowerCase();
  if (!q) return { hits: [], total: 0 };
  const parsed = tokenize(q);
  const tokens = parsed.length > 0 ? parsed : [q]; // 单字查询/无有效词 → 退回整串子串匹配
  const scored = loadScoped(projectPath)
    .map((e) => {
      const head = `${e.title} ${e.tags.join(" ")}`.toLowerCase();
      const raw = readExperienceBody(e.scope, projectPath, e);
      const body = raw === null ? "" : stripHeader(raw);
      const bodyLower = body.toLowerCase();
      let n = 0;
      let at = -1;
      for (const t of tokens) {
        if (head.includes(t)) {
          n += 2;
          continue;
        }
        const i = bodyLower.indexOf(t);
        if (i >= 0) {
          n += 1;
          if (at < 0) at = i;
        }
      }
      const excerpt = at >= 0 ? body.replace(/\s+/g, " ").slice(Math.max(0, at - 60), at + 100).trim() : undefined;
      return { e, n, excerpt };
    })
    .filter((s) => s.n > 0)
    .sort((a, b) => b.n - a.n || (b.e.usageCount ?? 0) - (a.e.usageCount ?? 0) || b.e.updatedAt - a.e.updatedAt);
  const hits = scored.slice(0, SEARCH_LIMIT).map((s) => ({ ...s.e, excerpt: s.excerpt }));
  if (hits.length > 0 && opts?.touch) touchHits(projectPath, new Set(hits.map((h) => h.id)));
  return { hits, total: scored.length };
}

/** 命中计数落盘（两个库各扫一遍；写盘失败只记日志，不连坐检索） */
function touchHits(projectPath: string | undefined, ids: Set<string>): void {
  const now = Date.now();
  for (const { dir } of listStoreDirs(projectPath)) {
    try {
      const items = loadIndex(dir);
      let changed = false;
      for (const e of items) {
        if (ids.has(e.id)) {
          e.usageCount = (e.usageCount ?? 0) + 1;
          e.lastUsedAt = now;
          changed = true;
        }
      }
      if (changed) saveIndex(dir, items);
    } catch (e) {
      console.warn("[experience] 命中计数写盘失败（不影响检索结果）:", (e as Error).message);
    }
  }
}

// ── 注入（只给索引：标题 + 文件名 + 计数；正文由模型按需 read） ──

function compact(text: string, limit: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= limit ? t : `${t.slice(0, limit - 1)}…`;
}

function stampShort(ts: number): string {
  return new Date(ts).toISOString().slice(5, 10); // MM-DD
}

function bumpInjected(hits: ExperienceHit[], projectPath?: string): void {
  const now = Date.now();
  const byDir = new Map<string, Set<string>>();
  for (const h of hits) {
    const dir = storeDir(h.scope, projectPath);
    byDir.set(dir, new Set([...(byDir.get(dir) ?? []), h.id]));
  }
  for (const [dir, ids] of byDir) {
    try {
      const items = loadIndex(dir);
      let changed = false;
      for (const e of items) {
        if (ids.has(e.id)) {
          e.injectedCount = (e.injectedCount ?? 0) + 1;
          e.lastInjectedAt = now;
          changed = true;
        }
      }
      if (changed) saveIndex(dir, items);
    } catch (e) {
      console.warn("[experience] 送达计数写盘失败（不影响注入）:", (e as Error).message);
    }
  }
}

/** 体检候选：只做「够格被评估」的下限筛选，价值判断交给模型。
 *  三条不依赖命中数据的规则：原文缺失（索引指向的文件没了）、标题高度的重复组、超期临时经验。 */
export function buildReviewCandidates(projectPath?: string): ExperienceReviewItem[] {
  const all = loadScoped(projectPath);
  const missing: ExperienceReviewItem[] = [];
  const stale: ExperienceReviewItem[] = [];
  for (const e of all) {
    if (!existsSync(bodyPath(e.scope, projectPath, e))) {
      missing.push({ shortIds: [shortId(e.id)], reason: `原文缺失（${e.file}）：${e.title}` });
    }
    if (normalizeKind(e.kind) !== "temporary") continue;
    const days = Math.floor((Date.now() - e.updatedAt) / 86400000);
    if (days >= TEMPORARY_STALE_DAYS) stale.push({ shortIds: [shortId(e.id)], reason: `临时经验已 ${days} 天未更新：${e.title}` });
  }
  const groups = new Map<string, ExperienceHit[]>();
  for (const e of all) {
    const key = e.title.replace(/\s+/g, "").slice(0, 10);
    if (key.length < 6) continue; // 标题太短不足以判重
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const dupes: ExperienceReviewItem[] = [];
  for (const [, list] of groups) {
    if (list.length < 2) continue;
    dupes.push({
      shortIds: list.map((e) => shortId(e.id)),
      reason: `标题疑似重复：「${list[0]!.title}」等 ${list.length} 条`,
    });
  }
  const half = Math.ceil(REVIEW_LIMIT / 2);
  return [...missing.slice(0, half), ...dupes.slice(0, half), ...stale.slice(0, half)].slice(0, REVIEW_LIMIT);
}

/** 会话启动注入：**只有索引**（标题 + 文件名 + 计数），分三桶——本项目条目、全局通用（无 tags）、
 *  全局技术栈匹配（tags 与当前项目技术栈有交集）。正文一律不给：模型判断相关时按「目录 + file 名」read 原文。 */
export function buildExperienceInjection(projectPath?: string): string {
  const all = loadScoped(projectPath);
  if (all.length === 0) return "";
  const stacks = detectProjectStacks(projectPath);
  const byScore = (a: ExperienceHit, b: ExperienceHit): number => valueScore(b, b.scope) - valueScore(a, a.scope) || b.updatedAt - a.updatedAt;
  const project = all.filter((e) => e.scope === "project").sort(byScore).slice(0, INJECT_PROJECT_LIMIT);
  const common = all.filter((e) => e.scope === "global" && e.tags.length === 0).sort(byScore).slice(0, INJECT_COMMON_LIMIT);
  const matched = all
    .filter((e) => e.scope === "global" && e.tags.length > 0 && e.tags.some((t) => stacks.includes(t)))
    .sort(byScore)
    .slice(0, INJECT_STACK_LIMIT);
  const picked = [...project, ...common, ...matched];

  const line = (e: ExperienceHit): string =>
    `- ${compact(e.title, 50)} — file ${e.file}（${e.scope === "project" ? "项目" : "全局"}·${KIND_LABEL_ALL[normalizeKind(e.kind)]}·使用${e.usageCount ?? 0}·更新 ${stampShort(e.updatedAt)}）`;

  const dirs = listStoreDirs(projectPath);
  const parts: string[] = [
    "历史沉淀经验索引（模型上下文有限，这里只给索引；判断与本任务相关时，用 read 读原文，路径 = 目录 + file 名）",
    ...dirs.map((d) => `- ${d.scope === "project" ? "本项目" : "本机/通用"}目录：${d.dir}`),
  ];
  if (project.length > 0) parts.push(`【本项目 ${project.length} 条】`, ...project.map(line));
  if (common.length > 0) parts.push(`【全局通用·常驻 ${common.length} 条】`, ...common.map(line));
  if (matched.length > 0) {
    parts.push(`【技术栈匹配（${stacks.filter((t) => matched.some((m) => m.tags.includes(t))).join("/")}）${matched.length} 条】`, ...matched.map(line));
  }
  if (picked.length === 0) parts.push("（本会话没有匹配到该注入的条目；需要时可 search_experiences 检索）");

  bumpInjected(picked, projectPath);

  const candidates = buildReviewCandidates(projectPath);
  const review = candidates.length > 0
    ? `\n【待体检 ${candidates.length} 条】可能已过时或重复，判断后可用 retire_experiences 退役，或用 learn 带 updateId 改写：\n`
      + candidates.map((c) => `- ${c.shortIds.join("、")}：${c.reason}`).join("\n")
    : "";
  return `${parts.join("\n")}${review}`;
}
