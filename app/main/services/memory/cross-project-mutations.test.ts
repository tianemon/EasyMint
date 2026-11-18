import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import type {Store} from "../store";
import type {MemoryPort} from "./client";
import {MemoryDatabase} from "./database";
import {MemoryService,type MemorySessionContext} from "./service";
import {createMemoryTool} from "../tools/memory-tool";
vi.mock("../session-cache",()=>({readCache:()=>undefined}));
vi.mock("../pi-sdk",()=>({getDefineToolFn:async()=>((definition:unknown)=>definition),getSessionDataHelpers:async()=>({currentVersion:3,buildSessionProjection:(entries:any[])=>({entries:entries.map(sourceEntry=>({sourceEntry,messages:sourceEntry.type==="message"?[sourceEntry.message]:[]}))})})}));
const fixtures:Array<{root:string;db:MemoryDatabase;service:MemoryService}>=[];
afterEach(async()=>{for(const f of fixtures.splice(0)){await f.service.close();f.db.close();fs.rmSync(f.root,{recursive:true,force:true});}});
async function setup(user:string,family:"memory"|"experience"="memory"){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"em-cross-project-write-")),db=new MemoryDatabase(path.join(root,"memory","memory.sqlite"));
 const projects=[{id:"project-a",name:"Project A",path:path.join(root,"a")},{id:"project-b",name:"Project B",path:path.join(root,"b")}];
 const store={getDataDir:()=>root,getProjects:()=>projects,getSettings:()=>({memory:{enabled:true,background:false}})} as unknown as Store;
 const port={call:async(method:string,...args:unknown[])=>(db as any)[method](...args)} as MemoryPort;
 const service=new MemoryService(store,{port,busy:()=>false,getBackend:async()=>{throw new Error("No provider is allowed in cross-project mutation tests");}});
 const now=Date.now(),context:MemorySessionContext={sessionId:"reader",projectPath:projects[0]!.path,entries:[{type:"message",id:"u",parentId:null,timestamp:new Date(now).toISOString(),message:{role:"user",content:user,timestamp:now}}],projection:[]};
 const item=db.save({kind:family==="experience"?"lesson":"activity",text:"PROJECT_B_ORIGINAL_BODY"},{projectId:projects[1]!.id,confirmed:true,source:{type:"manual",ref:"original"}}).item;
 const tool=await createMemoryTool(service,()=>context,family);await service.initialize();fixtures.push({root,db,service});
 const run=async(params:Record<string,unknown>)=>{
  context.entries=context.entries.slice(0,1);context.entries.push({type:"message",id:"call",parentId:"u",timestamp:new Date(now+1).toISOString(),message:{role:"assistant",content:[{type:"toolCall",id:"mutation",name:family,arguments:params}],stopReason:"toolUse",timestamp:now+1}});
  const result=await tool.execute("mutation",params,new AbortController().signal,undefined,{} as never),block=result.content.find(part=>part.type==="text");if(!block||block.type!=="text")throw new Error("missing result");return JSON.parse(block.text);
 };
 return {db,service,context,item,run};
}
it("forgets an explicitly selected Project B item from Project A and removes its body",async()=>{
 const quote="忘记Project B的这条记忆",f=await setup(quote);
 const result=await f.run({action:"forget",key:f.item.key,projectId:"project-b",quote});expect(result.forgotten).toBe(true);expect(f.db.get(f.item.key,"project-b")).toBeUndefined();expect(fs.readFileSync(f.db.documentFile!,"utf8")).not.toContain("PROJECT_B_ORIGINAL_BODY");
});
it.each([true,false])("updates the authorized target using full scoped key=%s",fullKey=>{
 return (async()=>{const quote="请将Project B的这条记忆更正为受控验证已完成",f=await setup(quote);
  const result=await f.run({action:"update",key:fullKey?f.item.key:f.item.id,...(fullKey?{}:{projectId:"project-b"}),revision:f.item.revision,kind:"activity",text:"受控验证已完成",basis:"explicit",quote});expect(result.key).toBe(f.item.key);expect(f.db.get(f.item.key,"project-b")?.text).toBe("受控验证已完成");
 })();
});
it("derives the target project from a full key only with current cross-project authorization",async()=>{
 const quote="忘记Project B的这条记忆",f=await setup(quote);expect((await f.run({action:"forget",key:f.item.key,quote})).forgotten).toBe(true);
});
it.each(["forget","update"])("rejects unauthorized or contradictory project scope for %s",async action=>{
 const quote=action==="forget"?"忘记这条记忆":"请把这条记忆更正为受控验证已完成",f=await setup(quote),params={action,key:f.item.key,projectId:"project-b",revision:f.item.revision,kind:"activity",text:"受控验证已完成",basis:"explicit",quote};
 await expect(f.run(params)).rejects.toThrow("跨项目");await expect(f.run({...params,projectId:"project-a"})).rejects.toThrow("范围");expect(f.db.get(f.item.key,"project-b")?.text).toBe("PROJECT_B_ORIGINAL_BODY");
 f.context.limited=true;await expect(f.run(params)).rejects.toThrow("执行Agent");expect(f.db.get(f.item.key,"project-b")?.text).toBe("PROJECT_B_ORIGINAL_BODY");
});
it("does not let an explicit project ID select a global item through a bare ID",async()=>{
 const quote="忘记Project B的这条记忆",f=await setup(quote),global=f.db.save({kind:"activity",text:"GLOBAL_BODY"},{confirmed:true,source:{type:"manual",ref:"global"}}).item;
 await expect(f.run({action:"forget",key:global.id,projectId:"project-b",quote})).rejects.toThrow("范围");expect(f.db.get(global.key)?.text).toBe("GLOBAL_BODY");
});
it("returns a neutral idempotent response for an absent authorized item",async()=>{
 const quote="忘记Project B的这条记忆",f=await setup(quote),result=await f.run({action:"forget",key:"project:project-b/missing",projectId:"project-b",quote});expect(result.forgotten).toBe(false);expect(result.contextNotice).not.toContain("已移除");expect(f.db.get(f.item.key,"project-b")?.text).toBe("PROJECT_B_ORIGINAL_BODY");
});
it.each(["memory","experience"] as const)("saves %s to the explicitly authorized project and rejects global-plus-project ambiguity",async family=>{
 const quote="请在Project B保存受控验证已完成的结论",f=await setup(quote,family);
 const fields=family==="memory"?{kind:"activity",text:"受控验证已完成"}:{title:"受控读取验证方法",when:"相同条件的读取对照",do:"比较更改前后结果",verification:"该对照已通过",limits:"只覆盖相同条件"};
 const params={action:"save",projectId:"project-b",basis:"explicit",quote,...fields};
 const result=await f.run(params);expect(result.key).toMatch(/^project:project-b\//u);expect(f.db.query({projectId:"project-a",scope:"project",family}).total).toBe(0);
 await expect(f.run({...params,scope:"global"})).rejects.toThrow("范围");
 f.context.limited=true;await expect(f.run(params)).rejects.toThrow("执行Agent");
});
it("does not save to another project without a current user request naming that scope",async()=>{
 const quote="请记住受控验证已完成",f=await setup(quote);await expect(f.run({action:"save",projectId:"project-b",basis:"explicit",quote,kind:"activity",text:"受控验证已完成"})).rejects.toThrow("跨项目");expect(f.db.query({projectId:"project-b",scope:"project"}).total).toBe(1);
});
it.each(["invalidate","archive"])("applies experience %s to the authorized target without changing its scope",async action=>{
 const quote="Project B的这条经验不再成立，请标记失效",f=await setup(quote,"experience");
 const result=await f.run({action,key:f.item.key,projectId:"project-b",revision:f.item.revision,text:"原条件已改变，用户确认不再采用",quote});expect(result.key).toBe(f.item.key);expect(f.db.get(f.item.key,"project-b")?.lifecycle).toBe("archived");expect(f.db.get(f.item.key,"project-b")?.projectId).toBe("project-b");
});
it("rejects experience invalidation with unauthorized, contradictory or child project scope",async()=>{
 const quote="这条经验不再成立，请标记失效",f=await setup(quote,"experience"),params={action:"invalidate",key:f.item.key,projectId:"project-b",revision:f.item.revision,text:"用户确认不再采用",quote};
 await expect(f.run(params)).rejects.toThrow("跨项目");await expect(f.run({...params,projectId:"project-a"})).rejects.toThrow("范围");f.context.limited=true;await expect(f.run(params)).rejects.toThrow("执行Agent");expect(f.db.get(f.item.key,"project-b")?.lifecycle).toBe("active");
});
it.each(["read_summary","write_summary"])("explicitly rejects projectId on the current-scope document action %s",async action=>{
 const f=await setup("请查看Project B的记忆");await expect(f.run({action,projectId:"project-b",hash:"unused"})).rejects.toThrow("不支持projectId");expect(f.db.get(f.item.key,"project-b")?.text).toBe("PROJECT_B_ORIGINAL_BODY");
});
it.each([
 {user:"不要忘记Project B的这条记忆",quote:"忘记Project B的这条记忆"},
 {user:"不要删除Project B的这条记忆",quote:"删除Project B的这条记忆"},
 {user:"“忘记Project B的这条记忆”",quote:"忘记Project B的这条记忆"},
 {user:"假设我说忘记Project B的这条记忆，该怎么办",quote:"忘记Project B的这条记忆"},
])("does not turn a negative, quoted or hypothetical clause into forget consent: $user",async({user,quote})=>{
 const f=await setup(user);f.context.projectPath=f.service.projectById("project-b")!.path;
 await expect(f.run({action:"forget",key:f.item.key,quote})).rejects.toThrow("明确原话");expect(f.db.get(f.item.key,"project-b")?.text).toBe("PROJECT_B_ORIGINAL_BODY");
});
it.each([
 "只看Project A，不要读取其他项目/Project B",
 "只看Project A，不要读取其他项目",
 "“查看Project B”",
 "假设你读取Project B，会有哪些影响",
])("does not mistake denied or quoted scope for cross-project consent: %s",async user=>{
 const f=await setup(user);await expect(f.service.query(f.context,{projectId:"project-b"})).rejects.toThrow("跨项目");expect(f.db.get(f.item.key,"project-b")?.text).toBe("PROJECT_B_ORIGINAL_BODY");
});
it.each(["不要再记Project B的这条记忆","别记Project B的这条记忆"])("retains an actual affirmative forget request: %s",async quote=>{
 const f=await setup(quote);expect((await f.run({action:"forget",key:f.item.key,projectId:"project-b",quote})).forgotten).toBe(true);
});
it("keeps a verified ask_user affirmative JSON answer usable as user consent",async()=>{
 const answer=JSON.stringify({answer:"忘记Project B的这条记忆"}),f=await setup("unused");
 f.context.entries=[{type:"message",id:"u",parentId:null,timestamp:new Date().toISOString(),message:{role:"toolResult",toolName:"ask_user",content:[{type:"text",text:answer}],details:{memoryUserEvidence:answer,memoryUserAnswers:[{question:"请选择记忆操作",answer}]},timestamp:Date.now()}}];
 expect((await f.run({action:"forget",key:f.item.key,projectId:"project-b",quote:answer})).forgotten).toBe(true);
});
it.each(["不要","是"])("uses the actual ask_user answer, not its model question, for forget: %s",async answer=>{
 const question="要忘记Project B的这条记忆吗？",text=`${question}\n${answer}`,f=await setup("unused");
 f.context.projectPath=f.service.projectById("project-b")!.path;
 f.context.entries=[{type:"message",id:"u",parentId:null,timestamp:new Date().toISOString(),message:{role:"toolResult",toolName:"ask_user",content:[{type:"text",text}],details:{memoryUserEvidence:text,memoryUserAnswers:[{question,answer}]},timestamp:Date.now()}}];
 const action=f.run({action:"forget",key:f.item.key,quote:"忘记Project B的这条记忆"});if(answer==="不要"){await expect(action).rejects.toThrow("明确原话");expect(f.db.get(f.item.key,"project-b")).toBeDefined();}else expect((await action).forgotten).toBe(true);
});
it.each(["否","是"])("uses the actual ask_user answer for cross-project scope: %s",async answer=>{
 const question="是否读取Project B？",text=`${question}\n${answer}`,f=await setup("unused");
 f.context.entries=[{type:"message",id:"u",parentId:null,timestamp:new Date().toISOString(),message:{role:"toolResult",toolName:"ask_user",content:[{type:"text",text}],details:{memoryUserEvidence:text,memoryUserAnswers:[{question,answer}]},timestamp:Date.now()}}];
 const read=f.service.query(f.context,{projectId:"project-b"});if(answer==="否")await expect(read).rejects.toThrow("跨项目");else expect((await read).items[0]?.key).toBe(f.item.key);
});
it.each(["不要","是"])("uses only actual ask_user consent for maintenance: %s",async answer=>{
 const question="是否归档这条记忆？",text=`${question}\n${answer}`,f=await setup("unused");f.context.projectPath=f.service.projectById("project-b")!.path;
 f.context.entries=[{type:"message",id:"u",parentId:null,timestamp:new Date().toISOString(),message:{role:"toolResult",toolName:"ask_user",content:[{type:"text",text}],details:{memoryUserEvidence:text,memoryUserAnswers:[{question,answer}]},timestamp:Date.now()}}];
 const action=f.service.manageFromAgent(f.context,"archive",{key:f.item.key,revision:f.item.revision,quote:"归档这条记忆"});if(answer==="不要"){await expect(action).rejects.toThrow("明确");expect(f.db.get(f.item.key,"project-b")?.lifecycle).toBe("active");}else expect((await action).item.lifecycle).toBe("archived");
});
it.each(["Project B 只是背景。本次只处理 Project A。","请查看Project B。本次只处理 Project A。"])("does not treat background mentions or an excluded only scope as permission: %s",async user=>{
 const f=await setup(user);await expect(f.service.query(f.context,{projectId:"project-b"})).rejects.toThrow("跨项目");
});
it("preserves direct commands with quoted objects and opaque project names",async()=>{
 const quote="请忘记“Project B的这条记忆”",f=await setup(quote);expect((await f.run({action:"forget",key:f.item.key,quote})).forgotten).toBe(true);
 const other=await setup("请查看“Example.v1”");other.service.projectById("project-b")!.name="Example.v1";expect((await other.service.query(other.context,{projectId:"project-b"})).items[0]?.key).toBe(other.item.key);
});
