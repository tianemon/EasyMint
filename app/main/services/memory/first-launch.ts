import fs from "node:fs";
import path from "node:path";
import {readDocument} from "./document-store";
import {parseEntries} from "./memory-entries";

function ordinary(file:string):fs.Stats|undefined {
 const stat=fs.lstatSync(file,{throwIfNoEntry:false});if(!stat)return;
 if(stat.isSymbolicLink()||!stat.isDirectory()&&!stat.isFile())throw new Error(`旧记忆清理路径不是普通文件或目录：${file}`);
 return stat;
}
function plan(file:string,files:string[],directories:string[]):void {
 const stat=ordinary(file);if(!stat)return;
 if(!(stat.mode&0o222))throw new Error(`旧记忆清理路径只读：${file}`);
 if(stat.isDirectory()){for(const child of fs.readdirSync(file))plan(path.join(file,child),files,directories);directories.push(file);}
 else files.push(file);
}
function removeTargets(roots:string[],targets:string[]):void {
 for(const root of roots){const stat=ordinary(root);if(stat&&(!stat.isDirectory()||!(stat.mode&0o222)))throw new Error(`旧记忆清理根目录无效或只读：${root}`);}
 const files:string[]=[],directories:string[]=[];for(const target of targets)plan(target,files,directories);
 for(const file of files)fs.unlinkSync(file);for(const directory of directories)fs.rmdirSync(directory);
}
/** 标准布局才访问父级全局目录；隔离数据库不猜测其父目录属于EasyMint。 */
export function memoryHome(memoryRoot:string):string {return path.basename(memoryRoot)==="memory"?path.dirname(memoryRoot):memoryRoot;}
export function assertNoUnindexedBodies(memoryRoot:string):void {
 for(const root of new Set([memoryHome(memoryRoot),memoryRoot])){const stat=ordinary(root);if(stat&&!stat.isDirectory())throw new Error("记忆根目录不是普通目录");}
 const main=readDocument(path.join(memoryRoot,"MEMORY.md"));
 if(main&&parseEntries(main).length||fs.lstatSync(path.join(memoryRoot,"deep"),{throwIfNoEntry:false})||fs.lstatSync(path.join(memoryRoot,"index-commit.json"),{throwIfNoEntry:false}))throw new Error("记忆索引缺失或资格状态不完整，正文已保留；请恢复数据库后重试");
 const experienceRoot=path.join(memoryHome(memoryRoot),"experiences");
 const visit=(dir:string):void=>{const stat=ordinary(dir);if(!stat)return;if(stat.isDirectory())for(const child of fs.readdirSync(dir))visit(path.join(dir,child));else if(dir.endsWith(".md")&&parseEntries(readDocument(dir) ?? "").length)throw new Error("经验索引缺失，正文已保留；请恢复数据库后重试");};
 visit(experienceRoot);
}
/** 首次上线只清理这些已退役入口，普通会话、项目文档和配置备份不在范围内。 */
export function cleanupLegacyGlobal(memoryRoot:string):void {
 const home=memoryHome(memoryRoot);for(const root of new Set([home,memoryRoot])){const stat=ordinary(root);if(stat&&!stat.isDirectory())throw new Error("记忆根目录不是普通目录");}
 const targets=[path.join(memoryRoot,"deep"),path.join(home,"experiences"),path.join(home,"learn-state.json"),path.join(memoryRoot,"index-commit.json")];
 for(const entry of fs.readdirSync(memoryRoot))if(/^MEMORY\.md\..+\.pending$/u.test(entry)||/^index-commit\.json\..+\.tmp$/u.test(entry))targets.push(path.join(memoryRoot,entry));
 removeTargets([...new Set([home,memoryRoot])],targets);
}
/** 旧项目入口清理失败只返回警告；不跟随链接，也不扩大到项目正文。 */
export function cleanupLegacyProject(projectPath:string):{warnings:string[]} {
 try{const root=path.resolve(projectPath),metadata=path.join(root,".easymint");if(!ordinary(root)?.isDirectory())throw new Error("项目目录尚不可访问");removeTargets([root,metadata],[path.join(metadata,"experiences"),path.join(metadata,"learn-state.json")]);return {warnings:[]};}
 catch(error){return {warnings:[`项目旧经验未清理：${(error as Error).message}`]};}
}
