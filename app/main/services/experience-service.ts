/**
 * Experience Service — AI 自沉淀经验库。
 *
 * 存储：全局 ~/.easymint/experiences.json + 项目级 <project>/.easymint/experiences.json。
 * 风格对齐 session-service 的 JSON 元数据文件（同步 readFileSync/writeFileSync，无数据库）。
 *
 * 治理口径（2026-09-12 定案）：
 *  - **作用域由所在文件决定，不存字段**——避免「字段与位置不一致」的第二真相源
 *  - `kind` 决定注入标记与体检规则：principle（跨项目原则）/ convention（项目约定）/ temporary（临时）
 *  - 条目上限 200/库，超出按**价值分**淘汰最低分（kind 权重 + 命中 + 新鲜度），不再按「最旧」
 *  - 退役（删除）不弹确认：模型自主判断，原文进同目录 experiences-archive.json 可回溯
 *  - 经验非真相源：读失败返回空数组（可丢失重建，同 skill-registry 原则）
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

export type ExperienceKind = "principle" | "convention" | "temporary";
/** 作用域 = 条目落在哪个库（项目级 / 全局） */
export type ExperienceScope = "project" | "global";

export interface ExperienceEntry {
  id: string;
  memory: string;
  context?: string;
  /** 时效性质：principle 跨项目原则 / convention 项目约定 / temporary 临时（缺省按 convention） */
  kind?: ExperienceKind;
  /** 写入时会话所属项目路径——**仅溯源**，不参与作用域判定（作用域看落在哪个文件） */
  project?: string;
  createdAt: number;
  /** 最近一次改写（纠错/补全/移动）时间；新鲜度按它算 */
  updatedAt?: number;
  /** search_experiences 命中次数（模型主动检索 = 经验被实际用上的证据；注入不计，防自增强） */
  usageCount?: number;
  /** 最近一次被 search 命中的时间 */
  lastUsedAt?: number;
  /** 被注入进系统提示词（送达模型上下文）的次数 */
  injectedCount?: number;
  lastInjectedAt?: number;
}

/** 检索/注入结果条目：带上来源作用域（仅内存标注，不落盘） */
export interface ExperienceHit extends ExperienceEntry {
  scope: ExperienceScope;
}

/** 档案条目：退役时追加，保留原文与理由，便于误删回溯 */
export interface ArchivedExperience extends ExperienceEntry {
  retiredAt: number;
  retiredReason: string;
}

/** 体检候选（会话启动时交给模型判断的「可能该处理」条目） */
export interface ExperienceReviewItem {
  /** 相关条目的短 id（重复项会给出整组） */
  shortIds: string[];
  reason: string;
}

const GLOBAL_EXPERIENCES = path.join(os.homedir(), ".easymint", "experiences.json");
const MAX_ENTRIES = 200;
const MAX_ARCHIVE_ENTRIES = 200;
const SEARCH_LIMIT = 10;
const REVIEW_LIMIT = 5;
/** 短 id 长度：注入块与检索输出只暴露这一截（完整 uuid 另存；解析按前缀唯一匹配） */
const SHORT_ID_LEN = 8;
/** 注入正文上限（首段 + 末段拼接，保住「怎么做」与「怎么验证」） */
const INJECT_TEXT_LIMIT = 200;
/** 临时经验超过该天数即进体检候选 */
const TEMPORARY_STALE_DAYS = 14;

function projectExperiencesFile(projectPath: string): string {
  return path.join(projectPath, ".easymint", "experiences.json");
}

/** 短 id：给模型的引用形式（8 字符丢碰撞概率极低，冲突时解析会要求更长前缀） */
export function shortId(id: string): string {
  return id.slice(0, SHORT_ID_LEN);
}

/** 作用域 → 文件；project 作用域但无项目路径（无项目工作区）→ 退回全局，不静默丢弃 */
function storeFile(scope: ExperienceScope, projectPath?: string): string {
  return scope === "project" && projectPath ? projectExperiencesFile(projectPath) : GLOBAL_EXPERIENCES;
}

/** 档案文件绝对路径（退役/淘汰留档用；工具把它回给模型，便于回溯） */
export function archivePath(scope: ExperienceScope, projectPath?: string): string {
  return storeFile(scope, projectPath).replace(/experiences\.json$/, "experiences-archive.json");
}

