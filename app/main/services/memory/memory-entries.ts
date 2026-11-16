/**
 * MEMORY.md 的条目模型（收敛后的唯一形态）。
 *
 * 收敛结论：称呼/人设归协作设置、项目状态归开发记录、本机现采、方法归经验库，
 * 因此本文件只剩一类内容——**约定**（跨项目规则、禁忌、在意什么）。
 *
 * 格式：一个列表，每条一行，行尾带不可见 key 注释。
 *   - 别先给方案再问要不要做 <!-- m:k3f9a1c2 -->
 *
 * key 一旦分配就不随正文变化，这样"覆盖更新"能定位到同一条；
 * revision 由正文派生，正文没变则版本不变，注入就不会重复。
 */
import { createHash } from "node:crypto";

export interface MemoryEntry {
  key: string;
  text: string;
  /** 正文版本号，由正文派生；注入去重依赖它（不用写入时间）。 */
  revision: number;
  /** 索引里的记录版本（数据表 revision）；有它才写成 memory:key r:N 标记。 */
  dbRevision?: number;
}

const BULLET = /^[-*][ \t]+(.+)$/u;
const MARKER = /<!--[ \t]*(?:m|memory):([0-9a-zA-Z][0-9a-zA-Z\-/_.]{0,80}?)(?:[ \t]+r:(\d+))?[ \t]*-->[ \t]*$/u;

function shortHash(value: string): string {
  return createHash("sha1").update(value.trim()).digest("hex").slice(0, 8);
}

/**
 * revision 取正文哈希的前 6 位十进制，纯内容派生。
 * 不用时间戳：时间会让每轮版本号都变，缓存与去重全部失效。
 */
export function entryRevision(text: string): number {
  const digest = createHash("sha1").update(text.trim()).digest();
  return digest.readUIntBE(0, 3) + 1;
}

export function newEntryKey(text: string): string {
  return shortHash(text);
}

export function parseEntries(markdown: string): MemoryEntry[] {
  const out: MemoryEntry[] = [];
  const seen = new Set<string>();
  for (const raw of markdown.replace(/\r\n?/gu, "\n").split("\n")) {
    const bullet = BULLET.exec(raw);
    if (!bullet) continue;
    let text = bullet[1]!.trim();
    const marker = MARKER.exec(text);
    let key: string | undefined;
    let dbRevision: number | undefined;
    if (marker) {
      key = marker[1];
      dbRevision = marker[2] ? Number(marker[2]) : undefined;
      text = text.slice(0, marker.index).trim();
    }
    if (!text) continue;
    const resolved = key ?? newEntryKey(text);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push({ key: resolved, text, revision: entryRevision(text), ...(dbRevision ? { dbRevision } : {}) });
  }
  return out;
}

function entryLine(text: string, key: string, dbRevision?: number): string {
  return dbRevision
    ? `- ${text.trim()} <!-- memory:${key} r:${dbRevision} -->`
    : `- ${text.trim()} <!-- m:${key} -->`;
}

/** 定位条目所在行，含 key（缺 key 时按正文派生，保证同一行稳定可寻）。 */
function entryLines(markdown: string): Array<{ index: number; key: string; text: string }> {
  const out: Array<{ index: number; key: string; text: string }> = [];
  markdown.replace(/\r\n?/gu, "\n").split("\n").forEach((raw, index) => {
    const bullet = BULLET.exec(raw);
    if (!bullet) return;
    let text = bullet[1]!.trim();
    const marker = MARKER.exec(text);
    let key: string | undefined;
    if (marker) {
      key = marker[1];
      text = text.slice(0, marker.index).trim();
    }
    if (!text) return;
    out.push({ index, key: key ?? newEntryKey(text), text });
  });
  return out;
}

/**
 * 同 key 覆盖正文并保持原位置；新 key 追加到最后一个条目之后。
 * 文件标题、说明段落、其它非条目内容一律原样保留（只动条目行）。
 * 传 dbRevision 时写成索引格式 `memory:key r:N`，否则写轻量 `m:key`。
 */
export function upsertEntry(
  markdown: string,
  input: { key?: string; text: string; dbRevision?: number },
): string {
  const text = input.text.trim();
  if (!text) return markdown;
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const existing = entryLines(markdown);
  const key = input.key ?? newEntryKey(text);
  const hit = existing.find((entry) => entry.key === key);
  if (hit) {
    lines[hit.index] = entryLine(text, key, input.dbRevision);
    return lines.join("\n");
  }
  const line = entryLine(text, key, input.dbRevision);
  const last = existing.at(-1);
  if (last) {
    lines.splice(last.index + 1, 0, line);
    return lines.join("\n");
  }
  const trimmed = lines.join("\n").replace(/\s+$/u, "");
  return trimmed ? `${trimmed}\n\n${line}\n` : `${line}\n`;
}

export function removeEntry(markdown: string, key: string): string {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const hit = entryLines(markdown).find((entry) => entry.key === key);
  if (!hit) return markdown;
  lines.splice(hit.index, 1);
  return lines.join("\n");
}

/** 注入用的纯文本（去掉 key 注释，避免把内部标记喂给模型）。 */
export function renderForPrompt(entries: MemoryEntry[], maxChars = 1200): string {
  const lines = entries.map((entry) => `- ${entry.text}`);
  const text = lines.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text;
}
