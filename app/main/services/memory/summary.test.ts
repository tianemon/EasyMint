import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it} from "vitest";
import {MemoryDatabase} from "./database";
import {readSummary,writeSummary,readSummaryDocument,saveSummaryDocument} from "./summary";
const fixtures:Array<{root:string;db:MemoryDatabase}>=[];
const setup=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"em-memory-digest-")),db=new MemoryDatabase(path.join(root,"memory.sqlite"));fixtures.push({root,db});return {db,file:path.join(root,"MEMORY.md")};};
afterEach(()=>{for(const {db,root} of fixtures.splice(0)){db.close();fs.rmSync(root,{recursive:true,force:true});}});
it("selects important user notes and high-level project activity, never design detail or candidates",()=>{
 const {db,file}=setup();
 db.save({kind:"background",text:"用户从事研究",summary:"用户从事研究",details:"不应自动展开的详情"},{source:{type:"manual",ref:"g"},confirmed:true});
 db.save({kind:"preference",text:"尚未确认",summary:"候选不可进入摘要"},{source:{type:"session",ref:"c"},confirmed:false});
 db.save({kind:"decision",text:"采用具体设计",summary:"具体设计不能出现在MD",details:"某个实现参数"},{projectId:"p",source:{type:"manual",ref:"d"},confirmed:true});
 const event=db.save({kind:"activity",text:"讨论具体设计",summary:"近期关注记忆管理"},{projectId:"p",source:{type:"manual",ref:"a"},confirmed:true}).item;
 const result=writeSummary(db,file,[{id:"p",name:"EasyMint"}]);
 expect(result.content).toContain("用户从事研究");expect(result.content).toContain("EasyMint");expect(result.content).toContain(event.key);
 expect(result.content).not.toContain("不应自动展开");expect(result.content).not.toContain("候选不可");expect(result.content).not.toContain("具体设计");
 expect(readSummary(db,file,[{id:"p",name:"EasyMint"}],"other").content).not.toContain("近期关注记忆管理");
});
it("preserves edited document contents while reporting grounded changes and filtering withdrawn references",()=>{
 const {db,file}=setup();
 const item=db.save({kind:"preference",text:"简洁回答",summary:"简洁回答"},{source:{type:"manual",ref:"g"},confirmed:true}).item;
 const prior=readSummaryDocument(db,file,[]);saveSummaryDocument(db,file,[],prior.content+"\n用户自己保留的文字\n",prior.hash);
 db.update(item.key,undefined,1,{text:"解释详细些",summary:"解释详细些"});
 const pending=readSummaryDocument(db,file,[]);expect(pending.content).toContain("用户自己保留");expect(pending.content).toContain("简洁回答");expect(pending.needsReview).toBe(true);expect(pending.changes).toContain("解释详细些");
 expect(readSummary(db,file,[]).content).not.toContain("简洁回答");
 const next=pending.content.split("\n").filter(line=>!line.includes(`memory:${item.key} `)).join("\n")+"\n"+pending.changes+"\n";
 saveSummaryDocument(db,file,[],next,pending.hash,pending.reviewHash);expect(readSummary(db,file,[]).content).toContain("解释详细些");expect(readSummaryDocument(db,file,[]).needsReview).toBe(false);
 db.forget(item.key);expect(readSummary(db,file,[]).content).not.toContain("解释详细些");expect(fs.readFileSync(file,"utf8")).toContain("用户自己保留");
});
it("rejects stale saves and never replaces edits on unrelated database changes",()=>{
 const {db,file}=setup();const original=readSummaryDocument(db,file,[]);
 const saved=saveSummaryDocument(db,file,[],"# 我的轻量记忆\n偏好保留自己的表达\n",original.hash);
 db.save({kind:"decision",text:"不会进MD的细节"},{projectId:"p",source:{ref:"details",type:"manual"},confirmed:true});
 expect(readSummaryDocument(db,file,[]).content).toBe(saved.content);expect(readSummaryDocument(db,file,[]).needsReview).toBe(false);
 expect(()=>saveSummaryDocument(db,file,[],"旧草稿覆盖",original.hash)).toThrow("changed");expect(fs.readFileSync(file,"utf8")).toBe(saved.content);
});

it("reports an ordinary file I/O failure and returns bounded derived data without changing facts",()=>{
 const {db,file}=setup();db.save({kind:"preference",text:"有效偏好",summary:"有效偏好"},{source:{type:"manual",ref:"g"},confirmed:true});
 fs.mkdirSync(file);
 const result=writeSummary(db,file,[]);expect(result.error).toBeTruthy();expect(result.content).toContain("有效偏好");expect(db.query().total).toBe(1);
});
it("does not let unselected records or one busy project crowd out selected user and project entries",()=>{
 const {db,file}=setup();db.save({kind:"background",text:"重要用户背景",summary:"重要用户背景"},{confirmed:true,source:{type:"manual",ref:"user"},evidenceAt:1});
 for(let i=0;i<50;i++)db.save({kind:"decision",text:`不进摘要的决定${i}`,summary:""},{confirmed:true,source:{type:"manual",ref:`d${i}`}});
 for(let i=0;i<110;i++)db.save({kind:"activity",text:`项目A事件${i}`,summary:"项目A最近活动"},{projectId:"a",confirmed:true,source:{type:"manual",ref:`a${i}`}});
 db.save({kind:"activity",text:"项目B的事件",summary:"项目B最近活动"},{projectId:"b",confirmed:true,source:{type:"manual",ref:"b"},evidenceAt:1});
 const result=writeSummary(db,file,[{id:"a",name:"项目A"},{id:"b",name:"项目B"}]);
 expect(result.content).toContain("重要用户背景");expect(result.content).toContain("项目A最近活动");expect(result.content).toContain("项目B最近活动");
});
it("applies legacy pinned-summary length and kind eligibility before limiting rows",()=>{
 const {db,file}=setup();db.save({kind:"background",text:"旧的重要背景"},{confirmed:true,pinned:true,evidenceAt:1,source:{type:"manual",ref:"old"}});
 for(let i=0;i<50;i++)db.save({kind:"preference",text:`长偏好${i}${"较长的旧内容".repeat(30)}`},{confirmed:true,pinned:true,source:{type:"manual",ref:`long-${i}`}});
 for(let i=0;i<50;i++)db.save({kind:"attention",text:`未选择摘要的旧关注${i}`},{confirmed:true,pinned:true,source:{type:"manual",ref:`attention-${i}`}});
 expect(writeSummary(db,file,[]).content).toContain("旧的重要背景");
});
it("does not turn an assistant-reported outcome into an unqualified summary claim",()=>{
 const {db,file}=setup();db.save({kind:"activity",text:"助手报告，未经独立核实：完成本轮调整",summary:"近期完成一轮记忆调整"},{projectId:"p",confirmed:true,source:{type:"session",ref:"reported",role:"assistant"}});
 expect(writeSummary(db,file,[{id:"p",name:"测试项目"}]).content).toContain("助手报告：近期完成一轮记忆调整");
});

it("lists every confirmed user-background note without truncating", () => {
  const {db,file}=setup();
  for(let i=0;i<6;i+=1) db.save({kind:"background",text:`用户背景第${i}条`,summary:`背景${i}`},{source:{type:"manual",ref:`g${i}`},confirmed:true});
  const result=writeSummary(db,file,[]);
  for(let i=0;i<6;i+=1) expect(result.content).toContain(`背景${i}`);
});
