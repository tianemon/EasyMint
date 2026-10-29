// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildRunningProcessSlices, liveProcessSlice } from "./chat-running-process";
import { buildTurnPresentations } from "./chat-turn-presentation";
import { RunningAssistantContent } from "./RunningAssistantContent";
import { ExecutionProcess } from "./ExecutionProcess";
import { StatusBar } from "./StatusBar";
import { useProcessDisclosure } from "./chat-process-disclosure";
import { useStatusStore } from "../stores/status-store";
import { useTabStore } from "../stores/tab-store";
import { useAskStore } from "../stores/ask-store";
import type { ChatMessage } from "./chat-utils";
import type { StreamEntry } from "./StreamPanel";
vi.hoisted(()=>vi.stubGlobal("localStorage",{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}));
vi.mock("../lib/diff-highlight",()=>({inferLang:()=>"TEXT",tokenizeLines:()=>[]}));
let root:Root,container:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("matchMedia",()=>({matches:true}));useProcessDisclosure.setState({expanded:{}});useStatusStore.getState().reset();useAskStore.setState({asks:{}});useTabStore.getState().setSessionRunning("live",true);container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());useStatusStore.getState().reset();useAskStore.setState({asks:{}});useTabStore.getState().setSessionRunning("live",false);container.remove();vi.unstubAllGlobals();});
const text=(text:string):StreamEntry=>({kind:"text",text,timestamp:0});
const call=(id:string,command:string):StreamEntry=>({kind:"tool_use",id,name:"bash",input:{command},collapsed:true,timestamp:0});
const result=(id:string):StreamEntry=>({kind:"tool_result",toolUseId:id,name:"bash",content:"done",isError:false,timestamp:0});
const message=(entries:StreamEntry[]):ChatMessage=>({id:1,role:"ai",timestamp:0,streaming:true,entries});
function Scene({messages}:{messages:ChatMessage[]}){
 const toolId=useStatusStore(state=>state.bySession.live?.signals.filter(signal=>signal.id.startsWith("tool:")).sort((a,b)=>b.seq-a.seq)[0]?.id.slice(5));
 const rows=buildRunningProcessSlices(messages,buildTurnPresentations(messages,true)),live=liveProcessSlice(rows,toolId);
 return createElement("div",{},...messages.map((msg,index)=>createElement(RunningAssistantContent,{key:msg.id,sessionId:"live",messageId:String(msg.id),slices:rows.get(index)??[],omitProcessKey:live?.key,toolInputs:new Map(),streaming:true})),
  live?createElement(ExecutionProcess,{key:live.key,id:`live:${live.key}`,chunks:live.chunks!,active:true,liveStatusSessionId:"live"}):createElement(StatusBar,{sessionId:"live",showCompletedOutcome:false}));
}
const render=(entries:StreamEntry[])=>act(async()=>root.render(createElement(Scene,{messages:[message(entries)]})));
const progress=(id:string,command:string)=>useStatusStore.getState().pushSignal("live",`tool:${id}`,"progress",undefined,{name:"bash",args:{command}});

it("uses the latest live action as the only process header and opens that same segment",async()=>{
 progress("a","npm test");await render([text("progress body"),call("a","npm test")]);
 expect(container.querySelectorAll(".execution-process-toggle")).toHaveLength(1);
 const control=container.querySelector<HTMLButtonElement>("button.statusbar")!;
 expect(control.textContent).toContain("正在运行命令 npm test");expect(control.getAttribute("aria-expanded")).toBe("false");
 expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
 await act(async()=>control.click());
 expect(control.getAttribute("aria-expanded")).toBe("true");
 expect(container.querySelector<HTMLDivElement>(".execution-process-viewport")?.hidden).toBe(false);
 await act(async()=>progress("b","git diff"));
 await render([text("progress body"),call("a","npm test"),result("a"),call("b","git diff")]);
 expect(container.querySelectorAll("button.statusbar")).toHaveLength(1);
 expect(container.querySelector("button.statusbar")?.textContent).toContain("git diff");
 expect(container.querySelector("button.statusbar")?.getAttribute("aria-expanded")).toBe("true");
});
it("seals previous work at a new body and gives the following process its own live disclosure",async()=>{
 const before=[text("first body"),call("a","npm test"),result("a"),text("second body")];
 useStatusStore.getState().pushSignal("live","request","responding");await render(before);
 expect(container.querySelectorAll(".execution-process-toggle")).toHaveLength(1);
 expect(container.querySelector("button.statusbar")).toBeNull();
 expect(container.textContent).toMatch(/first body.*运行命令.*second body.*responding/s);
 await act(async()=>progress("b","git diff"));await render([...before,call("b","git diff")]);
 expect(container.querySelectorAll(".execution-process-toggle")).toHaveLength(2);
 expect(container.querySelectorAll("button.statusbar")).toHaveLength(1);
 expect(container.textContent).toMatch(/first body.*运行命令.*second body.*正在运行命令 git diff/s);
});
it("has a useful live action before the first status signal and keeps waiting/stop priorities",async()=>{
 await render([call("a","npm test")]);
 expect(container.querySelector("button.statusbar")?.textContent).toContain("npm test");
 await act(async()=>useAskStore.getState().setAsk({sessionId:"live",requestId:"ask",questions:[],allowCustom:true}));
 expect(container.querySelector("button.statusbar")?.textContent).toContain("等待");
 await act(async()=>useStatusStore.getState().pushSignal("live","stopping","stopping now"));
 expect(container.querySelector("button.statusbar")?.textContent).toContain("stopping now");
});
it("does not mark a body, pending question boundary or interrupted history as live work",()=>{
 const entries=[call("a","npm test"),text("body")];
 const messages=[message(entries)];
 expect(liveProcessSlice(buildRunningProcessSlices(messages,buildTurnPresentations(messages,true)))).toBeUndefined();
 const pending={...call("ask",""),name:"ask_user"};
 messages[0]=message([call("a","npm test"),pending]);
 expect(liveProcessSlice(buildRunningProcessSlices(messages,buildTurnPresentations(messages,true)))).toBeUndefined();
 messages[0]={...message([call("a","npm test")]),streaming:false,stopReason:"aborted",turnOutcome:"cancelled"};
 expect(liveProcessSlice(buildRunningProcessSlices(messages,buildTurnPresentations(messages,false)))).toBeUndefined();
});

it("uses the shared thinking icon for a live reasoning status",async()=>{
 useStatusStore.getState().pushSignal("live","request","正在思考");
 await render([{kind:"thinking",text:"reasoning body",timestamp:0}]);
 expect(container.querySelectorAll(".execution-process-toggle")).toHaveLength(1);
 expect(container.querySelector("button.statusbar")?.textContent).toContain("正在思考");
 expect(container.querySelector("button.statusbar svg path")?.getAttribute("d")).toBe("M12 18V5");
});

it("keeps an in-flight call clickable when commentary follows the call in the message",async()=>{
 progress("a","npm test");await render([text("first body"),call("a","npm test"),text("commentary while tool starts")]);
 expect(container.querySelectorAll(".execution-process-toggle")).toHaveLength(1);
 expect(container.querySelector("button.statusbar")?.textContent).toContain("npm test");
 expect(container.textContent).toMatch(/first body.*commentary while tool starts.*npm test/s);
 await act(async()=>container.querySelector<HTMLButtonElement>("button.statusbar")!.click());
 expect(container.querySelector<HTMLDivElement>(".execution-process-viewport")?.hidden).toBe(false);
});
