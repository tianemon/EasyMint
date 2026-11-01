// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ProviderUsagePreview } from "./ProviderUsagePreview";
import type { ProviderConfig } from "@shared/platform-presets";
let host: HTMLDivElement, root: Root;
const usage = vi.fn();
const config:ProviderConfig={id:"codex",presetId:"openai-codex",name:"GPT",apiKey:"",model:"gpt",models:[],createdAt:0};
const snapshot={ok:true,providerId:"codex",updatedAt:1000,rows:[{id:"primary",label:"fiveHour",unit:"usedPercent",value:"25",resetAt:"2020-01-01T00:00:00Z"},{id:"weekly",label:"weekly",unit:"usedPercent",value:"60"}]};
beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true); usage.mockReset();
  Object.assign(window,{electronAPI:{provider:{usage,onAuthEvent:()=>()=>{}}}});
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it("shows the persisted snapshot while loading, retains it after failure and opens details by focus",async()=>{
  let resolve!:(result:unknown)=>void;
  usage.mockResolvedValueOnce(snapshot).mockImplementationOnce(()=>new Promise(done=>{resolve=done;})).mockResolvedValue(snapshot);
  await act(async()=>root.render(createElement(ProviderUsagePreview,{config})));
  expect(usage).toHaveBeenNthCalledWith(1,"codex",false,true);
  expect(host.textContent).toContain("75%");expect(host.textContent).toContain("40%");
  await act(async()=>resolve({ok:false,reason:"unavailable"}));
  expect(host.textContent).toContain("75%"); expect(host.textContent).toContain("待刷新");
  await act(async()=>host.querySelector("button")!.focus());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("上次更新");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("75%");
  await act(async()=>window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("uses monetary amounts without percentage bars and supports pointer and click details",async()=>{
  const deepseek={...config,id:"deepseek",presetId:"deepseek",name:"DeepSeek"};
  usage.mockResolvedValue({ok:true,providerId:"deepseek",updatedAt:1000,rows:[{id:"balance",label:"balance",unit:"money",value:"42.50",currency:"CNY"}]});
  await act(async()=>root.render(createElement(ProviderUsagePreview,{config:deepseek})));
  expect(host.textContent).toContain("CNY 42.50"); expect(host.querySelector('[aria-hidden="true"]')).toBeNull();
  await act(async()=>host.querySelector("button")!.dispatchEvent(new MouseEvent("mouseover",{bubbles:true})));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async()=>host.querySelector("button")!.click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});
it("clears the previous credential's values immediately when configuration changes",async()=>{
  usage.mockResolvedValue(snapshot);
  await act(async()=>root.render(createElement(ProviderUsagePreview,{config})));
  expect(host.textContent).toContain("75%");
  usage.mockResolvedValue({ok:false,reason:"auth"});
  await act(async()=>root.render(createElement(ProviderUsagePreview,{config:{...config,apiKey:"replacement"}})));
  expect(host.textContent).not.toContain("75%");
});
it("revalidates account ownership before retaining a mounted card's old values",async()=>{
  usage.mockResolvedValue(snapshot);
  await act(async()=>root.render(createElement(ProviderUsagePreview,{config})));
  expect(host.textContent).toContain("75%");
  usage.mockImplementation(async (_id,_force,cachedOnly)=>cachedOnly
    ? {ok:false,reason:"unavailable",clearSnapshot:true}
    : {ok:false,reason:"unavailable"});
  await act(async()=>window.dispatchEvent(new Event("focus")));
  expect(host.textContent).not.toContain("75%");
});

it("drops the old account even when credentials change during a failed live refresh",async()=>{
 usage.mockResolvedValue(snapshot);
 await act(async()=>root.render(createElement(ProviderUsagePreview,{config})));
 expect(host.textContent).toContain("75%");
 let ownerChanged=false;
 usage.mockImplementation(async(_id,_force,cachedOnly)=>{
   if(cachedOnly)return ownerChanged ? {ok:false,reason:"unavailable",clearSnapshot:true} : snapshot;
   ownerChanged=true;
   return {ok:false,reason:"unavailable"};
 });
 await act(async()=>window.dispatchEvent(new Event("focus")));
 expect(host.textContent).not.toContain("75%");
});
