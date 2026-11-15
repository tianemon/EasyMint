import { Worker } from "node:worker_threads";
import path from "node:path";
import type { MemoryMethods } from "./worker";

export interface MemoryPort {
  call<K extends keyof MemoryMethods>(method:K,...args:Parameters<MemoryMethods[K]>):Promise<Awaited<ReturnType<MemoryMethods[K]>>>;
  readonly unavailable?:boolean;
  close?():Promise<void>;
}
/** The worker owns SQLite and filesystem migration/export; never touches Electron or credentials. */
export class MemoryClient implements MemoryPort {
  private worker:Worker;
  private nextId=0;
  private closing=false;
  private closePromise:Promise<void>|undefined;
  private failure:Error|undefined;
  private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
  private ready:Promise<void>;
  get unavailable():boolean {return this.closing || Boolean(this.failure);}
  constructor(file:string,workerFile=path.join(__dirname,"memory-worker.cjs")) {
    this.worker=new Worker(workerFile.replace(/\.asar([\\/])/u,".asar.unpacked$1"),{workerData:{file}});
    this.ready=new Promise<void>((resolve,reject) => {
      const fail=(error:Error) => {
        this.failure=error;
        reject(error);
        for (const entry of this.pending.values()) entry.reject(error);
        this.pending.clear();
      };
      this.worker.on("error",fail);
      this.worker.on("exit",code => { if (!this.closing) fail(new Error(`记忆服务意外退出（${code}）`)); });
      this.worker.on("message",(reply:{ready?:boolean;id:number;result:unknown;error?:string}) => {
        if (reply.ready) { resolve(); return; }
        const request=this.pending.get(reply.id); if (!request) return;
        this.pending.delete(reply.id);
        if (reply.error) request.reject(new Error(reply.error)); else request.resolve(reply.result);
      });
    });
  }
  async call<K extends keyof MemoryMethods>(method:K,...args:Parameters<MemoryMethods[K]>):Promise<Awaited<ReturnType<MemoryMethods[K]>>> {
    if (this.closing) throw new Error("记忆服务已关闭");
    await this.ready;
    if (this.failure) throw this.failure;
    const id=++this.nextId;
    return new Promise<Awaited<ReturnType<MemoryMethods[K]>>>((resolve,reject) => {
      this.pending.set(id,{resolve,reject});
      try { this.worker.postMessage({id,method,args}); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }
  close():Promise<void> { return this.closePromise ??= this.finishClose(); }
  private async finishClose():Promise<void> {
    const graceful=this.call("close").catch(()=>undefined);
    this.closing=true;
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {await Promise.race([graceful,new Promise<void>(resolve=>{timer=setTimeout(resolve,2_000);})]);}
    finally {if(timer)clearTimeout(timer);}
    for(const request of this.pending.values())request.reject(new Error("记忆服务正在关闭"));
    this.pending.clear();
    await this.worker.terminate();
  }
}
