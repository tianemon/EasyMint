import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it} from "vitest";
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
