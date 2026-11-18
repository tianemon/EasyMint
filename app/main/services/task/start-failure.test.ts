import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { expect, it, vi } from "vitest";
import { createTaskTool } from "./tool";
import { resetRegistry } from "./registry";

const mocks=vi.hoisted(()=>({broadcast: vi.fn(), create:vi.fn()}));
vi.mock("electron",()=>({app:{isPackaged:false,getPath:()=>"/tmp"}}));
vi.mock("../pi-sdk",()=>({getDefineToolFn:async ()=> (tool:unknown)=>tool}));
vi.mock("../pi-session",()=>({getPiSessionDir:(cwd:string)=>cwd,createPiSession:mocks.create}));
vi.mock("../pi-init",()=>({getActiveModel:async()=>({id:"fixture"}),getModelRuntime:async()=>({})}));
vi.mock("../agent-templates",()=>({listTemplates:()=>[],getTemplate:()=>undefined}));
vi.mock("../ipc-broadcast",()=>({broadcast:mocks.broadcast}));
it("writes failed for a formal task whose selected template has been removed", async()=>{
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),"release-template-"));
 try{
  const taskFile=path.join(cwd,"task.json");
  fs.writeFileSync(taskFile,JSON.stringify({tasks:[{id:"T1",status:"building"}]}));
  const onComplete=vi.fn();
  const tool=await createTaskTool({cwd,agentDir:cwd,store:{} as never,parentSessionId:"fixture",onComplete});
  const ack=await tool.execute("tool-fixture",{agent:"removed-template",taskId:"T1",description:"Fixture"},undefined,undefined,{} as never);
  expect(ack.content[0]).toMatchObject({text:expect.stringContaining("已启动")});
  await vi.waitFor(()=>expect(onComplete).toHaveBeenCalledWith("fixture",expect.stringContaining("指定执行模板不存在")));
  const events=mocks.broadcast.mock.calls.filter(call=>call[0]==="agent:delegation-progress").map(call=>call[1].progress.status);
  expect(events).toEqual(["running","failed"]);
  expect(JSON.parse(fs.readFileSync(taskFile,"utf8")).tasks[0].status).toBe("failed");
  expect(mocks.create).not.toHaveBeenCalled();
 }finally{resetRegistry();fs.rmSync(cwd,{recursive:true,force:true});}
});
