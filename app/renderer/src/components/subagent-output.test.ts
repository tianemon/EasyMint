// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SubagentTranscript } from "./SubagentTranscript";
import { useProcessDisclosure } from "./chat-process-disclosure";
import { useStatusStore } from "../stores/status-store";
import type { ChatMessage } from "./chat-utils";
import type { StreamEntry } from "./StreamPanel";
vi.hoisted(()=>vi.stubGlobal("localStorage",{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}));
vi.mock("../lib/diff-highlight",()=>({inferLang:()=>"TEXT",tokenizeLines:()=>[]}));
let root:Root,container:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("matchMedia",()=>({matches:true}));useProcessDisclosure.setState({expanded:{}});container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();useStatusStore.getState().reset();vi.unstubAllGlobals();});
const text=(text:string,phase?:"commentary"|"final_answer"):StreamEntry=>({kind:"text",text,phase,timestamp:0});
const tool=(id:string,command:string):StreamEntry=>({kind:"tool_use",id,name:"bash",input:{command},timestamp:0,collapsed:true});
const ai=(id:number,entries:StreamEntry[],patch:Partial<ChatMessage>={}):ChatMessage=>({id,role:"ai",timestamp:id*1000,entries,stopReason:"toolUse",...patch});
const initial:ChatMessage={id:1,role:"user",timestamp:1000,text:"work"};
const render=(messages:ChatMessage[],running:boolean)=>act(async()=>root.render(createElement(SubagentTranscript,{messages,running,title:"Worker",sessionId:"subagent:test:0",activity:{tools:running?[{id:"b",name:"bash",args:{command:"npm test"}}]:[]}})));

it("shows the latest action once, opens its process and does not use the parent's status",async()=>{
 useStatusStore.getState().pushSignal("parent","tool:x","PARENT_ONLY");
 const messages=[initial,ai(2,[text("first progress","commentary"),tool("a","git diff"),text("intermediate conclusion","commentary"),tool("b","npm test")],{streaming:true})];
 await render(messages,true);
 expect(container.textContent).toContain("first progress");expect(container.textContent).toContain("intermediate conclusion");
 expect(container.textContent).not.toContain("PARENT_ONLY");
 expect(container.querySelectorAll("button.statusbar")).toHaveLength(1);
 expect(container.querySelectorAll(".execution-process-toggle")).toHaveLength(2);
 const control=container.querySelector<HTMLButtonElement>("button.statusbar")!;
 expect(control.textContent).toContain("正在运行命令 npm test");
 await act(async()=>control.click());expect(control.getAttribute("aria-expanded")).toBe("true");
});

it("folds the finished turn to elapsed time and the final answer, then replays its original segments",async()=>{
 const messages=[initial,ai(2,[text("earlier conclusion","commentary"),tool("a","git diff")]),ai(3,[text("final answer","final_answer")],{stopReason:"stop",durationMs:1500})];
 await render(messages,false);
 expect(container.textContent).toContain("final answer");
 expect(container.textContent).not.toContain("earlier conclusion");expect(container.querySelector("button.statusbar")).toBeNull();
 const elapsed=container.querySelector<HTMLButtonElement>(".execution-turn-time")!;
 expect(elapsed.textContent).toContain("用时");await act(async()=>elapsed.click());
 expect(container.textContent).toContain("earlier conclusion");expect(container.querySelector(".execution-process-toggle")).not.toBeNull();
 expect(container.textContent?.match(/final answer/g)).toHaveLength(1);
});

it.each(["aborted","error","toolUse"])("preserves interleaved output after %s without a final conclusion",async stopReason=>{
 const messages=[initial,ai(2,[text("first","commentary"),tool("a","git diff"),text("second","commentary"),tool("b","npm test")],{stopReason,streaming:false})];
 await render(messages,false);
 expect(container.textContent).toContain("first");expect(container.textContent).toContain("second");
 expect(container.querySelector(".execution-turn-time")).toBeNull();
 expect(container.querySelectorAll(".execution-process-toggle")).toHaveLength(2);
});

it("keeps an unanswered question visible during execution and folds it after a final answer",async()=>{
 const ask:StreamEntry={kind:"tool_use",id:"q",name:"ask_user",input:{questions:[{question:"Which platform?"}]},timestamp:0,collapsed:true};
 const messages=[initial,ai(2,[tool("a","git diff"),ask,tool("b","npm test")])];
 await render(messages,true);expect(container.textContent).toContain("Which platform?");
 await render([...messages,ai(3,[text("done","final_answer")],{stopReason:"stop",durationMs:1000})],false);
 expect(container.textContent).not.toContain("Which platform?");
});
