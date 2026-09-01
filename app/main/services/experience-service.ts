/**
 * Experience Service — AI 自沉淀经验库（期 3）。
 *
 * learn 工具的经验存储：全局 ~/.easymint/experiences.json + 项目级
 * <project>/.easymint/experiences.json。风格对齐 session-service 的 JSON
 * 元数据文件（同步 readFileSync/writeFileSync，无数据库）。
 *
 * 经验非真相源：读失败返回空数组（可丢失重建，同 skill-registry 原则）；
 * 条目上限 200/库，超出淘汰最旧防膨胀污染检索。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

export interface ExperienceEntry {
  id: string;
  memory: string;
  context?: string;
  /** 写入时会话所属项目路径（全局库中也标来源） */
  project?: string;
  createdAt: number;
  /** search_experiences 命中次数（模型主动检索 = 经验被实际用上的证据；自动注入/回递不计，防自增强） */
  usageCount?: number;
  /** 最近一次被 search 命中的时间 */
  lastUsedAt?: number;
}

const GLOBAL_EXPERIENCES = path.join(os.homedir(), ".easymint", "experiences.json");
const MAX_ENTRIES = 200;
const SEARCH_LIMIT = 10;

function projectExperiencesFile(projectPath: string): string {
  return path.join(projectPath, ".easymint", "experiences.json");
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
    // 损坏视为空（可重建）；下次写入整体覆盖
    return [];
  }
}

function saveFile(file: string, entries: ExperienceEntry[]): void {
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(entries, null, 2));
}

/** 追加一条经验；projectPath 有值写项目级、否则全局。返回带 id 的落库条目 */
export function appendExperience(input: { memory: string; context?: string }, projectPath?: string): ExperienceEntry {
  const entry: ExperienceEntry = {
    id: randomUUID(),
    memory: input.memory.trim(),
    context: input.context?.trim() || undefined,
    project: projectPath || undefined,
    createdAt: Date.now(),
  };
  const file = projectPath ? projectExperiencesFile(projectPath) : GLOBAL_EXPERIENCES;
  const entries = loadFile(file);
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  saveFile(file, entries);
  return entry;
}

/** 更新一条已有经验（合并/纠错/补全场景）：按 id 在项目级库（若有）与全局库中查找，
 *  命中即应用 patch（memory/context 覆盖，memory 清空则忽略）并落盘。返回更新后的条目或 null。 */
export function updateExperience(
  projectPath: string | undefined,
  id: string,
  patch: { memory?: string; context?: string },
): ExperienceEntry | null {
  const apply = (e: ExperienceEntry): boolean => {
    const m = patch.memory?.trim();
    if (m !== undefined && m.length > 0) e.memory = m;
    if (patch.context !== undefined) e.context = patch.context.trim() || undefined;
    return true;
  };
  if (projectPath) {
    const file = projectExperiencesFile(projectPath);
    const entries = loadFile(file);
    const hit = entries.find((e) => e.id === id);
    if (hit) {
      apply(hit);
      saveFile(file, entries);
      return hit;
    }
  }
  const globalEntries = loadFile(GLOBAL_EXPERIENCES);
  const hit = globalEntries.find((e) => e.id === id);
  if (hit) {
    apply(hit);
    saveFile(GLOBAL_EXPERIENCES, globalEntries);
    return hit;
  }
  return null;
}

/** 合并全局 + 项目级经验（项目级在前——更贴近当前上下文） */
export function listExperiences(projectPath?: string): ExperienceEntry[] {
  const project = projectPath ? loadFile(projectExperiencesFile(projectPath)) : [];
  const global = loadFile(GLOBAL_EXPERIENCES);
  return [...project, ...global];
}

/** 关键词检索（memory/context 不区分大小写子串匹配），按时间倒序限 10 条。
 *  命中条目记录 usageCount/lastUsedAt（模型主动检索 = 经验被用上的证据；写盘失败不影响检索结果） */
export function searchExperiences(query: string, projectPath?: string): { hits: ExperienceEntry[]; total: number } {
  const q = query.trim().toLowerCase();
  if (!q) return { hits: [], total: 0 };
  const all = listExperiences(projectPath)
    .filter((e) => e.memory.toLowerCase().includes(q) || (e.context ?? "").toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt);
  const hits = all.slice(0, SEARCH_LIMIT);
  if (hits.length > 0) touchHits(projectPath, new Set(hits.map((e) => e.id)));
  return { hits, total: all.length };
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
    } catch {
      // 统计失败不影响检索
    }
  }
}

/** 会话启动注入块：项目级条目优先，其次按使用次数降序（未用过的按时间降序），取 top-N 渲染为紧凑文本 */
export function buildExperienceInjection(projectPath?: string, limit = 5): string {
  const all = listExperiences(projectPath);
  if (all.length === 0) return "";
  const sorted = [...all].sort((a, b) => {
    const at = (a.project ? 0 : 1) - (b.project ? 0 : 1);
    if (at !== 0) return at;
    const au = a.usageCount ?? 0, bu = b.usageCount ?? 0;
    if (au !== bu) return bu - au;
    return b.createdAt - a.createdAt;
  }).slice(0, limit);
  const lines = sorted.map((e) => {
    const src = e.project ? "项目" : "全局";
    const u = e.usageCount ?? 0;
    return `- [${src}${u > 0 ? `·已用${u}次` : ""}] ${e.memory.replace(/\s+/g, " ").slice(0, 160)}`;
  });
  return `历史沉淀经验（top ${sorted.length}，仅作背景参考；与本任务相关再复用，不必刻意使用）：\n${lines.join("\n")}`;
}
