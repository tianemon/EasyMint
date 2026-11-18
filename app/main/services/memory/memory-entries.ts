/**
 * 主/日期深层/经验 Markdown 共用的稳定条目格式。
 * 规则和人格另有配置真源；这里只编解码事实与经验及其最小元数据。
 * 正文使用可读列表和凝练详情，行尾 key/revision 注释供事务索引定位；
 * 索引版本用于一致性，正文指纹用于内容比较，不把读取或物理移动当作更新。
 */
import { createHash } from "node:crypto";
import {roleLineIndexes,sectionRange} from "../../../shared/memory-doc";
import type {MemoryKind,MemoryRecord} from "../../../shared/memory";

export interface MemoryEntry {
  key: string;
  text: string;
  /** 正文版本号，由正文派生；注入去重依赖它（不用写入时间）。 */
  revision: string;
  /** 索引里的记录版本（数据表 revision）；有它才写成 memory:key r:N 标记。 */
  dbRevision?: number;
  details?:string;
  summary?:string;
  pending?:boolean;
  memoryDate?:string;
  meta?:Pick<MemoryRecord,"kind"|"scope"|"projectId"|"lifecycle"|"confidence"> & {source?:string};
}

const BULLET = /^[-*][ \t]+(.+)$/u;
const MARKER = /<!--[ \t]*(?:m|memory):([0-9a-zA-Z][0-9a-zA-Z:!\-/_.]{0,160}?)(?:[ \t]+r:(\d+))?[ \t]*-->[ \t]*$/u;

function shortHash(value: string): string {
  return createHash("sha1").update(value.trim()).digest("hex").slice(0, 8);
}

/**
 * revision 使用完整 SHA-256 正文哈希，纯内容派生。
 * 不用时间戳：时间会让每轮版本号都变，缓存与去重全部失效。
 */
export function entryRevision(text: string): string {return createHash("sha256").update(text.trim()).digest("hex");}

export function newEntryKey(text: string): string {
  return shortHash(text);
}

export function parseEntries(markdown: string): MemoryEntry[] {
  const out: MemoryEntry[] = [];
  const seen = new Set<string>();
  const content=markdown.replace(/\r\n?/gu,"\n");
  const roles=roleLineIndexes(content),allLines=content.split("\n"),pendingRange=sectionRange(content,"待生效");
  for (const [index,raw] of allLines.entries()) {
    if(roles.has(index))continue;
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
    const dated=/^\[(\d{4}-\d{2}-\d{2})\]\s+(.+)$/u.exec(text);
    const memoryDate=dated?.[1];if(dated)text=dated[2]!;
    if (!text) continue;
    const resolved = key ?? newEntryKey(text);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    let extra:{details?:string;summary?:string}={};
    const body=allLines[index+1];
    if(body?.startsWith("  <!-- memory-body ")){
      const payload=/^  <!-- memory-body (.+) -->$/u.exec(body)?.[1];
      if(!payload)throw new Error("MEMORY.md 的附注格式无效");
      const parsed:unknown=JSON.parse(payload);
      if(!parsed || typeof parsed!=="object" || Array.isArray(parsed))throw new Error("MEMORY.md 的附注格式无效");
      const attrs=parsed as {details?:unknown;summary?:unknown};
      if(attrs.details!==undefined && typeof attrs.details!=="string" || attrs.summary!==undefined && typeof attrs.summary!=="string")throw new Error("MEMORY.md 的附注必须是文本");
      extra={...(typeof attrs.details==="string"?{details:attrs.details}:{}),...(typeof attrs.summary==="string"?{summary:attrs.summary}:{})};
    }
    let meta:MemoryEntry["meta"];
    for(let next=index+1;next<allLines.length;next++){
      const line=allLines[next]!;
      if(line.startsWith("  详情：")||line.startsWith("  摘要：")){
        const key=line.startsWith("  详情：")?"details":"summary";let value=line.slice(5);
        while(allLines[next+1]?.startsWith("  > "))value+="\n"+allLines[++next]!.slice(4);
        extra[key]=value;
      }else if(line.startsWith("  <!-- memory-meta ")){
        const payload=/^  <!-- memory-meta (.+) -->$/u.exec(line)?.[1];if(!payload)throw new Error("记忆元数据无效");meta=JSON.parse(payload) as MemoryEntry["meta"];
      }else if(!line.startsWith("  <!-- memory-body "))break;
    }
    out.push({ key: resolved, text, ...extra, ...(memoryDate?{memoryDate}:{}),...(meta?{meta}:{}), revision: entryRevision(text), ...(dbRevision ? { dbRevision } : {}),...(pendingRange && index>=pendingRange.start && index<pendingRange.end?{pending:true}:{}) });
  }
  return out;
}

