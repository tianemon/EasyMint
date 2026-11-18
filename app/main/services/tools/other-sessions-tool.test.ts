import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {createOtherSessionsTool} from "./other-sessions-tool";
const fixture=vi.hoisted(()=>({hits:[] as Array<{tool:"easymint"|"claude"|"codex";file:string;mtime:number}>}));
vi.mock("../pi-sdk",()=>({getDefineToolFn:async()=>(definition:unknown)=>definition}));
vi.mock("../../utils/paths",()=>({emAgentDir:()=>"/synthetic-agent",emHome:()=>"/synthetic-em",getResourcesDir:()=>"/synthetic-resources"}));
vi.mock("../memory/tool-sessions",async importOriginal=>({...await importOriginal<typeof import("../memory/tool-sessions")>(),discoverSessions:()=>fixture.hits}));
let root:string;
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"em-other-session-test-"));fixture.hits=[];});
afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
const row=(text:string)=>JSON.stringify({type:"message",message:{role:"assistant",content:[{type:"text",text}],stopReason:"stop"}});
function source(texts:string[]){const file=path.join(root,"session.jsonl");fs.writeFileSync(file,JSON.stringify({type:"session",version:3,cwd:root})+"\n"+texts.map(row).join("\n")+"\n");fixture.hits=[{tool:"easymint",file,mtime:Date.now()}];return file;}
async function toolWithRef(){const tool=await createOtherSessionsTool(root),execute=async(params:Record<string,unknown>)=>{const result=await tool.execute("test",params,new AbortController().signal,undefined,{} as never);const text=result.content[0];if(text.type!=="text")throw new Error("Expected text");return JSON.parse(text.text);};const listed=await execute({action:"list"});return {execute,ref:listed.sessions[0].sessionRef};}
it("walks every assistant record from newest to oldest, including several inside one byte window",async()=>{
 source(["FIRST", "SECOND", "THIRD"]);const {execute,ref}=await toolWithRef();let before:unknown=undefined;const seen:string[]=[];
 for(let i=0;i<5;i++){const page=await execute({action:"read",sessionRef:ref,before});if(page.text)seen.push(page.text);if(page.nextCursor===undefined)break;before=page.nextCursor;}
 expect(seen).toEqual(["THIRD","SECOND","FIRST"]);
});
it("reassembles multiline Unicode text without pulling a later append into an existing page",async()=>{
 const original="第一行🙂\n".repeat(600),file=source([original]),{execute,ref}=await toolWithRef();let page=await execute({action:"read",sessionRef:ref});const pages=[page.text];fs.appendFileSync(file,row("LATE_APPEND")+"\n");
 while(page.nextTextOffset!==undefined){page=await execute({action:"read",sessionRef:ref,textOffset:page.nextTextOffset,snapshotEnd:page.snapshotEnd});pages.push(page.text);}
 expect(pages.join("")).toBe(original.trim());expect(pages.join("")).not.toContain("LATE_APPEND");
});
it("rejects arbitrary paths, replaced files, and changed project ownership on the same file",async()=>{
 const file=source(["PRIVATE_OTHER_PROJECT"]),{execute,ref}=await toolWithRef();await expect(execute({action:"read",file})).rejects.toThrow("sessionRef");
 fs.writeFileSync(file,JSON.stringify({type:"session",version:3,cwd:path.join(root,"foreign")})+"\n"+row("PRIVATE_OTHER_PROJECT")+"\n");await expect(execute({action:"read",sessionRef:ref})).rejects.toThrow("所属项目");
 const replacement=path.join(root,"replacement.jsonl");fs.writeFileSync(replacement,JSON.stringify({cwd:root})+"\n"+row("REPLACED"));fs.renameSync(replacement,file);await expect(execute({action:"read",sessionRef:ref})).rejects.toThrow("已变化");
});
