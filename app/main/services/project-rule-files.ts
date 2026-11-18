import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {pathHitsAny,protectedCredentialPaths} from "./permission/access-policy";
import {atomicWrite} from "./native-config-storage";

export interface ProjectRuleFile {path:string;content:string}
const PRIMARY = ["AGENTS.override.md","AGENTS.md","AGENTS.MD","CLAUDE.md","CLAUDE.MD","CODEBUDDY.md","CODEBUDDY.MD"];
const ADDITIONAL = [".claude/CLAUDE.md",".codebuddy/CODEBUDDY.md",".cursorrules",".github/copilot-instructions.md"];
const UNSUPPORTED = [".cursor/rules",".github/instructions"];
const OPTIONAL = new Set(["ENOENT","ENOTDIR","EACCES","EPERM","EISDIR","ELOOP","EIO","EBUSY"]);
const revisions=new Map<string,number>();
export interface ProjectRuleOwnership {hash:string;baseBytes:number;revision?:string;preparedHash?:string}
const seededRules=new Map<string,ProjectRuleOwnership>();
const contentHash=(content:string|Buffer)=>createHash("sha256").update(content).digest("hex");
let revision=0;
export function markProjectRuleChanged(file:string):void {
  const absolute=path.resolve(file),base=path.basename(absolute);
  if(![...PRIMARY,".cursorrules","copilot-instructions.md"].some(name=>name.toLowerCase()===base.toLowerCase()))return;
  let dir=path.dirname(absolute);if([".claude",".codebuddy",".github"].includes(path.basename(dir).toLowerCase()))dir=path.dirname(dir);
  try{dir=fs.realpathSync(dir);}catch(error){if(!optional(error))throw error;}
  revisions.set(process.platform==="win32"?dir.toLowerCase():dir,++revision);
}
export function projectRuleRevision(cwd:string):number {return projectRuleDirectories(cwd).reduce((value,dir)=>Math.max(value,revisions.get(process.platform==="win32"?dir.toLowerCase():dir) ?? 0),0);}
function optional(error:unknown):error is NodeJS.ErrnoException {return error instanceof Error && OPTIONAL.has((error as NodeJS.ErrnoException).code ?? "");}
export function projectRuleDirectories(cwd:string,canonical=true):string[] {
  const result:string[]=[];let dir=path.resolve(cwd);if(canonical)try{dir=fs.realpathSync(dir);}catch(error){if(!optional(error))throw error;}
  for(;;){result.unshift(dir);const parent=path.dirname(dir);if(parent===dir)return result;dir=parent;}
}

function candidatePath(dir:string,name:string):string {
  let current=dir;
  for(const part of name.split("/")){
    const direct=path.join(current,part);if(fs.lstatSync(direct,{throwIfNoEntry:false})){current=direct;continue;}
    const match=fs.readdirSync(current).find(entry=>entry.toLowerCase()===part.toLowerCase());current=path.join(current,match ?? part);
    if(!match)return direct;
  }return current;
}
function readRule(file:string,cwd:string):string {
  const canonical=fs.realpathSync(file);if(pathHitsAny(canonical,protectedCredentialPaths(),cwd))throw Object.assign(new Error("规则目标属于受控或敏感资料"),{code:"EACCES"});
  return fs.readFileSync(canonical,"utf8").replace(/^\uFEFF/u,"");
}

/** Discovery and loading use the same ordered adapters. An unreadable/empty
 * selected file is still an existing user choice, never permission to seed. */
export function discoverProjectRules(cwd:string,ancestors=true):{files:ProjectRuleFile[];warnings:string[];hasExisting:boolean} {
  const files:ProjectRuleFile[]=[],warnings:string[]=[];let hasExisting=false;
  for(const dir of ancestors?projectRuleDirectories(cwd):[path.resolve(cwd)]){
    let selected=false;
    for(const name of [...PRIMARY,...ADDITIONAL]){
      let file=path.join(dir,...name.split("/"));
      try{file=candidatePath(dir,name);
        const entry=fs.lstatSync(file,{throwIfNoEntry:false});if(!entry)continue;
        hasExisting=true;selected=true;
        const stat=fs.statSync(file);
        if(!stat.isFile()){warnings.push(`项目规则不是普通文件：${file}`);break;}
        const content=readRule(file,dir);files.push({path:file,content});break;
      }catch(error){if(!optional(error))throw error;if(!selected&&(error.code==="ENOENT"||error.code==="ENOTDIR"))continue;hasExisting=true;selected=true;warnings.push(`项目规则未读取：${file}（${error.code}）`);break;}
    }
    for(const name of UNSUPPORTED){let file=path.join(dir,...name.split("/"));try{file=candidatePath(dir,name);if(fs.lstatSync(file,{throwIfNoEntry:false})){hasExisting=true;warnings.push(`发现条件式项目规则，未自动解析，保留原入口：${file}`);}}catch(error){if(!optional(error))throw error;if(error.code!=="ENOENT"&&error.code!=="ENOTDIR"){hasExisting=true;warnings.push(`项目规则入口未检查：${file}（${error.code}）`);}}}
  }
  return {files,warnings,hasExisting};
}

