// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoChatMessage } from "./ChatPanel";
import { CompletedExecution } from "./CompletedExecution";
import { buildTurnPresentations } from "./chat-turn-presentation";
import { useProcessDisclosure } from "./chat-process-disclosure";
import type { ChatMessage } from "./chat-utils";
import type { SystemMessageKind } from "@shared/prompts";
vi.mock("../lib/diff-highlight",()=>({inferLang:()=>"TEXT",tokenizeLines:()=>[]}));
const kinds: SystemMessageKind[]=["delegation","shell","project-created","direct-create","flow","handoff","summary","learn"];
const types: Array<string|undefined>=[...kinds,"future-notice",undefined];
let container:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);useProcessDisclosure.setState({expanded:{}});container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});
const notice=(kind?:string):ChatMessage=>({id:2,role:"user",timestamp:2000,customType:"system_message",details:{...(kind?{kind}:{}),startsExecution:false},text:"[系统消息]-[Agent执行结果]\n⏺ 独立审查 — 完成 · 187s\n详细结果: private-report-body"});
const renderSystem=(msg:ChatMessage)=>createElement(MemoChatMessage,{msg,streaming:false,busy:false,sid:"system-fold",userBubble:()=>createElement("div",{},"ordinary-user"),onPin:()=>{},onRegenerate:()=>{},onContextMenu:()=>{}});

it.each(types)("defaults %s system cards to collapsed, including absent/unknown kinds",async kind=>{
 await act(async()=>root.render(renderSystem(notice(kind))));
 expect(container.textContent).not.toContain("private-report-body");
 const toggle=container.querySelector<HTMLButtonElement>(".msg-system-flow > button")!;
 expect(toggle.getAttribute("aria-expanded")).toBe("false");
 await act(async()=>toggle.click());expect(toggle.getAttribute("aria-expanded")).toBe("true");expect(container.textContent).toContain("private-report-body");
});

it.each(types)("keeps %s folded after opening the completed elapsed-time replay",async kind=>{
 const messages:ChatMessage[]=[{id:1,role:"ai",timestamp:1000,stopReason:"toolUse",entries:[{kind:"text",text:"progress",phase:"commentary",timestamp:1000}]},notice(kind),{id:3,role:"ai",timestamp:3000,stopReason:"stop",turnOutcome:"completed",entries:[{kind:"text",text:"final answer",phase:"final_answer",timestamp:3000}]}];
 const turns=buildTurnPresentations(messages,false),turn=turns.get(0)!;
 expect(turns.get(1)).toBe(turn);
 await act(async()=>root.render(createElement(CompletedExecution,{id:"system-fold:1",sessionId:"system-fold",durationMs:5000,messages,turn,renderSystemMessage:renderSystem})));
 await act(async()=>container.querySelector<HTMLButtonElement>(".execution-turn-time")!.click());
 expect(container.textContent).not.toContain("[系统消息]");expect(container.textContent).not.toContain("private-report-body");
 const toggle=container.querySelector<HTMLButtonElement>(".msg-system-flow > button")!;expect(toggle.getAttribute("aria-expanded")).toBe("false");
 await act(async()=>toggle.click());expect(container.textContent).toContain("private-report-body");
});

it("does not turn an ordinary user message into process, or absorb a separate execution trigger",()=>{
 const ai:ChatMessage={id:1,role:"ai",timestamp:1000,stopReason:"toolUse",entries:[{kind:"thinking",text:"reasoning",timestamp:1000}]};
 const plain:ChatMessage={id:2,role:"user",timestamp:2000,text:"ordinary question"};
 const tail:ChatMessage={id:3,role:"ai",timestamp:3000,stopReason:"stop",turnOutcome:"completed",entries:[{kind:"text",text:"answer",timestamp:3000}]};
 const grouped=buildTurnPresentations([ai,plain,tail],false);expect(grouped.has(1)).toBe(false);
 const terminal={...ai,stopReason:"stop",turnOutcome:"completed" as const};
 const trigger={...notice("learn"),details:{kind:"learn",startsExecution:true}};
 const turns=buildTurnPresentations([terminal,trigger,tail],false);expect(turns.has(1)).toBe(false);expect(turns.get(0)).not.toBe(turns.get(2));
});
