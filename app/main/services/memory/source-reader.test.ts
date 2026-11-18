import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import {readConclusionEntries} from "./source-reader";
import {evidenceMessages,conclusionSnapshot} from "./source";
const dirs:string[]=[];
afterEach(()=>{for(const dir of dirs.splice(0))fs.rmSync(dir,{recursive:true,force:true});});
function fixture(extra:unknown[]=[]) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"em-memory-source-"));dirs.push(root);
  const file=path.join(root,"session.jsonl");
  const entries=[{type:"session",version:3,id:"s",cwd:root,timestamp:new Date().toISOString()},
    {type:"message",id:"u",parentId:null,timestamp:new Date().toISOString(),message:{role:"user",content:[{type:"text",text:"明确的用户要求"},{type:"image",data:"PRIVATE_IMAGE".repeat(100_000)}],timestamp:1}},
    {type:"message",id:"tool",parentId:"u",timestamp:new Date().toISOString(),message:{role:"toolResult",toolName:"bash",content:[{type:"text",text:"PRIVATE_TOOL_OUTPUT".repeat(50_000)}],timestamp:2}},
    {type:"message",id:"a",parentId:"tool",timestamp:new Date().toISOString(),message:{role:"assistant",content:[{type:"thinking",thinking:"PRIVATE_THOUGHTS"},{type:"text",text:"完成结论，未独立验证"}],stopReason:"stop",timestamp:3}},...extra];
  fs.writeFileSync(file,entries.map(e=>JSON.stringify(e)).join("\n")+"\n");
  return {file,entries,job:{ref:"conclusion:s:a",sessionId:"s",entryId:"a",anchorRef:"user:s:u",sessionFile:file,projectPath:root,timestamp:3,hash:"x",version:3}};
}
it("returns only targeted text and provenance, excluding images, thoughts and unrelated tool output",async()=>{
  const {job}=fixture();const entries=await readConclusionEntries(job);
  expect(JSON.stringify(entries).length).toBeLessThan(2000);expect(JSON.stringify(entries)).not.toContain("PRIVATE_");
  const snapshot=conclusionSnapshot(await evidenceMessages(entries),"a");
  expect(snapshot?.assistant.text).toBe("完成结论，未独立验证");expect(snapshot?.user?.text).toBe("明确的用户要求");
});
it("preserves native edit semantics and rejects an abandoned branch",async()=>{
  const changed=fixture([{type:"context_edit",id:"edit",parentId:"a",timestamp:new Date().toISOString(),targetId:"u",replacement:{content:"用户已经更正"}}]);
  expect(conclusionSnapshot(await evidenceMessages(await readConclusionEntries(changed.job)),"a")?.user?.text).toBe("用户已经更正");
  const abandoned=fixture([{type:"custom",id:"rewind",parentId:"u",timestamp:new Date().toISOString(),customType:"rewind-pin"}]);
  expect(await readConclusionEntries(abandoned.job)).toEqual([]);
});

it("loads complete steering/choice evidence with identical active and offline hashes, then reads only appended bytes",async()=>{
 const f=fixture(),originalSize=fs.statSync(f.file).size;
 await readConclusionEntries(f.job);
 const answers=[{question:"选择",answer:"保留理由"}];
 const rows=[
 {type:"message",id:"u2",parentId:"a",timestamp:new Date().toISOString(),message:{role:"user",content:"请记住：我习惯中文",timestamp:4}},
 {type:"message",id:"progress",parentId:"u2",timestamp:new Date().toISOString(),message:{role:"assistant",content:[{type:"text",text:"中间解释"}],stopReason:"toolUse",timestamp:5}},
 {type:"message",id:"steering",parentId:"progress",timestamp:new Date().toISOString(),message:{role:"user",content:"还有，简短一些",timestamp:6}},
 {type:"message",id:"choice",parentId:"steering",timestamp:new Date().toISOString(),message:{role:"toolResult",toolName:"ask_user",toolCallId:"choice",content:[{type:"text",text:"选择：保留理由"}],details:{memoryUserEvidence:"选择：保留理由",memoryUserAnswers:answers},timestamp:7}},
 {type:"message",id:"a2",parentId:"choice",timestamp:new Date().toISOString(),message:{role:"assistant",content:[{type:"text",text:"完整结论"}],stopReason:"stop",timestamp:8}}];
 fs.appendFileSync(f.file,rows.map(row=>JSON.stringify(row)).join("\n")+"\n");
 const {bindConclusion}=await import("./source");const snapshot=conclusionSnapshot(await evidenceMessages([...f.entries,...rows]),"a2")!;
 const job=bindConclusion(snapshot,{sessionId:"s",sessionFile:f.file,projectPath:path.dirname(f.file),version:3});
 const fsp=(await import("node:fs/promises")).default,open=fsp.open,reads:Array<{length:number;position:number}>=[];
 const spy=vi.spyOn(fsp,"open").mockImplementation((async(...args:Parameters<typeof open>)=>{const handle=await open(...args),read=handle.read.bind(handle);handle.read=((buffer:Buffer,offset:number,length:number,position:number)=>{reads.push({length,position});return read(buffer,offset,length,position);}) as typeof handle.read;return handle;}) as typeof open);
 try{const offlineEntries=await readConclusionEntries(job);expect((offlineEntries.find((entry:any)=>entry.id==="choice") as any).message.details.memoryUserAnswers).toEqual(answers);
 const offline=conclusionSnapshot(await evidenceMessages(offlineEntries),"a2")!;
 expect(offline.hash).toBe(snapshot.hash);expect(offline.user?.text).toContain("简短一些");expect(offline.user?.text).toContain("选择：保留理由");
 expect(reads.reduce((sum,read)=>sum+read.length,0)).toBeLessThan(32768);expect(reads.every(read=>read.position>=originalSize-4096)).toBe(true);
 }finally{spy.mockRestore();}
});