export function loadProjectRuleFiles(cwd:string,supplied:ProjectRuleFile[],warn:(message:string)=>void=console.warn):ProjectRuleFile[] {
  const loaded=discoverProjectRules(cwd),dirs=[...new Set([...projectRuleDirectories(cwd),...projectRuleDirectories(cwd,false)])];loaded.warnings.forEach(warn);
  const owned=(file:string)=>dirs.some(dir=>[...PRIMARY,...ADDITIONAL].some(name=>path.relative(dir,path.resolve(file)).split(path.sep).join("/").toLowerCase()===name.toLowerCase()));
  // Keep SDK user-level resources outside the project's ancestor chain. Inside
  // that chain our ordered adapters preserve the SDK override semantics.
  const global=supplied.filter(file=>!owned(file.path)).flatMap(file=>{
    try{return [{path:file.path,content:readRule(file.path,cwd)}];}
    catch(error){if(!optional(error))throw error;warn(`用户级规则未读取：${file.path}（${error.code}）`);return [];}
  });
  return [...global,...loaded.files];
}

export function initializeProjectRules(cwd:string,template:string,name:string,ancestors=true):string|undefined {
  const existing=discoverProjectRules(cwd,ancestors);if(existing.hasExisting)return existing.warnings.join("\n") || undefined;
  const file=path.join(cwd,"AGENTS.md");
  try {const content=template.replaceAll("{{PROJECT_NAME}}",name);fs.writeFileSync(file,content,{flag:"wx",mode:0o600});seededRules.set(path.resolve(file),{hash:contentHash(content),baseBytes:Buffer.byteLength(content.trimEnd())});markProjectRuleChanged(file);}
  catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")return `默认项目规则未创建，原项目未覆盖：${(error as Error).message}`;}
}

export function initialProjectRuleOwnership(cwd:string):ProjectRuleOwnership|undefined {const owned=seededRules.get(path.resolve(cwd,"AGENTS.md"));return owned?{...owned}:undefined;}
export function finishInitialProjectProfile(cwd:string):void {seededRules.delete(path.resolve(cwd,"AGENTS.md"));}

/** The project registry, not setup status or a project-owned JSON file, supplies
 * this content proof. Changed text and non-regular replacements remain untouched. */
export function assertInitialProjectRules(cwd:string,owned:ProjectRuleOwnership):Buffer {
  const file=path.resolve(cwd,"AGENTS.md"),conflict=()=>new Error("项目规则已被修改、替换或无法验证所有权，已保留原文件；新配置未应用，请先核对项目规则");
  if(!owned||!/^[a-f0-9]{64}$/u.test(owned.hash)||!Number.isSafeInteger(owned.baseBytes)||owned.baseBytes<0)throw conflict();
  const selected=discoverProjectRules(cwd,false);if(selected.warnings.length||path.resolve(selected.files[0]?.path ?? cwd)!==file)throw conflict();
  const stat=fs.lstatSync(file,{throwIfNoEntry:false});if(!stat?.isFile()||stat.isSymbolicLink())throw conflict();
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW ?? 0));
  try{const opened=fs.fstatSync(fd),content=fs.readFileSync(fd);if(opened.dev!==stat.dev||opened.ino!==stat.ino||owned.baseBytes>content.length||contentHash(content)!==owned.hash)throw conflict();return content;}
  finally{fs.closeSync(fd);}
}
export function initialProjectProfileContent(content:Buffer,baseBytes:number,specification:string):string {return `${content.subarray(0,baseBytes).toString("utf8")}\n\n## 项目形态约定\n\n${specification.trim()}\n`;}
export function restoreInitialProjectRules(cwd:string,expected:ProjectRuleOwnership,previous:Buffer):void {assertInitialProjectRules(cwd,expected);const file=path.resolve(cwd,"AGENTS.md");atomicWrite(file,previous.toString("utf8"));seededRules.set(file,{hash:contentHash(previous),baseBytes:expected.baseBytes});markProjectRuleChanged(file);}

/** Retry may replace only the still-owned generated suffix, until session start
 * explicitly closes creation. Metadata is returned for the existing registry. */
export function applyInitialProjectProfile(cwd:string,specification:string,ownership=initialProjectRuleOwnership(cwd)):ProjectRuleOwnership|undefined {
  if(!ownership)return;
  const file=path.resolve(cwd,"AGENTS.md"),content=assertInitialProjectRules(cwd,ownership);
  const next=initialProjectProfileContent(content,ownership.baseBytes,specification),hash=contentHash(next);
  if(hash===ownership.hash)return {...ownership};
  atomicWrite(file,next);const owned={hash,baseBytes:ownership.baseBytes};seededRules.set(file,owned);markProjectRuleChanged(file);return {...owned};
}