function entryLine(text: string, key: string, dbRevision?: number,memoryDate?:string): string {
  const value=memoryDate?`[${memoryDate}] ${text.trim()}`:text.trim();
  return dbRevision
    ? `- ${value} <!-- memory:${key} r:${dbRevision} -->`
    : `- ${value} <!-- m:${key} -->`;
}

/** 定位条目所在行，含 key（缺 key 时按正文派生，保证同一行稳定可寻）。 */
function entryLines(markdown: string): Array<{ index: number; key: string; text: string }> {
  const out: Array<{ index: number; key: string; text: string }> = [];
  const roles=roleLineIndexes(markdown);
  markdown.replace(/\r\n?/gu, "\n").split("\n").forEach((raw, index) => {
    if(roles.has(index))return;
    const bullet = BULLET.exec(raw);
    if (!bullet) return;
    let text = bullet[1]!.trim();
    const marker = MARKER.exec(text);
    let key: string | undefined;
    if (marker) {
      key = marker[1];
      text = text.slice(0, marker.index).trim();
    }
    text=text.replace(/^\[\d{4}-\d{2}-\d{2}\]\s+/u,"");
    if (!text) return;
    out.push({ index, key: key ?? newEntryKey(text), text });
  });
  return out;
}

/**
 * 同 key 覆盖正文并保持原位置；新 key 写入明确的事实章节。
 * 文件标题、说明段落、其它非条目内容一律原样保留（只动条目行）。
 * 传 dbRevision 时写成索引格式 `memory:key r:N`，否则写轻量 `m:key`。
 */
export function upsertEntry(
  markdown: string,
  input: { key?: string; text: string; dbRevision?: number;kind?:MemoryKind;details?:string;summary?:string;pending?:boolean;memoryDate?:string;meta?:MemoryEntry["meta"] },
): string {
  const text = input.text.trim().replace(/[\r\n]+/gu," ");
  if (!text) return markdown;
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const existing = entryLines(markdown);
  const key = input.key ?? newEntryKey(text);
  const hit = existing.find((entry) => entry.key === key);
  const extras:string[]=[];
  for(const [label,value] of [["详情",input.details],["摘要",input.summary]] as const)if(value!==undefined){const parts=value.split("\n");extras.push(`  ${label}：${parts[0] ?? ""}`,...parts.slice(1).map(line=>`  > ${line}`));}
  if(input.meta)extras.push(`  <!-- memory-meta ${JSON.stringify(input.meta).replaceAll("<","\\u003c").replaceAll(">","\\u003e")} -->`);
  if (hit) {
    lines[hit.index] = entryLine(text, key, input.dbRevision,input.memoryDate);
    while(isOwnedLine(lines[hit.index+1]))lines.splice(hit.index+1,1);
    lines.splice(hit.index+1,0,...extras);
    return lines.join("\n");
  }
  const line = [entryLine(text,key,input.dbRevision,input.memoryDate),...extras].join("\n");
  const title=input.pending?"待生效":input.kind==="attention"?"当前关注":input.kind==="background" || input.kind==="preference"?"关于用户":input.kind==="activity"?"近期项目":"记忆";
  const range=sectionRange(markdown,title);
  if(range){lines.splice(range.end,0,line);return lines.join("\n");}
  // Every new fact gets an explicit destination, even if the file only has roles.
  return `${lines.join("\n").replace(/\s+$/u,"")}\n\n## ${title}\n\n${line}\n`;

}

function isOwnedLine(line:string|undefined):boolean {return Boolean(line && /^  (?:详情：|摘要：|> |<!-- memory-(?:body|meta) )/u.test(line));}

export function removeEntry(markdown: string, key: string): string {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const hit = entryLines(markdown).find((entry) => entry.key === key);
  if (!hit) return markdown;
  let count=1;while(isOwnedLine(lines[hit.index+count]))count++;
  lines.splice(hit.index,count);
  return lines.join("\n");
}

/** 注入用的纯文本（去掉 key 注释，避免把内部标记喂给模型）。 */
export function renderForPrompt(entries: MemoryEntry[], maxChars = 1200): string {
  const lines = entries.map((entry) => `- ${entry.text}`);
  const text = lines.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text;
}
