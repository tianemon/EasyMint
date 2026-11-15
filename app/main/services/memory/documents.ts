import fs from "node:fs";
import path from "node:path";
import type { MemoryRecord } from "../../../shared/memory";
import { memoryDay } from "./codec";
import { MemoryDatabase, hashText } from "./database";

const MARKER = "<!-- easymint-memory-view:v1 -->";
export interface DocumentPreview { directory:string; files:string[]; bytes:number; hash:string }
interface DocumentState { directory:string; projectRoot?:string; legacy?:string; hashes:Record<string,string>; monthFiles?:Record<string,string>; pending?:Record<string,{before?:string;after:string}>; backup?:string; generation:number; error?:string }
function safeDirectory(root: string, directory: string): void {
  const relative = path.relative(path.resolve(root),path.resolve(directory));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("开发记录目录必须位于当前项目内");
  let cursor = path.resolve(root);
  if (!fs.existsSync(cursor) || fs.lstatSync(cursor).isSymbolicLink()) throw new Error("项目根目录不存在或为符号链接");
  for (const component of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor,component);
    if (fs.existsSync(cursor) && (!fs.lstatSync(cursor).isDirectory() || fs.lstatSync(cursor).isSymbolicLink())) throw new Error("开发记录目录不能经过符号链接或普通文件");
  }
}
export function previewDocuments(projectPath: string, directory: string): DocumentPreview {
  safeDirectory(projectPath,directory);
  const files:string[] = [];
  const nav = path.join(directory,"开发记录.md"), history = path.join(directory,"开发记录");
  if (fs.existsSync(nav)) {
    if (!fs.lstatSync(nav).isFile() || fs.lstatSync(nav).isSymbolicLink()) throw new Error("记录入口不是普通文件");
    files.push("开发记录.md");
  }
  if (fs.existsSync(history)) {
    if (!fs.lstatSync(history).isDirectory() || fs.lstatSync(history).isSymbolicLink()) throw new Error("记录历史目录无效");
    for (const file of fs.readdirSync(history).sort()) {
      const full = path.join(history,file);
      if (!file.endsWith(".md")) continue;
      if (fs.lstatSync(full).isSymbolicLink()) throw new Error("旧记录含符号链接，请先人工处理");
      if (fs.lstatSync(full).isFile()) files.push(path.join("开发记录",file));
    }
  }
  const manifest = files.map(file => [file,hashText(fs.readFileSync(path.join(directory,file)).toString("base64"))]);
  return { directory,files,bytes:files.reduce((n,file) => n+fs.statSync(path.join(directory,file)).size,0),hash:hashText(JSON.stringify(manifest)) };
}
export function adoptDocuments(db: MemoryDatabase, projectId: string, projectPath: string, directory: string, expectedHash: string, backupRoot: string): DocumentState {
  const existing = db.metadata<DocumentState>(`documents:${projectId}`);
  if (existing) throw new Error("该项目已接管开发记录，请先处理现有导出状态");
  const preview = previewDocuments(projectPath,directory);
  if (preview.hash !== expectedHash) throw new Error("旧开发记录已变化，请重新预览后接管");
  const backup = path.join(backupRoot,`documents-${hashText(projectId).slice(0,16)}-${Date.now()}`);
  fs.mkdirSync(backup,{recursive:true,mode:0o700});
  for (const file of preview.files) {
    const target = path.join(backup,file);
    fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    fs.copyFileSync(path.join(directory,file),target,fs.constants.COPYFILE_EXCL);
    if (!fs.readFileSync(target).equals(fs.readFileSync(path.join(directory,file)))) throw new Error("开发记录备份校验失败，原件保留");
  }
  if (previewDocuments(projectPath,directory).hash !== expectedHash) throw new Error("备份期间旧记录变化，未接管；原件和备份保留");
  fs.mkdirSync(path.join(directory,"开发记录"),{recursive:true});
  const nav = path.join(directory,"开发记录.md");
  let legacy:string|undefined;
  if (fs.existsSync(nav)) {
    legacy = `开发记录-旧入口-${expectedHash.slice(0,12)}.md`;
    const destination = path.join(directory,legacy);
    if (!fs.existsSync(destination)) fs.copyFileSync(nav,destination,fs.constants.COPYFILE_EXCL);
    else if (!fs.readFileSync(nav).equals(fs.readFileSync(destination))) throw new Error("旧入口保留副本冲突，未接管");
  }
  const state:DocumentState = { directory,projectRoot:projectPath,legacy,backup,hashes:{},generation:-1 };
  if (fs.existsSync(nav)) state.hashes["开发记录.md"] = hashText(fs.readFileSync(nav));
  db.setMetadata(`documents:${projectId}`,state);
  return generateDocuments(db,projectId,projectPath);
}
function safeText(text:string):string { return text.replaceAll("<!--","&lt;!--").replaceAll("-->","--&gt;"); }
function date(ts:number,timezone?:string):string { return memoryDay(new Date(ts),timezone); }
function render(item:MemoryRecord & {historicalRevision?:boolean},full:boolean):string {
  const sources = `<!-- memory:${safeText(item.key)} revision:${item.revision} -->`;
  return `### ${item.timeBasis==="recorded"?"记录于 ":""}${date(item.occurredAt,item.sources[0]?.timezone)} ${safeText(item.text).replaceAll("\n"," ")}\n\n${item.historicalRevision?`> 旧版本 r${item.revision}，仅供回溯；当前结论请查新版本。\n\n`:""}${full && item.details ? `${item.details.length<=2000 && !item.legacy?safeText(item.details):"完整旧资料保留在原来源中，请按记忆ID查阅。"}\n\n` : ""}${item.invalidatedAt?"\n> 来源已撤回或修订，以上仅作历史记录。\n\n":""}${sources}\n`;
}
function writeOwned(state:DocumentState, file:string, text:string, checkpoint:()=>void):void {
  const full = path.join(state.directory,file);
  if (fs.existsSync(full)) {
    if (!fs.lstatSync(full).isFile() || fs.lstatSync(full).isSymbolicLink()) throw new Error(`导出目标不是普通文件：${file}`);
    const raw = fs.readFileSync(full);
    const expected = [state.hashes[file],state.pending?.[file]?.before,state.pending?.[file]?.after].filter(Boolean);
    if (!expected.includes(hashText(raw))) throw new Error(`开发记录被外部修改，已保留，未覆盖：${file}`);
  } else if (state.hashes[file]) throw new Error(`托管文件已被移除，未自动重建：${file}`);
  state.pending ??= {};
  state.pending[file]={before:fs.existsSync(full)?hashText(fs.readFileSync(full)):undefined,after:hashText(text)};
  checkpoint();
  const temp = `${full}.memory-${process.pid}-${Date.now()}.tmp`;
  fs.writeFileSync(temp,text,{flag:"wx"});
  fs.renameSync(temp,full);
  state.hashes[file] = hashText(text);
  delete state.pending[file];
  checkpoint();
}
export function generateDocuments(db:MemoryDatabase,projectId:string,projectPath:string):DocumentState {
  const state = db.metadata<DocumentState>(`documents:${projectId}`);
  if (!state) throw new Error("项目尚未接管开发记录");
  const write=(file:string,text:string)=>writeOwned(state,file,text,()=>db.setMetadata(`documents:${projectId}`,state));
  try {
    if(state.projectRoot && path.resolve(state.projectRoot)!==path.resolve(projectPath)) {
      const relative=path.relative(state.projectRoot,state.directory);
      if(relative.startsWith("..") || path.isAbsolute(relative))throw new Error("项目文档原目录越界，未自动调整");
      state.directory=path.join(projectPath,relative);state.projectRoot=projectPath;
    }
    safeDirectory(projectPath,state.directory);
    safeDirectory(projectPath,path.join(state.directory,"开发记录"));
    const generation = db.metadata<number>("generation") ?? 0;
    if (state.generation === generation && !state.error) return state;
    const records = db.projectHistory(projectId);
    const months = new Map<string,MemoryRecord[]>();
    for (const item of records) {
      const month = date(item.occurredAt,item.sources[0]?.timezone).slice(0,7);
      const rows = months.get(month) ?? []; rows.push(item); months.set(month,rows);
    }
    const monthLinks:string[] = [];
    state.monthFiles ??= {};
    for(const file of Object.keys(state.hashes)) {
      const known=/^开发记录[/\\](\d{4}-\d{2})-em(?:-\d+)?\.md$/u.exec(file);
      if(known && !state.monthFiles[known[1]!])state.monthFiles[known[1]!]=file;
    }
    for (const [month,items] of months) {
      let file=state.monthFiles[month];
      if(!file) {
        file=path.join("开发记录",`${month}-em.md`);
        let suffix=1;
        while(fs.existsSync(path.join(state.directory,file)) && !state.hashes[file]) file=path.join("开发记录",`${month}-em-${++suffix}.md`);
        state.monthFiles[month]=file;
      }
      const text = `${MARKER}\n# ${month} 项目历史\n\n由应用从项目事件生成；历史保留不代表当前仍适用。请按日期和条目读取。\n\n${items.map(i => render(i,true)).join("\n")}\n`;
      if (!fs.existsSync(path.join(state.directory,file)) || state.hashes[file] !== hashText(text)) write(file,text);
      monthLinks.push(`- [${month}](${file.replaceAll(path.sep,"/")})`);
    }
    // Rebuild prior generated months after forget, including now-empty months, without deleting human files.
    for(const [month,file] of Object.entries(state.monthFiles)) {
      if(!months.has(month))write(file,`${MARKER}\n# ${month} 项目历史\n\n当前无可保留的项目事件。\n`);
    }
    const current = records.filter(r => r.state === "confirmed" && !r.invalidatedAt && !r.mergedInto && !r.historicalRevision && (r.lifecycle === "active" || (r.kind === "activity" && r.lifecycle!=="retired")) && (r.expiresAt === undefined || r.expiresAt>Date.now())).slice(-12).reverse();
    const legacy = state.legacy ? `\n- [接管前记录入口](${state.legacy.replaceAll(path.sep,"/")})\n` : "";
    const text = `${MARKER}\n# 项目开发记录\n\n本入口由应用生成，请通过记忆功能修正。当前事件与历史分开，历史请按需读取。\n\n## 当前与近期\n\n${current.length ? current.map(i => render(i,false)).join("\n") : "暂无当前事件。\n"}\n## 历史索引\n\n${monthLinks.join("\n")}${legacy}\n`;
    if (state.hashes["开发记录.md"] !== hashText(text)) write("开发记录.md",text);
    state.generation=generation; delete state.error;
  } catch (error) { state.error=(error as Error).message; }
  db.setMetadata(`documents:${projectId}`,state); return state;
}
export function documentStatus(db:MemoryDatabase,projectId:string):DocumentState|undefined { return db.metadata<DocumentState>(`documents:${projectId}`); }
