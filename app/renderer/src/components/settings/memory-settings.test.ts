// @vitest-environment happy-dom
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { beforeEach,afterEach,expect,it,vi } from "vitest";
import type { MemoryRecord,MemoryView } from "@shared/memory";
import { MemoryTab } from "./MemoryTab";
import { uiI18n } from "../../lib/i18n";

let host:HTMLDivElement,root:Root,view:MemoryView;
const item:MemoryRecord={key:"project:p/id",id:"id",scope:"project",projectId:"p",kind:"decision",text:"已讨论，尚未实施",details:"决定依据与适用条件",tags:[],state:"candidate",lifecycle:"archived",revision:1,createdAt:1,updatedAt:1,occurredAt:1,substantiveAt:1,pinned:false,importance:"normal",sources:[{ref:"legacy:original",type:"legacy"}]};
const query=vi.fn(),read=vi.fn(),save=vi.fn(),update=vi.fn(),configure=vi.fn();
beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  view={settings:{enabled:true,background:false,dailyTokens:30_000},status:{count:1,pending:0,usedTokens:0},reports:[],projectId:"p"};
  query.mockReset().mockImplementation(async request=>({items:request.state==="candidate"?[item]:[],total:request.state==="candidate"?1:0}));
  read.mockReset().mockResolvedValue({item,revisions:[item]});save.mockReset().mockResolvedValue({...item,revision:1});update.mockReset().mockResolvedValue({...item,revision:2});configure.mockReset().mockResolvedValue(view.settings);
  Object.assign(window,{electronAPI:{memory:{state:async()=>structuredClone(view),onChanged:()=>()=>{},query,read,save,update,configure,forget:vi.fn(),previewDocuments:vi.fn()}}});
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();await uiI18n.changeLanguage("zh-CN");vi.unstubAllGlobals();});
const settle=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,230));});
const button=(text:string)=>[...document.querySelectorAll("button")].find(node=>node.textContent===text);
const click=async(text:string)=>act(async()=>{const node=button(text);expect(node).toBeDefined();node!.click();});
const input=async(element:HTMLTextAreaElement|HTMLInputElement,value:string)=>act(async()=>{
  Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value")!.set!.call(element,value);
  element.dispatchEvent(new Event("input",{bubbles:true}));
});
it("uses existing custom controls, and accepting a candidate explicitly activates only that item",async()=>{
  await act(async()=>root.render(createElement(MemoryTab,{projectPath:"/project"})));await settle();
  expect(document.querySelector("select,input[type=checkbox]")).toBeNull();
  await click("已确认");await click("候选");await settle();
  expect(query).toHaveBeenLastCalledWith(expect.objectContaining({state:"candidate",history:true,projectPath:"/project"}));
  expect(host.textContent).toContain(item.text);await click("接受");
  expect(update).toHaveBeenCalledWith(item.key,1,{state:"confirmed",lifecycle:"active"},"/project");
});
it("keeps full-height fields and omits project design details from summary controls",async()=>{
  await act(async()=>root.render(createElement(MemoryTab,{projectPath:"/project"})));await settle();await click("添加记忆");
  const dialog=document.querySelector('[role="dialog"]')!;
  const fields=dialog.querySelectorAll("textarea");expect(fields).toHaveLength(2);
  expect(fields[0]!.classList.contains("resize-none")).toBe(true);expect(fields[1]!.classList.contains("flex-1")).toBe(true);
  expect(dialog.querySelector("select,input[type=checkbox]")).toBeNull();
  await input(fields[0]!,"明确的项目决定，仍未实施");await input(fields[1]!,"保留完整理由");
  expect(dialog.querySelector('[role="checkbox"]')).toBeNull();
  await act(async()=>dialog.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
  expect(save).toHaveBeenCalledExactlyOnceWith({text:"明确的项目决定，仍未实施",details:"保留完整理由",kind:"preference",scope:"project",projectPath:"/project",summary:"",expiresAt:null,effectiveAt:null});
  expect(update).not.toHaveBeenCalled();
});
it("allows human management of existing memories while automatic memory is disabled",async()=>{
  view.settings.enabled=false;
  await act(async()=>root.render(createElement(MemoryTab,{projectPath:"/project"})));await settle();
  expect(button("添加记忆")).toBeDefined();
  expect(configure).not.toHaveBeenCalled();expect(query).toHaveBeenCalled();
  const enabled=document.querySelector('[aria-label="启用记忆"]');expect(enabled?.getAttribute("aria-checked")).toBe("false");
});
it("retains a dirty draft and the dialog when a concurrent edit rejects the save",async()=>{
  update.mockRejectedValue(new Error("记忆已更新，请重新读取后再修改"));
  await act(async()=>root.render(createElement(MemoryTab,{projectPath:"/project"})));await settle();await click("已确认");await click("候选");await settle();
  await act(async()=>{[...host.querySelectorAll("button")].find(node=>node.textContent?.includes(item.text))!.click();});
  const field=document.querySelector('[role="dialog"] textarea') as HTMLTextAreaElement;
  await input(field,"不能丢失的草稿");
  await act(async()=>document.querySelector('[role="dialog"] form')!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();expect(field.value).toBe("不能丢失的草稿");
});
it("uses current/history view values rather than obsolete lifecycle choices",async()=>{
 await act(async()=>root.render(createElement(MemoryTab,{projectPath:"/project"})));await settle();
 await click("当前记忆");await click("历史");await settle();
 expect(query).toHaveBeenLastCalledWith(expect.objectContaining({view:"history",history:true}));
});
it("rejects impossible calendar dates without a native validation popup and saves a valid local deadline",async()=>{
 await act(async()=>root.render(createElement(MemoryTab,{projectPath:"/project"})));await settle();await click("添加记忆");
 const dialog=document.querySelector('[role="dialog"]')!,form=dialog.querySelector("form")!;
 expect(form.noValidate).toBe(true);await input(dialog.querySelector("textarea")!,"简短的项目记录");
 const expiry=dialog.querySelectorAll<HTMLInputElement>('input[placeholder="YYYY-MM-DD HH:mm"]')[1]!;
 await input(expiry,"2026-02-31 18:00");await act(async()=>form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
 expect(save).not.toHaveBeenCalled();expect(document.querySelector('[role="dialog"]')).not.toBeNull();
 await input(expiry,"2026-12-20 18:00");await act(async()=>form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
 expect(save).toHaveBeenCalledWith(expect.objectContaining({expiresAt:new Date("2026-12-20T18:00").getTime()}));
});
it("lets a user include a global preference in the lightweight summary through existing controls",async()=>{
 await act(async()=>root.render(createElement(MemoryTab,{projectPath:"/project"})));await settle();await click("添加记忆");
 await click("当前项目");await click("全局");
 const dialog=document.querySelector('[role="dialog"]')!;await input(dialog.querySelector("textarea")!,"重要的用户偏好");
 await act(async()=>dialog.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
 await act(async()=>dialog.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
 expect(save).toHaveBeenCalledWith(expect.objectContaining({scope:"global",summary:"重要的用户偏好"}));
});
