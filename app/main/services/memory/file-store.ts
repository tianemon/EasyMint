import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {hashText} from "./codec";
import {readDocument,DOCUMENT_SEED,DOCUMENT_MAX_BYTES} from "./document-store";

export interface FileChange {file:string;before:string|null;after:string|null;temporary?:string}
export interface FileCommit {id:string;changes:string;files:FileChange[]}

/** One staging area for shallow facts, dated details and topic experiences.
 * The SQLite transaction supplies an index-only changeset. Prepared bodies stay
 * in adjacent temporary files until every installation can be recovered. */
export class MemoryFileStore {
  private staged=new Map<string,{before:string|null;after:string|null}>();
  private virtual=new Map<string,string>();
  constructor(readonly root:string|undefined) {}
  begin():void {this.staged.clear();}
  resolve(file:string):string {
    if(!this.root)throw new Error("虚拟记忆没有磁盘路径");
    const parts=file.split("/");
    const main=file==="MEMORY.md",deep=/^deep\/\d{4}-\d{2}-\d{2}\/MEMORY\.md$/u.test(file);
    const experience=/^\.\.\/experiences\/(?:history\/)?[\p{L}\p{N}_!-][^/\\\0]*\.md$/u.test(file);
    if(!main&&!deep&&!experience)throw new Error("记忆正文位置无效");
    const base=experience?path.resolve(this.root,"..","experiences"):this.root;
    const relative=experience?parts.slice(2):parts;
    let target=base;
    for(const segment of relative){
      if(segment==="."||segment==="..")throw new Error("记忆正文位置无效");
      target=path.join(target,segment);
      const stat=fs.lstatSync(target,{throwIfNoEntry:false});if(stat?.isSymbolicLink())throw new Error("记忆目录或正文不能是符号链接");
    }
    const baseStat=fs.lstatSync(base,{throwIfNoEntry:false});if(baseStat?.isSymbolicLink())throw new Error("记忆目录不能是符号链接");
    return target;
  }
  read(file:string):string|null {
    const staged=this.staged.get(file);if(staged)return staged.after;
    return this.root?readDocument(this.resolve(file)):this.virtual.get(file) ?? (file==="MEMORY.md"?DOCUMENT_SEED:null);
  }
  stage(file:string,text:string|null):void {
    if(text!==null && Buffer.byteLength(text,"utf8")>DOCUMENT_MAX_BYTES)throw new Error("记忆正文超出安全文件大小");
    const current=this.staged.get(file),before=current?current.before:this.read(file);
    if(before===text){this.staged.delete(file);return;}
    this.staged.set(file,{before,after:text});
  }
  changed():boolean {return this.staged.size>0;}
  applyVirtual():void {for(const [file,{after}] of this.staged){if(after===null)this.virtual.delete(file);else this.virtual.set(file,after);}this.begin();}
  prepare(id:string,changes:string):FileCommit {
    const files:FileChange[]=[];
    try{
      for(const [file,value] of this.staged){
        const target=this.resolve(file),temporary=value.after!==null?`${target}.${id}.${randomUUID()}.pending`:undefined;
        files.push({file,before:value.before===null?null:hashText(value.before),after:value.after===null?null:hashText(value.after),...(temporary?{temporary}:{})});
        if(temporary && value.after!==null){
          fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
          const fd=fs.openSync(temporary,"wx",0o600);try{fs.writeFileSync(fd,value.after);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
        }
      }
      return {id,changes,files:files.sort((a,b)=>Number(a.file==="MEMORY.md")-Number(b.file==="MEMORY.md"))};
    }catch(error){this.cleanup({id,changes,files});throw error;}
  }
  install(commit:FileCommit):void {
    for(const change of commit.files){
      const target=this.resolve(change.file),current=readDocument(target),hash=current===null?null:hashText(current);
      if(hash===change.after)continue;
      if(hash!==change.before)throw new Error("记忆正文在提交期间变化，原件和恢复材料已保留");
      if(change.after===null){if(current!==null)fs.unlinkSync(target);continue;}
      const temporary=change.temporary;
      if(!temporary || path.dirname(temporary)!==path.dirname(target) || !path.basename(temporary).startsWith(`${path.basename(target)}.${commit.id}.`))throw new Error("记忆恢复临时文件位置无效");
      if(hashText(readDocument(temporary) ?? "")!==change.after)throw new Error("记忆恢复正文缺失或不完整，原件已保留");
      fs.renameSync(temporary,target);
    }
  }
  cleanup(commit:FileCommit):void {
    for(const change of commit.files)if(change.temporary){
      const target=this.resolve(change.file),temporary=change.temporary;
      if(path.dirname(temporary)!==path.dirname(target)||!path.basename(temporary).startsWith(`${path.basename(target)}.${commit.id}.`))throw new Error("记忆恢复临时文件位置无效");
      try{fs.unlinkSync(temporary);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
    }
  }
}