/** 损坏文件改名存证（不静默丢弃——库文件也是用户积累，重建前先留底） */
function quarantine(file: string): void {
  try {
    renameSync(file, `${file}.corrupt-${Date.now()}`);
    console.warn(`[experience] 文件损坏，已改名存证后重建: ${file}`);
  } catch (e) {
    // 改名失败（权限/只读卷）不阻断主流程——但会把失败原因写进日志，不静默
    console.warn(`[experience] 文件损坏且改名存证失败（继续按空处理）: ${file}`, (e as Error).message);
  }
}

function loadFile(file: string): ExperienceEntry[] {
  if (!existsSync(file)) return [];
  try {
    const data: unknown = JSON.parse(readFileSync(file, "utf-8"));
    if (!Array.isArray(data)) return [];
    return data.filter(
      (e): e is ExperienceEntry =>
        !!e && typeof e === "object" && typeof (e as ExperienceEntry).memory === "string" && (e as ExperienceEntry).memory.trim().length > 0,
    );
  } catch {
    // 读路径遇到损坏就地留底：否则下一次写入会把整库（最多 200 条）静默覆盖掉
    quarantine(file);
    return [];
  }
}

function saveFile(file: string, entries: unknown[]): void {
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // 原子写：先写临时文件再 rename——进程崩溃在 writeFileSync 中途不会留下半截 JSON
  // （loadFile 对损坏按空数组处理，非原子写会让 200 条经验在下次写入时被静默清空）
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(entries, null, 2));
  renameSync(tmp, file);
}

/** 当前会话可见的两个库文件（项目库可能不存在） */
function storeFiles(projectPath?: string): string[] {
  return projectPath ? [projectExperiencesFile(projectPath), GLOBAL_EXPERIENCES] : [GLOBAL_EXPERIENCES];
}

/** 两个库一并读出，标注来源（读取侧唯一入口——作用域只能从这里得到） */
function loadScoped(projectPath?: string): ExperienceHit[] {
  const project = projectPath ? loadFile(projectExperiencesFile(projectPath)) : [];
  return [
    ...project.map((e) => ({ ...e, scope: "project" as const })),
    ...loadFile(GLOBAL_EXPERIENCES).map((e) => ({ ...e, scope: "global" as const })),
  ];
}

/** 归一化 kind（老条目缺省 convention） */
export function normalizeKind(kind: unknown): ExperienceKind {
  return kind === "principle" || kind === "temporary" ? kind : "convention";
}

/** 价值分：kind 权重 + 命中次数 + 新鲜度 + 项目级加成（注入排序与容量淘汰共用） */
function valueScore(e: ExperienceEntry, scope: ExperienceScope): number {
  const kind = normalizeKind(e.kind);
  const kindW = kind === "principle" ? 3 : kind === "temporary" ? 1 : 2;
  const used = Math.min(e.usageCount ?? 0, 4);
  const ageDays = (Date.now() - (e.updatedAt ?? e.createdAt)) / 86400000;
  const fresh = ageDays < 30 ? 2 : ageDays < 90 ? 1 : 0;
  return kindW + used + fresh + (scope === "project" ? 1 : 0);
}

/** 按 ref（完整 uuid 或 ≥8 字符前缀）定位条目；前缀命中多条时报歧义而不是猜 */
export type ResolveResult =
  | { ok: true; entry: ExperienceHit; file: string }
  | { ok: false; reason: "not_found" | "too_short" | "ambiguous"; count?: number };

export function resolveExperience(projectPath: string | undefined, ref: string): ResolveResult {
  const id = ref.trim();
  if (!id) return { ok: false, reason: "not_found" };
  const all = loadScoped(projectPath);
  const exact = all.filter((e) => e.id === id);
  if (exact.length > 0) return { ok: true, entry: exact[0]!, file: storeFile(exact[0]!.scope, projectPath) };
  if (id.length < SHORT_ID_LEN) return { ok: false, reason: "too_short" };
  const prefixed = all.filter((e) => e.id.startsWith(id));
  if (prefixed.length === 0) return { ok: false, reason: "not_found" };
  if (prefixed.length > 1) return { ok: false, reason: "ambiguous", count: prefixed.length };
  return { ok: true, entry: prefixed[0]!, file: storeFile(prefixed[0]!.scope, projectPath) };
}

