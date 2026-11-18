/**
 * 跨工具会话的"感知"层（aab 精简内置版）。
 *
 * 只做**发现**：哪个项目最近在别的工具里动过、什么时候。不解析正文 ——
 * 正文解析器跟各工具格式强绑定，搬进来只会分叉；真要看内容时再按需读。
 *
 * 已核实的目录约定（2026-11-16 本机实测）：
 * - codex：~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl
 * - claude：~/.claude/projects/<项目路径把 / 换成 - >/<uuid>.jsonl
 */
import path from "node:path";
import fs from "node:fs";
import {pathHitsAny,protectedCredentialPaths} from "../permission/access-policy";

export type ToolName = "codex" | "claude" | "easymint";

export interface ToolSessionHit {
  tool: ToolName;
  file: string;
  mtime: number;
}

export interface ToolScanDeps {
  /** 列目录，返回 [{name, isDir}]；不存在返回 null。 */
  listDir(dir: string): Array<{ name: string; isDir: boolean }> | null;
  /** 文件 mtime（毫秒）；失败返回 null。 */
  mtime(file: string): number | null;
  projectOf?(file:string):string|null;
}

export interface ToolScanOptions {
  home: string;
  projectPath: string;
  /** 只看最近多少天，默认 14。 */
  days?: number;
  now?: number;
  agentDir?:string;
}

/** claude 用路径编码当目录名：/Users/a/b -> -Users-a-b */
export function claudeProjectDir(home: string, projectPath: string): string {
  const encoded = projectPath.replace(/[/\\]+/gu, "-").replace(/^-+/u, "-");
  return path.join(home, ".claude", "projects", encoded);
}

function recentDayDirs(deps: ToolScanDeps, home: string, days: number, now: number): string[] {
  const out: string[] = [];
  const base = path.join(home, ".codex", "sessions");
  const day = 86_400_000;
  for (let offset = -1; offset <= days+1; offset += 1) {
    const date = new Date(now - offset * day);
    const dir = path.join(
      base,
      String(date.getUTCFullYear()),
      String(date.getUTCMonth() + 1).padStart(2, "0"),
      String(date.getUTCDate()).padStart(2, "0"),
    );
    if (deps.listDir(dir)) out.push(dir);
  }
  return out;
}

/** 列出某项目在 codex/claude 里最近的活动（按 mtime 倒序，最多 5 条）。 */
export function listToolSessions(options: ToolScanOptions, deps: ToolScanDeps): ToolSessionHit[] {
  const days = Math.max(0,Math.min(90,Math.floor(options.days ?? 14)));
  const now = options.now ?? Date.now();
  const hits: ToolSessionHit[] = [];

  for (const dir of recentDayDirs(deps, options.home, days, now)) {
    for (const entry of deps.listDir(dir) ?? []) {
      if (entry.isDir || !entry.name.endsWith(".jsonl")) continue;
      const file = path.join(dir, entry.name);
      const mtime = deps.mtime(file);
      if (mtime === null || mtime<now-days*86_400_000 || mtime>now || !deps.projectOf || !sameProject(deps.projectOf(file),options.projectPath)) continue;
      hits.push({ tool: "codex", file, mtime });
    }
  }

  const claudeDir = claudeProjectDir(options.home, options.projectPath);
  for (const entry of deps.listDir(claudeDir) ?? []) {
    if (entry.isDir || !entry.name.endsWith(".jsonl")) continue;
    const file = path.join(claudeDir, entry.name);
    const mtime = deps.mtime(file);
    if (mtime === null || mtime<now-days*86_400_000 || mtime>now || !deps.projectOf || !sameProject(deps.projectOf(file),options.projectPath)) continue;
    hits.push({ tool: "claude", file, mtime });
  }

  if(options.agentDir){
    // Read-only counterpart of Pi 1.5 SessionManager.getDefaultSessionDirPath;
    // the SDK public directory helper creates folders, which discovery must not do.
    const safe=`--${path.resolve(options.projectPath).replace(/^[/\\]/u,"").replace(/[/\\:]/gu,"-")}--`;
    const dir=path.join(options.agentDir,"sessions",safe);
    for(const entry of deps.listDir(dir) ?? []){if(entry.isDir || !entry.name.endsWith(".jsonl"))continue;const file=path.join(dir,entry.name),mtime=deps.mtime(file);if(mtime!==null && mtime>=now-days*86400000 && mtime<=now && deps.projectOf && sameProject(deps.projectOf(file),options.projectPath))hits.push({tool:"easymint",file,mtime});}
  }
  return hits.sort((a,b)=>b.mtime-a.mtime);
}

