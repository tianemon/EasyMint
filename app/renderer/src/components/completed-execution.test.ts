// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CompletedExecution } from "./CompletedExecution";
import { RunningAssistantContent } from "./RunningAssistantContent";
import { buildRunningProcessSlices } from "./chat-running-process";
import { buildTurnPresentations } from "./chat-turn-presentation";
import * as processModel from "./execution-process-model";
import * as processSlices from "./chat-running-process";
import { useProcessDisclosure } from "./chat-process-disclosure";
import type { ChatMessage } from "./chat-utils";
import type { StreamEntry } from "./StreamPanel";
vi.mock("../lib/diff-highlight", () => ({ inferLang: () => "TEXT", tokenizeLines: () => [] }));
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  useProcessDisclosure.setState({ expanded: {} });
  container = document.createElement("div"); document.body.append(container); root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
const text=(text:string,phase?:"final_answer"):StreamEntry=>({kind:"text",text,phase,timestamp:0});
const call=(id:string):StreamEntry=>({kind:"tool_use",id,name:"read",input:{path:`/src/${id}.tsx`},timestamp:0,collapsed:true});
const result=(id:string):StreamEntry=>({kind:"tool_result",toolUseId:id,content:"content",isError:false,timestamp:0});
const fixture=(interrupted:boolean):ChatMessage[]=>[
  {id:1,role:"ai",timestamp:0,stopReason:"toolUse",entries:[text("First conclusion"),call("a"),result("a")]},
  {id:2,role:"ai",timestamp:1000,stopReason:interrupted?"aborted":"stop",turnOutcome:interrupted?"cancelled":"completed",turnDurationMs:62000,
    entries:[text("Second conclusion"),call("b"),...(interrupted?[]:[result("b"),text("Final answer","final_answer")])]}
];
it("uses only the elapsed heading after completion and restores the interleaved transcript on expansion",async()=>{
  const messages=fixture(false),turns=buildTurnPresentations(messages,false),turn=turns.get(0)!;
  await act(async()=>root.render(createElement(CompletedExecution,{id:"s:1",sessionId:"s",durationMs:turn.durationMs,messages,turn,renderSystemMessage:()=>null})));
  const heading=container.querySelector<HTMLButtonElement>(".execution-turn-time")!;
  expect(heading.textContent).toBe("用时 1分钟 2秒");
  expect(heading.textContent).not.toContain("读取");
  expect(container.querySelector(".execution-transcript")).toBeNull();
  await act(async()=>heading.click());
  expect(container.querySelector(".execution-transcript")).not.toBeNull();
  expect(container.querySelector(".execution-transcript")?.textContent).toMatch(/First conclusion.*读取文件.*Second conclusion.*读取文件/s);
  expect(container.textContent).not.toContain("Final answer");
  expect(container.querySelectorAll(".execution-process-toggle")).toHaveLength(2);
  expect([...container.querySelectorAll(".execution-process-toggle")].every(node=>node.getAttribute("aria-expanded")==="false")).toBe(true);
});
it("keeps an interrupted run in its interleaved shape and preserves an already-open segment",async()=>{
  const messages=fixture(true),turns=buildTurnPresentations(messages,false),turn=turns.get(0)!;
  expect(turn.preserveSegments).toBe(true);
  const rows=buildRunningProcessSlices(messages,turns);
  const firstKey=rows.get(0)![1]!.key!;
  useProcessDisclosure.getState().toggle(`s:${firstKey}`);
  await act(async()=>root.render(createElement("div",{},...messages.map((message,index)=>createElement(RunningAssistantContent,{key:message.id,sessionId:"s",messageId:String(message.id),slices:rows.get(index)??[],toolInputs:new Map(),streaming:false,active:false,interrupted:true})))));
  expect(container.querySelector(".execution-turn-time")).toBeNull();
  expect(container.textContent).toMatch(/First conclusion.*读取文件.*Second conclusion.*读取文件/s);
  expect(container.querySelector(".execution-process-toggle")?.getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector('[data-state="cancelled"]')).not.toBeNull();
  expect(container.querySelector(".process-record-running")).toBeNull();
});
it("retains internal scroll position through streamed updates and removes the fade at the bottom",async()=>{
  const messages=fixture(true),turns=buildTurnPresentations(messages,false),rows=buildRunningProcessSlices(messages,turns);
  const props={sessionId:"scroll",messageId:"1",slices:rows.get(0)!,toolInputs:new Map<string,Record<string,unknown>>(),streaming:false,active:false,interrupted:true};
  await act(async()=>root.render(createElement(RunningAssistantContent,props)));
  const viewport=container.querySelector<HTMLDivElement>(".execution-process-viewport")!;
  Object.defineProperties(viewport,{scrollHeight:{configurable:true,value:600},clientHeight:{configurable:true,value:240}});
  await act(async()=>container.querySelector<HTMLButtonElement>(".execution-process-toggle")!.click());
  expect(viewport.dataset.faded).toBe("true");
  await act(async()=>{viewport.scrollTop=100;viewport.dispatchEvent(new Event("scroll"));});
  await act(async()=>root.render(createElement(RunningAssistantContent,{...props,slices:[...props.slices]})));
  expect(viewport.scrollTop).toBe(100);
  await act(async()=>{viewport.scrollTop=360;viewport.dispatchEvent(new Event("scroll"));});
  expect(viewport.dataset.faded).toBe("false");
  await act(async()=>container.querySelector<HTMLButtonElement>(".execution-process-toggle")!.click());
  await act(async()=>container.querySelector<HTMLButtonElement>(".execution-process-toggle")!.click());
  expect(viewport.scrollTop).toBe(360);
});

