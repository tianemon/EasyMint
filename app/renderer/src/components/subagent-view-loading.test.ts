// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SubagentProcessView } from "./SubagentProcessView";
import { useDelegationStore } from "../stores/delegation-store";
import type { ChatMessage } from "./chat-utils";
vi.hoisted(()=>vi.stubGlobal("localStorage",{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}));
vi.mock("./SubagentTranscript",()=>({SubagentTranscript:({messages,running}:{messages:ChatMessage[];running:boolean})=>createElement("pre",{"data-transcript":true},JSON.stringify({messages,running}))}));
vi.mock("./ui/Modal",()=>({Modal:({children}:{children:unknown})=>children}));
let root:Root,container:HTMLDivElement,listener:((data:SubagentStreamEvent)=>void)|undefined;
const read=vi.fn();
const history=(text:string,stopReason="stop")=>[{type:"assistant",uuid:"disk",message:{role:"assistant",content:[{type:"text",text}],timestamp:1000,stopReason}}];
const render=(running:boolean,delegationId="task",index=0)=>act(async()=>root.render(createElement(SubagentProcessView,{delegationId,index,title:"Worker",running,onClose:()=>{}})));
const transcript=()=>JSON.parse(container.querySelector("[data-transcript]")!.textContent!) as {messages:ChatMessage[];running:boolean};
beforeEach(()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 vi.stubGlobal("ResizeObserver",class{observe(){}disconnect(){}});
 vi.stubGlobal("electronAPI",{task:{getSubagentMessages:read},agent:{onSubagentStream:(callback:typeof listener)=>{listener=callback;return()=>{if(listener===callback)listener=undefined;};}}});
 useDelegationStore.getState().reset();useDelegationStore.getState().setSessionFile("task",0,"/fixture/child.jsonl");
 container=document.createElement("div");document.body.append(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();read.mockReset();listener=undefined;useDelegationStore.getState().reset();vi.unstubAllGlobals();});

it("reloads final history immediately and ignores an older disk read after the child stops",async()=>{
 let stale!:(value:unknown)=>void;
 read.mockImplementationOnce(()=>new Promise(resolve=>{stale=resolve;})).mockResolvedValueOnce(history("final persisted answer"));
 await render(true);expect(read).toHaveBeenCalledTimes(1);
 await act(async()=>listener?.({delegationId:"task",index:0,sessionFile:"/fixture/child.jsonl",ev:{type:"message",sessionId:"child",seq:1,runId:"fixture-run",timestamp:1000,partial:true,blocks:[{type:"text",text:"live draft"}]}}));
 expect(JSON.stringify(transcript())).toContain("live draft");
 await render(false);expect(read).toHaveBeenCalledTimes(2);
 expect(JSON.stringify(transcript())).toContain("final persisted answer");
 await act(async()=>stale([]));
 expect(JSON.stringify(transcript())).toContain("final persisted answer");
 expect(transcript().messages).toHaveLength(1);expect(transcript().running).toBe(false);
});

it("does not let an old child's read populate a different child",async()=>{
 let oldRead!:(value:unknown)=>void;
 read.mockImplementationOnce(()=>new Promise(resolve=>{oldRead=resolve;})).mockResolvedValueOnce(history("second child"));
 await render(true);
 useDelegationStore.getState().setSessionFile("second",1,"/fixture/second.jsonl");
 await render(false,"second",1);
 await act(async()=>oldRead(history("first child")));
 expect(JSON.stringify(transcript())).toContain("second child");expect(JSON.stringify(transcript())).not.toContain("first child");
});

it("reports an unreadable transcript instead of leaving an indefinite loading state",async()=>{
 read.mockRejectedValueOnce(new Error("fixture read denied"));
 await render(false);
 expect(container.querySelector('[role="alert"]')?.textContent).toContain("fixture read denied");
});