export function sameProject(left:string|null,right:string):boolean {
 if(!left)return false;const canonical=(value:string)=>{try{return fs.realpathSync(value);}catch{return path.resolve(value);}};
 const a=canonical(left),b=canonical(right);return process.platform==="win32"?a.toLowerCase()===b.toLowerCase():a===b;
}
export function sessionProject(file:string,opened?:number):string|null {
 if(pathHitsAny(file,protectedCredentialPaths(),path.dirname(file)))return null;
 const stat=opened===undefined?fs.lstatSync(file):fs.fstatSync(opened);if(!stat.isFile() || stat.isSymbolicLink())return null;
 const fd=opened ?? fs.openSync(file,"r");try{
  const bytes=Buffer.alloc(Math.min(65536,stat.size)),count=fs.readSync(fd,bytes,0,bytes.length,0);
  // Claude may begin with a queue entry; inspect only bounded metadata until cwd.
  for(const line of bytes.subarray(0,count).toString("utf8").split("\n")){
    try{const row=JSON.parse(line) as {cwd?:unknown;payload?:{cwd?:unknown}};const cwd=row.payload?.cwd ?? row.cwd;if(typeof cwd==="string")return cwd;}catch{/* incomplete or non-metadata line */}
  }return null;
 }finally{if(opened===undefined)fs.closeSync(fd);}

}
export function discoverSessions(home:string,projectPath:string,options:{days?:number;now?:number;agentDir?:string}={}):ToolSessionHit[]{
 return listToolSessions({home,projectPath,...options},{listDir:dir=>{try{return fs.readdirSync(dir,{withFileTypes:true}).map(entry=>({name:entry.name,isDir:entry.isDirectory()}));}catch{return null;}},mtime:file=>{try{const stat=fs.lstatSync(file);return stat.isFile()&&!stat.isSymbolicLink()?stat.mtimeMs:null;}catch{return null;}},projectOf:sessionProject});
}

/** 一句话路标，用于注入；没有任何活动返回 undefined。 */
export function describeToolSessions(hits: ToolSessionHit[]): string | undefined {
  if (!hits.length) return undefined;
  // 用绝对日期而不是"今天/N 天前"：相对时间每天都会变，会让注入版本漂移。
  const parts = hits.slice(0,5).map((hit) => `${hit.tool} ${new Date(hit.mtime).toISOString().slice(5, 10)}`);
  return `其他工具最近动过：${parts.join("、")}`;
}

/** 从一行 JSON 里取出"助手说了什么"；结构不匹配返回 undefined。 */
function assistantText(row: unknown): string | undefined {
  const record = row as { role?: string; content?: unknown; message?: { role?: string; content?: unknown;stopReason?:string }; payload?: { role?: string; content?: unknown;stopReason?:string } };
  const holder = record.message ?? record.payload ?? record;
  if (holder?.role !== "assistant") return undefined;
  if("stopReason" in holder && holder.stopReason!==undefined && holder.stopReason!=="stop")return undefined;
  const content = holder.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .map((part) => (part as { text?: unknown })?.text)
    .filter((text): text is string => typeof text === "string" && Boolean(text.trim()));
  return parts.length ? parts.join("\n") : undefined;
}

export interface SessionTail {
  text: string;
  lines: number;
}

/**
 * 按需读取其他工具会话的**最后一段助手结论**（默认不读，只在用户要求时调）。
 * 容忍两种格式：codex 的 payload 包裹与 claude 的 message 包裹。
 */
export function readSessionTail(raw: string, limit = 800): SessionTail | undefined {
  const rows = raw.split("\n").filter((line) => line.trim());
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rows[index]!);
    } catch {
      continue;
    }
    const text = assistantText(parsed);
    if (!text) continue;
    const single = text.replace(/\s+/gu, " ").trim();
    return { text: single.length <= limit ? single : `${single.slice(0, limit - 1)}…`, lines: rows.length };
  }
  return undefined;
}

/** Latest complete assistant record and its byte offset, so older records remain reachable. */
export function readSessionPage(raw:string):{text:string;lineOffset:number}|undefined {
 let end=raw.length;
 while(end>0){const start=raw.lastIndexOf("\n",end-1)+1,line=raw.slice(start,end).trim();
  if(line)try{const text=assistantText(JSON.parse(line));if(text?.trim())return {text:text.trim(),lineOffset:Buffer.byteLength(raw.slice(0,start),"utf8")};}catch{/* incomplete or non-message line */}
  end=start>0?start-1:0;
 }return undefined;
}
