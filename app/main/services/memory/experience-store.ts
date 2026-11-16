/**
 * 经验落盘：与既有 `~/.easymint/experiences/` 目录格式保持一致，
 * 一次只写一条，索引与正文分开（索引用于列标题，正文按需读）。
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { guardLesson, type LessonCandidate } from "./lesson-guard";

export interface ExperienceIndexItem {
  id: string;
  title: string;
  file: string;
  tags: string[];
  kind: string;
  createdAt: number;
  updatedAt: number;
}

interface ExperienceIndex {
  version: number;
  updatedAt: number;
  items: ExperienceIndexItem[];
}

function randomId(): string {
  return randomUUID().slice(0, 8);
}

function fileName(id: string, title: string): string {
  const safe = title.replace(/[\\/:*?"<>|\s]+/gu, "-").replace(/-+/gu, "-").slice(0, 24) || "lesson";
  return `${id}-${safe}.md`;
}

export function readIndex(dir: string): ExperienceIndex {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")) as ExperienceIndex;
    if (!Array.isArray(raw.items)) return { version: 1, updatedAt: Date.now(), items: [] };
    return { version: 1, updatedAt: raw.updatedAt ?? Date.now(), items: raw.items };
  } catch {
    return { version: 1, updatedAt: Date.now(), items: [] };
  }
}

function writeAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, content, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

/**
 * 保存一条经验。硬门槛由 guardLesson 把关；重复标题直接拒绝。
 * 返回 true 表示真的写入了一条。
 */
export function saveLesson(dir: string, candidate: LessonCandidate, evidence: string, now = Date.now()): { saved: boolean; reason?: string } {
  const index = readIndex(dir);
  const verdict = guardLesson(candidate, index.items);
  if (!verdict.ok) return { saved: false, reason: verdict.reason };

  const id = randomId();
  const title = candidate.title!.trim();
  const file = fileName(id, title);
  const date = new Date(now).toISOString().slice(0, 10);
  const body = [
    `# ${title}`,
    "",
    `【${title}】${candidate.when!.trim()}：${candidate.do!.trim()}`,
    "",
    ...(candidate.why ? [`> 为什么：${candidate.why.trim()}`] : []),
    ...(evidence ? [`> 证据：${evidence.replace(/\s+/gu, " ").slice(0, 200)}`] : []),
    "",
    `<!-- id ${id} · 记录 ${date} -->`,
    "",
  ].join("\n");

  writeAtomic(path.join(dir, file), body);
  index.items.push({
    id,
    title,
    file,
    tags: (candidate.tags ?? []).slice(0, 6),
    kind: "lesson",
    createdAt: now,
    updatedAt: now,
  });
  index.updatedAt = now;
  writeAtomic(path.join(dir, "index.json"), `${JSON.stringify(index, null, 1)}\n`);
  return { saved: true };
}