/** 容量淘汰：超出上限时丢**价值分最低**的（不再按最旧）——保持数组原顺序，只筛掉落选者。
 *  `protect` 里的条目永不被淘汰：本次新增/刚移动进来的条目若被自身写入触发的淘汰立即丢掉，
 *  会表现为「工具报成功但条目没了」（移动场景还会两边都丢）。 */
function evictByScore(entries: ExperienceEntry[], scope: ExperienceScope, protect = new Set<string>()): {
  kept: ExperienceEntry[];
  evicted: ExperienceEntry[];
} {
  if (entries.length <= MAX_ENTRIES) return { kept: entries, evicted: [] };
  const dropCount = entries.length - MAX_ENTRIES;
  const ranked = entries
    .map((e, i) => ({ i, score: valueScore(e, scope) }))
    .filter((r) => !protect.has(entries[r.i]!.id))
    .sort((a, b) => a.score - b.score);
  const drop = new Set(ranked.slice(0, dropCount).map((r) => r.i));
  return {
    kept: entries.filter((_, i) => !drop.has(i)),
    evicted: entries.filter((_, i) => drop.has(i)),
  };
}

/** 容量淘汰的条目也进档案（与退役同一口径：可回溯，理由写「容量淘汰」） */
function archiveEvicted(evicted: ExperienceEntry[], scope: ExperienceScope, projectPath?: string): void {
  if (evicted.length === 0) return;
  const af = archivePath(scope, projectPath);
  const stamp = Date.now();
  const rows: ArchivedExperience[] = evicted.map((e) => ({
    ...e,
    retiredAt: stamp,
    retiredReason: `容量淘汰（${MAX_ENTRIES} 条上限，价值分最低）`,
  }));
  saveFile(af, [...loadArchive(af), ...rows].slice(-MAX_ARCHIVE_ENTRIES));
}

/** 追加一条经验，返回落库条目与它的实际作用域（project 作用域无项目路径时兑到全局） */
export function appendExperience(
  input: { memory: string; context?: string; kind?: ExperienceKind },
  target: { scope?: ExperienceScope; projectPath?: string },
): { entry: ExperienceEntry; scope: ExperienceScope } {
  const scope: ExperienceScope = target.scope === "global" ? "global" : target.projectPath ? "project" : "global";
  const entry: ExperienceEntry = {
    id: randomUUID(),
    memory: input.memory.trim(),
    context: input.context?.trim() || undefined,
    kind: normalizeKind(input.kind),
    project: target.projectPath || undefined,
    createdAt: Date.now(),
  };
  const file = storeFile(scope, target.projectPath);
  const { kept, evicted } = evictByScore([...loadFile(file), entry], scope, new Set([entry.id]));
  archiveEvicted(evicted, scope, target.projectPath);
  saveFile(file, kept);
  return { entry, scope };
}

function patchEntry(entry: ExperienceEntry, patch: { memory?: string; context?: string; kind?: ExperienceKind }): void {
  const m = patch.memory?.trim();
  if (m !== undefined && m.length > 0) entry.memory = m;
  if (patch.context !== undefined) entry.context = patch.context.trim() || undefined;
  if (patch.kind !== undefined) entry.kind = normalizeKind(patch.kind);
  entry.updatedAt = Date.now();
}

/** 改写已有条目（纠错/补全/合并）；作用域不变（改作用域用 moveExperience） */
export function updateExperience(
  projectPath: string | undefined,
  ref: string,
  patch: { memory?: string; context?: string; kind?: ExperienceKind },
): { ok: true; entry: ExperienceEntry } | { ok: false; error: string } {
  const found = resolveExperience(projectPath, ref);
  if (!found.ok) return { ok: false, error: resolveErrorText(ref, found) };
  const entries = loadFile(found.file);
  const hit = entries.find((e) => e.id === found.entry.id);
  if (!hit) return { ok: false, error: `未找到经验 ${shortId(ref)}` };
  patchEntry(hit, patch);
  saveFile(found.file, entries);
  return { ok: true, entry: hit };
}

