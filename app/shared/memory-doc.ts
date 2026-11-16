/**
 * 记忆文档的分节读取。
 *
 * MEMORY.md 同时承载两类内容：角色层（`## 规则` / `## 人设` / `## 关于用户`，仅用户可改，
 * 常驻系统提示）与事实层（记忆条目，模型可写）。这里只做"按标题取正文"这一件事，
 * 不引入额外语法：标题就是 `## ` 开头的一行，段落走到下一个同级标题或文件末尾。
 */

const HEADING = /^##\s+(.+?)\s*$/u;

export function sectionRange(content: string, title: string): { start: number; end: number } | null {
  const lines = content.split("\n");
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const match = HEADING.exec(lines[index] ?? "");
    const heading = match?.[1];
    if (!heading) continue;
    if (start === -1) {
      if (heading === title) start = index;
      continue;
    }
    return { start: start + 1, end: index };
  }
  return start === -1 ? null : { start: start + 1, end: lines.length };
}

/** 取某节正文（去首尾空行）；节不存在或为空返回 null。 */
export function sectionText(content: string, title: string): string | null {
  const range = sectionRange(content, title);
  if (!range) return null;
  const body = content.split("\n").slice(range.start, range.end).join("\n").trim();
  return body || null;
}

/** 写入/替换某节正文；节不存在时追加到文件末尾。 */
export function writeSection(content: string, title: string, body: string): string {
  const text = body.trim();
  const range = sectionRange(content, title);
  if (!range) return `${content.replace(/\s+$/u, "")}\n\n## ${title}\n\n${text}\n`;
  const lines = content.split("\n");
  // range.start 是正文首行，标题在其前一行：正文为空时把标题一起删掉，避免留下空节
  const head = text ? lines.slice(0, range.start) : lines.slice(0, range.start - 1);
  const tail = lines.slice(range.end);
  return [...head, ...(text ? ["", text, ""] : []), ...tail].join("\n").replace(/\n{3,}/gu, "\n\n");
}