it("does not construct or mount replay for closed history, including when other messages change",async()=>{
  const messages=fixture(false),turn=buildTurnPresentations(messages,false).get(0)!;
  const chunks=vi.spyOn(processModel,"completedProcessChunks");
  const slices=vi.spyOn(processSlices,"buildRunningProcessSlices");
  const renderSystemMessage=vi.fn(()=>null);
  const props={id:"lazy:1",sessionId:"lazy",messages,turn,durationMs:62000,renderSystemMessage};
  await act(async()=>root.render(createElement(CompletedExecution,props)));
  expect(chunks).not.toHaveBeenCalled();expect(slices).not.toHaveBeenCalled();
  expect(container.querySelector(".execution-transcript")).toBeNull();
  expect(container.querySelector(".execution-process-viewport")).toBeNull();
  await act(async()=>container.querySelector<HTMLButtonElement>(".execution-turn-time")!.click());
  expect(chunks).toHaveBeenCalledTimes(1);expect(slices).toHaveBeenCalledTimes(1);
  await act(async()=>container.querySelector<HTMLButtonElement>(".execution-turn-time")!.click());
  await act(async()=>root.render(createElement(CompletedExecution,{...props,messages:[...messages]})));
  expect(chunks).toHaveBeenCalledTimes(1);expect(slices).toHaveBeenCalledTimes(1);
  expect(container.querySelector(".execution-transcript")).toBeNull();
});
it("retains opened record details after unloading and reopening the completed transcript",async()=>{
  const messages=fixture(false);messages[0]!.entries!.splice(1,0,{kind:"thinking",text:"remembered thought",timestamp:0});
  const turn=buildTurnPresentations(messages,false).get(0)!;
  await act(async()=>root.render(createElement(CompletedExecution,{id:"persist:1",sessionId:"persist",messages,turn,durationMs:62000,renderSystemMessage:()=>null})));
  const heading=()=>container.querySelector<HTMLButtonElement>(".execution-turn-time")!;
  await act(async()=>heading().click());
  await act(async()=>container.querySelector<HTMLButtonElement>(".execution-process-toggle")!.click());
  const record=container.querySelector<HTMLDetailsElement>(".execution-process-record")!;
  await act(async()=>{record.open=true;record.dispatchEvent(new Event("toggle"));});
  expect(container.textContent).toContain("remembered thought");
  await act(async()=>heading().click());expect(container.querySelector(".execution-process-record")).toBeNull();
  await act(async()=>heading().click());
  expect(container.querySelector<HTMLDetailsElement>(".execution-process-record")?.open).toBe(true);
  expect(container.textContent).toContain("remembered thought");
});