/** 移动条目到另一作用域（项目 ⇄ 全局）：保留 id 与计数，避免「复制出两份」的不一致 */
export function moveExperience(
  projectPath: string | undefined,
  ref: string,
  targetScope: ExperienceScope,
): { ok: true; entry: ExperienceEntry; scope: ExperienceScope } | { ok: false; error: string } {
  const found = resolveExperience(projectPath, ref);
  if (!found.ok) return { ok: false, error: resolveErrorText(ref, found) };
  if (!projectPath && targetScope === "project") {
    return { ok: false, error: "当前会话没有项目路径，无法移到项目库（全局库不变）" };
  }
  if (found.entry.scope === targetScope) return { ok: true, entry: found.entry, scope: targetScope };
  const moved: ExperienceEntry = { ...found.entry, updatedAt: Date.now() };
  delete (moved as Partial<ExperienceHit>).scope;
  // 写序：**先写目标库、再从源库删**——反过来一旦目标写入失败，条目就两边都没了（丢数据）；
  // 这个顺序最坏情况是两份（可被发现、可重跑）；失败时先回滚已写的目标
  const to = storeFile(targetScope, projectPath);
  const { kept, evicted } = evictByScore([...loadFile(to), moved], targetScope, new Set([moved.id]));
  archiveEvicted(evicted, targetScope, projectPath);
  saveFile(to, kept);
  try {
    saveFile(found.file, loadFile(found.file).filter((e) => e.id !== found.entry.id));
  } catch (e) {
    saveFile(to, loadFile(to).filter((x) => x.id !== found.entry.id));
    return { ok: false, error: `写入目标库后删除源条目失败，已回滚：${(e as Error).message}` };
  }
  return { ok: true, entry: moved, scope: targetScope };
}

function resolveErrorText(ref: string, r: { reason: "not_found" | "too_short" | "ambiguous"; count?: number }): string {
  if (r.reason === "too_short") return `id「${ref}」太短：至少给 ${SHORT_ID_LEN} 个字符（短 id 见检索结果或注入块）`;
  if (r.reason === "ambiguous") return `id「${ref}」命中 ${r.count ?? 2} 条，请给更长的 id`;
  return `未找到经验「${ref}」（可能已退役或被容量淘汰）`;
}

/** 档案读取：损坏时不静默清空——改名存证后再重开一份（档案是误删回溯的唯一依据） */
function loadArchive(file: string): ArchivedExperience[] {
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, "utf-8");
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter(Boolean) as ArchivedExperience[]) : [];
  } catch {
    try {
      renameSync(file, `${file}.corrupt-${Date.now()}`);
    } catch { /* 改名失败（如权限）不阻断——下面的覆盖仍会写入新档案 */ }
    console.warn(`[experience] 档案文件损坏，已改名存证后重建: ${file}`);
    return [];
  }
}

/** 退役（删除）一批条目：先留档、再从库中移除（反过来一旦档案写失败，原文就永远没了），不弹确认 */
export function retireExperiences(
  projectPath: string | undefined,
  refs: string[],
  reason: string,
): { retired: Array<{ id: string; memory: string; scope: ExperienceScope }>; failures: Array<{ ref: string; error: string }> } {
  const retired: Array<{ id: string; memory: string; scope: ExperienceScope }> = [];
  const failures: Array<{ ref: string; error: string }> = [];
  const stamp = Date.now();
  // 逐个处理：一个 ref 解析失败不影响其余
  for (const ref of refs) {
    const found = resolveExperience(projectPath, ref);
    if (!found.ok) {
      failures.push({ ref, error: resolveErrorText(ref, found) });
      continue;
    }
    const archived: ArchivedExperience = { ...found.entry, retiredAt: stamp, retiredReason: reason.trim() || "未给理由" };
    delete (archived as Partial<ExperienceHit>).scope;
    const af = archivePath(found.entry.scope, projectPath);
    saveFile(af, [...loadArchive(af), archived].slice(-MAX_ARCHIVE_ENTRIES));
    // 两个库都按 id 清一遍：同 id 双份（手工拷贝/移动中途崩溃会产生）只删一份，
    // 条目会继续出现在检索与注入里，模型却以为已退役
    for (const file of storeFiles(projectPath)) {
      const entries = loadFile(file);
      const next = entries.filter((e) => e.id !== found.entry.id);
      if (next.length !== entries.length) saveFile(file, next);
    }
    retired.push({ id: found.entry.id, memory: found.entry.memory, scope: found.entry.scope });
  }
  return { retired, failures };
}

const KIND_LABEL: Record<ExperienceKind, string> = { principle: "原则", convention: "约定", temporary: "临时" };

