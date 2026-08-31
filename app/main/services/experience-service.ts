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

/** 合并全局 + 项目级经验（项目级在前——更贴近当前上下文） */
export function listExperiences(projectPath?: string): ExperienceEntry[] {
  const project = projectPath ? loadFile(projectExperiencesFile(projectPath)) : [];
  const global = loadFile(GLOBAL_EXPERIENCES);
  return [...project, ...global];
}

/** 关键词检索（memory/context 不区分大小写子串匹配），按时间倒序限 10 条 */
export function searchExperiences(query: string, projectPath?: string): { hits: ExperienceEntry[]; total: number } {
  const q = query.trim().toLowerCase();
  if (!q) return { hits: [], total: 0 };
  const all = listExperiences(projectPath)
    .filter((e) => e.memory.toLowerCase().includes(q) || (e.context ?? "").toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt);
  return { hits: all.slice(0, SEARCH_LIMIT), total: all.length };
}
