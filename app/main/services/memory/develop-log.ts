/**
 * 项目进展的主要来源：项目内的开发记录（`开发记录.md` 导航 + `开发记录/<日期>.md` 明细）。
 *
 * 实测（2026-11-16，EasyMint 仓库近 30 天）：22 个有提交的日子中 17 天有记录，
 * 覆盖 192/238 次提交，且当天写、一天可覆盖多次提交。因此它是**可用主源**，
 * 直接解析即可，不必再让模型总结一遍 git。
 *
 * 结构约定（两个二级标题固定）：
 *   ## 当前进度快照   → `**YYYY-MM-DD 标题**：正文`
 *   ## 开发记录索引   → `- [YYYY-MM-DD](相对路径)：摘要`
 *
 * 解析失败或文件缺失时返回空结构，由调用方降级到 git 证据，不抛错、不猜。
 */

export interface SnapshotEntry {
  date: string;
  title: string;
  body: string;
}

export interface IndexEntry {
  date: string;
  path: string;
  summary: string;
}

export interface DevelopLog {
  snapshot: SnapshotEntry[];
  index: IndexEntry[];
}

export const EMPTY_DEVELOP_LOG: DevelopLog = { snapshot: [], index: [] };

export const DEVELOP_LOG_FILE = "开发记录.md";

const SNAPSHOT_HEADING = /^##[ \t]*当前进度快照[ \t]*$/mu;
const INDEX_HEADING = /^##[ \t]*开发记录索引.*$/mu;
const NEXT_H2 = /^##[ \t]/mu;
const SNAPSHOT_ENTRY = /^\*\*(\d{4}-\d{2}-\d{2})[ \t]+([^*]+?)\*\*[：:][ \t]*([\s\S]*?)(?=\n\*\*\d{4}-\d{2}-\d{2}|\n##[ \t]|(?![\s\S]))/gmu;
const INDEX_ENTRY = /^-[ \t]*\[(\d{4}-\d{2}-\d{2})\]\(([^)]+)\)[ \t]*[：:—–-]?[ \t]*(.*)$/gmu;

function blockAt(text: string, heading: RegExp): string {
  const match = heading.exec(text);
  if (!match) return "";
  const rest = text.slice(match.index + match[0].length);
  const next = NEXT_H2.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

function squeeze(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function parseDevelopLog(text: string): DevelopLog {
  if (!text) return EMPTY_DEVELOP_LOG;
  const source = text.replace(/\r\n?/gu, "\n");
  const snapshot: SnapshotEntry[] = [];
  for (const match of blockAt(source, SNAPSHOT_HEADING).matchAll(SNAPSHOT_ENTRY)) {
    snapshot.push({
      date: match[1]!,
      title: squeeze(match[2]!),
      body: squeeze(match[3]!),
    });
  }
  const index: IndexEntry[] = [];
  for (const match of blockAt(source, INDEX_HEADING).matchAll(INDEX_ENTRY)) {
    index.push({ date: match[1]!, path: match[2]!, summary: squeeze(match[3]!) });
  }
  return { snapshot, index };
}

/** 记录覆盖到哪一天；调用方拿它和 git 最后提交日比，判断记录是否落后。 */
export function latestRecordDate(log: DevelopLog, gitLastCommitDate?: string): string | undefined {
  const dates = [
    ...log.snapshot.map((item) => item.date),
    ...log.index.map((item) => item.date),
    gitLastCommitDate ?? "",
  ].filter(Boolean);
  return dates.sort().at(-1);
}

function shortDate(date: string): string {
  const [year, month, day] = date.split("-");
  return year && month && day ? `${Number(month)}/${Number(day)}` : date;
}

function clip(value: string, limit: number): string {
  const single = squeeze(value);
  return single.length <= limit ? single : `${single.slice(0, Math.max(0, limit - 1))}…`;
}

export interface RenderOptions {
  /** 索引最多渲染几条（文件里保留更多，注入时截断）。 */
  maxIndex?: number;
  /** 当前状态最多渲染几条。 */
  maxSnapshot?: number;
  /** 整块字符上限。 */
  maxChars?: number;
  /** git 最后提交日；晚于记录时补一行"记录落后"。 */
  gitLastCommitDate?: string;
  gitCommitsSince?: number;
}

/**
 * 渲染成项目节正文：当前状态在前，变更流水在后。
 * 流水按日期倒序，每条一行，保留到"最近 8 条"。
 */
export function renderProjectSection(log: DevelopLog, options: RenderOptions = {}): string {
  const maxIndex = options.maxIndex ?? 8;
  const maxSnapshot = options.maxSnapshot ?? 2;
  const maxChars = options.maxChars ?? 700;
  const lines: string[] = [];

  const current = log.snapshot[0];
  if (current) {
    const more = log.snapshot.slice(1, maxSnapshot).map((item) => `${shortDate(item.date)} ${item.title}`);
    lines.push(`当前：${shortDate(current.date)} ${current.title}${current.body ? ` — ${clip(current.body, 110)}` : ""}`);
    for (const item of more) lines.push(`　　　${item}`);
  }

  const stream = [...log.index].sort((a, b) => b.date.localeCompare(a.date)).slice(0, maxIndex);
  if (stream.length) {
    lines.push("变更：");
    for (const item of stream) {
      lines.push(` ${shortDate(item.date)} ${clip(item.summary, 60)}`);
    }
  }

  const latest = latestRecordDate(log);
  if (options.gitLastCommitDate && latest && options.gitLastCommitDate > latest) {
    const count = options.gitCommitsSince ?? 0;
    lines.push(`（记录落后：${options.gitLastCommitDate} 之后还有 ${count} 次提交未记录）`);
  }

  if (!lines.length) return "";
  const text = lines.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text;
}