/** 时效性质的中文标签（注入与检索输出共用） */
export function kindLabel(kind: unknown): string {
  return KIND_LABEL[normalizeKind(kind)];
}

/** 查询切词：按空白与常见中英文标点切分，丢弃长度 < 2 的片段、去重、限 12 个；
 *  对**无空格的中文长串**（≥4 字）额外补 2-gram——「图标圆角」这种写法若只当成一个词，
 *  仍等价于整串子串匹配，命中不到「图标两套口径」与「圆角」分开写的条目。 */
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

/** 关键词检索：按**命中词数**排序（全词命中优先），其次命中次数与时间；上限 10 条。
 *  opts.touch=true 时命中条目记 usageCount/lastUsedAt 并落盘——仅供模型主动检索的
 *  search_experiences 工具使用；自动回递/注入等内部调用不 touch（防自增强反馈环）。 */
export function searchExperiences(
  query: string,
  projectPath?: string,
  opts?: { touch?: boolean },
): { hits: ExperienceHit[]; total: number } {
  const q = query.trim().toLowerCase();
  if (!q) return { hits: [], total: 0 };
  const parsed = tokenize(q);
  // 单字查询/无有效词 → 退回整串子串匹配（保持既有行为，不静默变空）
  const tokens = parsed.length > 0 ? parsed : [q];
  const scored = loadScoped(projectPath)
    .map((e) => {
      const text = `${e.memory} ${e.context ?? ""}`.toLowerCase();
      return { e, n: tokens.filter((t) => text.includes(t)).length };
    })
    .filter((s) => s.n > 0)
    .sort((a, b) => b.n - a.n || (b.e.usageCount ?? 0) - (a.e.usageCount ?? 0) || b.e.createdAt - a.e.createdAt);
  const hits = scored.slice(0, SEARCH_LIMIT).map((s) => s.e);
  if (hits.length > 0 && opts?.touch) touchHits(projectPath, new Set(hits.map((e) => e.id)));
  return { hits, total: scored.length };
}

/** 命中计数落盘：项目级 + 全局两库各扫一遍（命中条目可能来自任一库） */
function touchHits(projectPath: string | undefined, ids: Set<string>): void {
  const now = Date.now();
  const files: string[] = [];
  if (projectPath) files.push(projectExperiencesFile(projectPath));
  files.push(GLOBAL_EXPERIENCES);
  for (const file of files) {
    try {
      const entries = loadFile(file);
      let changed = false;
      for (const e of entries) {
        if (ids.has(e.id)) {
          e.usageCount = (e.usageCount ?? 0) + 1;
          e.lastUsedAt = now;
          changed = true;
        }
      }
      if (changed) saveFile(file, entries);
    } catch (e) {
      // 计数是辅助信息，写盘失败不得连坐检索本身（与 §2.1 的差别在此明确：
      // 这里不是「隐藏错误」，而是把失败降级为可见的日志，主路径继续）
      console.warn("[experience] 命中计数写盘失败（不影响检索结果）:", (e as Error).message);
    }
  }
}

/** 注入正文压缩：短则原样；长则「首段 + 末段」拼接——保住「怎么做」与「怎么验证」，
 *  而不是只截到问题描述就断（原来 slice(0,160) 会把结论整段丢掉） */
function compactMemory(memory: string, limit = INJECT_TEXT_LIMIT): string {
  const text = memory.replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  const half = Math.floor(limit / 2) - 1;
  return `${text.slice(0, half)}…${text.slice(-half)}`;
}

/** 送达计数（注入时调一次）：写盘失败不影响注入结果 */
function bumpInjected(hits: ExperienceHit[], projectPath?: string): void {
  const now = Date.now();
  const byScope = new Map<ExperienceScope, Set<string>>();
  for (const h of hits) byScope.set(h.scope, new Set([...(byScope.get(h.scope) ?? []), h.id]));
  for (const [scope, ids] of byScope) {
    try {
      const file = storeFile(scope, projectPath);
      const entries = loadFile(file);
      let changed = false;
      for (const e of entries) {
        if (ids.has(e.id)) {
          e.injectedCount = (e.injectedCount ?? 0) + 1;
          e.lastInjectedAt = now;
          changed = true;
        }
      }
      if (changed) saveFile(file, entries);
    } catch (e) {
      console.warn("[experience] 送达计数写盘失败（不影响注入）:", (e as Error).message);
    }
  }
}

