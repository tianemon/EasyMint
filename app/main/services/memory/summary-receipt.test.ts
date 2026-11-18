import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {expect,it,vi} from 'vitest';
import {MemoryDatabase} from './database';
import {MemoryService,type MemorySessionContext} from './service';
import {createMemoryTool} from '../tools/memory-tool';
import {parseEntries,upsertEntry} from './memory-entries';
import {estimateMemoryTokens} from './context';
vi.mock('../session-cache',()=>({readCache:()=>undefined}));
vi.mock('../pi-sdk',()=>({getDefineToolFn:async()=>((value:unknown)=>value),getSessionDataHelpers:async()=>({currentVersion:3,buildSessionProjection:(entries:any[])=>({entries:entries.map(sourceEntry=>({sourceEntry,messages:sourceEntry.type==='message'?[sourceEntry.message]:[]}))})})}));
it('returns the committed hash after capacity downshift and accepts it for the next summary edit',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'em-tool-write-timing-')),db=new MemoryDatabase(path.join(root,'memory','memory.sqlite'));let service:MemoryService|undefined;
 try{
  const project=path.join(root,'project');fs.mkdirSync(project);
  const store={getDataDir:()=>root,getSettings:()=>({memory:{enabled:true,background:false}}),getProjects:()=>[{id:'p',name:'Project',path:project}]} as any;
  const port={call:async(method:string,...args:unknown[])=>(db as any)[method](...args)} as any;
  service=new MemoryService(store,{port,busy:()=>false,getBackend:async()=>{throw new Error('No provider is allowed');}});await service.initialize();
  const saved=[];for(let i=0;i<12;i++)saved.push(db.save({kind:'activity',text:`阶段验证结论${i}`},{confirmed:true,source:{type:'manual',ref:`source-${i}`}}).item);
  const base=db.scopeDocument();const entries=parseEntries(base.content);
  const candidate=(length:number)=>{let content=base.content;for(const entry of entries)content=upsertEntry(content,{...entry,details:'界'.repeat(length)});return content;};
  let low=0,high=1500;while(low<high){const middle=Math.ceil((low+high)/2);if(estimateMemoryTokens(candidate(middle))<=7850)low=middle;else high=middle-1;}
  for(const item of saved)db.update(item.key,undefined,item.revision,{details:'界'.repeat(low)});
  const initial=db.scopeDocument(),beforeTokens=estimateMemoryTokens(initial.content);expect(beforeTokens).toBeGreaterThan(7800);expect(beforeTokens).toBeLessThanOrEqual(7850);
  const context:MemorySessionContext={sessionId:'reader',projectPath:project,entries:[{type:'message',id:'u',parentId:null,timestamp:new Date().toISOString(),message:{role:'user',content:'请整理记忆，完善已有结论的表达。',timestamp:Date.now()}}],projection:[],usage:{tokens:1000,contextWindow:100000}};
  const tool=await createMemoryTool(service,()=>context);
  const execute=async(params:Record<string,unknown>)=>{const result=await tool.execute('fixture',params,new AbortController().signal,undefined,{} as never);const text=result.content.find(part=>part.type==='text');if(!text||text.type!=='text')throw new Error('missing result');return JSON.parse(text.text);};
  let read='',offset=0,readCalls=0,hash='';for(;;){const page=await execute({action:'read_summary',offset,maintenanceQuote:'请整理记忆'});read+=page.content;hash=page.hash;readCalls++;if(page.nextOffset===undefined)break;offset=page.nextOffset;}
  expect(read).toBe(initial.content);expect(hash).toBe(initial.hash);
  const first=entries[0]!.text,edited=initial.content.replace(first,first+'补'.repeat(200)),requestedTokens=estimateMemoryTokens(edited);expect(requestedTokens).toBeGreaterThan(8000);expect(requestedTokens).toBeLessThan(8100);
  const receipt=await execute({action:'write_summary',hash,edits:[{oldText:first,newText:first+'补'.repeat(200)}]});
  const committed=db.scopeDocument(),committedTokens=estimateMemoryTokens(committed.content);expect(committedTokens).toBeLessThanOrEqual(8000);expect(receipt.hash).toBe(committed.hash);
  const next=await execute({action:'write_summary',hash:receipt.hash,edits:[{oldText:entries[2]!.text,newText:entries[2]!.text+'的整理表达'}]});
  expect(next.hash).toBe(db.scopeDocument().hash);
  await expect(execute({action:'write_summary',hash,edits:[{oldText:entries[2]!.text+'的整理表达',newText:entries[2]!.text}]})).rejects.toThrow('changed');
  expect(readCalls).toBeGreaterThan(1);
  expect(saved.every(item=>db.get(item.key)?.details?.length===low)).toBe(true);
 }finally{await service?.close();db.close();fs.rmSync(root,{recursive:true,force:true});}
});
