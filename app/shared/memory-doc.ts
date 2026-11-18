/**
 * 记忆文档的分节读取。
 *
 * MEMORY.md 同时承载两类内容：角色层（`## 规则` / `## 人设`，仅用户可改，
 * 常驻系统提示）与事实层（记忆条目，模型可写）。这里只做"按标题取正文"这一件事，
 * 不引入额外语法：标题就是 `## ` 开头的一行，段落走到下一个同级标题或文件末尾。
 */

const HEADING = /^##\s+(.+?)\s*$/u;

export const ROLE_SECTIONS = ["规则", "人设"] as const;
export function headings(content:string):Array<{title:string;index:number}> {
 const result:Array<{title:string;index:number}>=[];let fence:string|undefined;
 content.split("\n").forEach((line,index)=>{
  const marker=/^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
  if(marker){if(!fence)fence=marker;else if(marker[0]===fence[0] && marker.length>=fence.length && /^\s*(`{3,}|~{3,})\s*$/u.test(line))fence=undefined;return;}
  if(!fence){const title=HEADING.exec(line)?.[1];if(title)result.push({title,index});}
 });return result;
}
export function sectionRange(content: string, title: string): { start: number; end: number } | null {
 const all=headings(content),matches=all.filter(item=>item.title===title);
 if(matches.length>1)throw new Error(`MEMORY.md 有重复章节：${title}`);
 const found=matches[0];if(!found)return null;
 return {start:found.index+1,end:all.find(item=>item.index>found.index)?.index ?? content.split("\n").length};
}
export function roleSnapshot(content:string):string {
 return JSON.stringify(ROLE_SECTIONS.map(title=>({title,present:sectionRange(content,title)!==null,body:sectionText(content,title)})));
}
export function roleLineIndexes(content:string):Set<number> {
 const result=new Set<number>();
 for(const title of ROLE_SECTIONS){const range=sectionRange(content,title);if(range)for(let index=range.start-1;index<range.end;index++)result.add(index);}
 return result;
}
export function isRoleLine(content:string,index:number):boolean {
 return ROLE_SECTIONS.some(title=>{const range=sectionRange(content,title);return range && index>=range.start-1 && index<range.end;});
}

/** 取某节正文（去首尾空行）；节不存在或为空返回 null。 */
export function sectionText(content: string, title: string): string | null {
  const range = sectionRange(content, title);
  if (!range) return null;
  const body = content.split("\n").slice(range.start, range.end).join("\n").trim();
  if((ROLE_SECTIONS as readonly string[]).includes(title)){
    const lines=body.split("\n"),first=/^(`{3,})easymint-role$/u.exec(lines[0] ?? "");
    if(first && lines.at(-1)===first[1])return lines.slice(1,-1).join("\n").trim() || null;
  }
  return body || null;
}

/** A generated fence preserves arbitrary Markdown headings inside editable role prompts. */
export function encodeRoleBody(body:string):string {
 const text=body.trim();if(!text)return "";
 const longest=Math.max(2,...(text.match(/`+/gu) ?? []).map(run=>run.length));const fence="`".repeat(longest+1);
 return `${fence}easymint-role\n${text}\n${fence}`;
}

/** 写入/替换某节正文；节不存在时追加到文件末尾。 */
export function writeSection(content: string, title: string, body: string, keepEmpty=false): string {
  const text = body.trim();
  const range = sectionRange(content, title);
  if (!range) {
    if(!text && !keepEmpty)return content;
    const lines=content.split("\n"),role=(ROLE_SECTIONS as readonly string[]).includes(title);
    if(role){const other=headings(content).find(item=>!(ROLE_SECTIONS as readonly string[]).includes(item.title));const at=other?.index ?? lines.length;lines.splice(at,0,`## ${title}`,"",text,"");return lines.join("\n");}
    return `${content.replace(/\s+$/u, "")}\n\n## ${title}\n\n${text}\n`;
  }
  const lines = content.split("\n");
  // range.start 是正文首行，标题在其前一行：正文为空时把标题一起删掉，避免留下空节
  const head = text || keepEmpty ? lines.slice(0, range.start) : lines.slice(0, range.start - 1);
  const tail = lines.slice(range.end);
  return [...head, ...(text || keepEmpty ? ["", text, ""] : []), ...tail].join("\n");
}