/** 体检候选：只做「够格被评估」的下限筛选，价值判断交给模型（同 learn-gate 的哲学）。
 *  初版只启用两条不依赖命中数据的规则（超期临时、疑似重复）——命中类规则要等
 *  检索可用、usageCount 可信之后再启用，否则会拿不可信数据把好经验当垃圾清掉。
 *  候选行带正文摘录与作用域/时效：只给短 id 的话模型无法判断该改写还是退役。 */
export function buildReviewCandidates(projectPath?: string): ExperienceReviewItem[] {
  const all = loadScoped(projectPath);
  const summarize = (e: ExperienceHit): string =>
    `${shortId(e.id)}（${e.scope === "project" ? "项目" : "全局"}·${kindLabel(e.kind)}）${compactMemory(e.memory, 80)}`;

  const stale: ExperienceReviewItem[] = [];
  for (const e of all) {
    if (normalizeKind(e.kind) !== "temporary") continue;
    // 口径与 valueScore 一致：改写会把 updatedAt 刷新，否则「刚改成临时」会报「已 300 天」
    const days = Math.floor((Date.now() - (e.updatedAt ?? e.createdAt)) / 86400000);
    if (days >= TEMPORARY_STALE_DAYS) stale.push({ shortIds: [shortId(e.id)], reason: `临时经验已 ${days} 天未更新：${summarize(e)}` });
  }

  const groups = new Map<string, ExperienceHit[]>();
  for (const e of all) {
    // 取开头 12 字符作分组键：实测那两条重复经验（「永远不要怀疑用户使用旧代码（第 1/10 条…）」
    // 与「第 2/10 条…」）在第 16 字符处分叉，键取 40 字就抓不到；取 12 字（约一个完整分句）
    // 既能抓到，又不至于把开头相同的无关条目归为一组。
    const key = e.memory.replace(/\s+/g, " ").trim().slice(0, 12);
    if (key.length < 12) continue; // 开头太短不足以判重，不报
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const dupes: ExperienceReviewItem[] = [];
  for (const [, list] of groups) {
    if (list.length < 2) continue;
    dupes.push({
      shortIds: list.map((e) => shortId(e.id)),
      reason: `内容疑似重复（开头同为「${list[0]!.memory.replace(/\s+/g, " ").trim().slice(0, 12)}…」）：${list.map(summarize).join("；")}`,
    });
  }

  // 两类各留一半额度：否则临时条目多时重复组永远轮不上（反之一样）
  const half = Math.ceil(REVIEW_LIMIT / 2);
  return [...dupes.slice(0, half), ...stale.slice(0, half), ...dupes.slice(half), ...stale.slice(half)].slice(0, REVIEW_LIMIT);
}

/** 会话启动注入块：按价值分取 top-N + 标注作用域/时效/命中 + 短 id（供改写与退役引用），
 *  末尾附体检候选清单。 */
export function buildExperienceInjection(projectPath?: string, limit = 5): string {
  const all = loadScoped(projectPath);
  if (all.length === 0) return "";
  const sorted = [...all]
    .sort((a, b) => valueScore(b, b.scope) - valueScore(a, a.scope) || b.createdAt - a.createdAt)
    .slice(0, limit);
  const lines = sorted.map((e) => {
    const scopeLabel = e.scope === "project" ? "项目" : "全局";
    const used = e.usageCount ?? 0;
    return `- [${scopeLabel}·${KIND_LABEL[normalizeKind(e.kind)]}${used > 0 ? `·命中${used}` : ""}] ${compactMemory(e.memory)} [id: ${shortId(e.id)}]`;
  });
  bumpInjected(sorted, projectPath);
  const candidates = buildReviewCandidates(projectPath);
  const review = candidates.length > 0
    ? `\n\n【待体检 ${candidates.length} 条】可能已过时或重复，判断后可用 retire_experiences 退役，或用 learn 带 updateId 改写：\n`
      + candidates.map((c) => `- ${c.shortIds.join("、")}：${c.reason}`).join("\n")
    : "";
  return `历史沉淀经验（top ${sorted.length}，仅作背景参考；与本任务相关再复用，不必刻意使用）：\n${lines.join("\n")}${review}`;
}
