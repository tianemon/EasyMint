// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlanUsageButton } from "./PlanUsageButton";
import { useSettingsStore } from "../stores/settings-store";
import { listPresets, type ApiProvidersData, type ProviderConfig } from "@shared/platform-presets";
import { accountUsageLabels } from "@shared/provider-usage";
import type { ProviderAuthEventMessage } from "@shared/provider-auth";
vi.hoisted(()=>vi.stubGlobal("localStorage",{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}));
let container:HTMLDivElement,root:Root;
const usage=vi.fn(),codexQuota=vi.fn(),fetchBalance=vi.fn();
const provider=(presetId:string,id=presetId):ProviderConfig=>({id,presetId,name:presetId,model:"fixture",models:["fixture"],apiKey:"",createdAt:0});
const router=provider("openrouter"),moonshot=provider("moonshotai-cn");
const state=():ApiProvidersData=>({current:router.id,configs:{[router.id]:router,[moonshot.id]:moonshot}});
beforeEach(()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);usage.mockReset();
 Object.assign(window,{electronAPI:{provider:{usage,codexQuota},settings:{fetchBalance}}});
 useSettingsStore.setState({apiProviders:state()});
 container=document.createElement("div");document.body.append(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals();});
const mount=()=>act(async()=>root.render(createElement(PlanUsageButton)));
const open=()=>act(async()=>container.querySelector<HTMLButtonElement>("button")!.click());

it("queries only when opened and distinguishes key usage from account balance",async()=>{
 usage.mockResolvedValue({ok:true,providerId:"openrouter",rows:[{id:"usage",label:"usage",unit:"money",currency:"USD",value:"0"},{id:"keyRemaining",label:"keyRemaining",unit:"unlimited"}],updatedAt:1});
 await mount();expect(container.textContent).toBe("额度用量");expect(usage).not.toHaveBeenCalled();
 await open();expect(usage).toHaveBeenCalledWith("openrouter",false);
 expect(container.textContent).toContain("密钥累计用量");expect(container.textContent).toContain("USD 0");
 expect(container.textContent).toContain("未设上限");expect(container.querySelector('[data-usage-row="balance"]')).toBeNull();
});

it("keeps stable placeholders during load and permits explicit retry",async()=>{
 let resolve!:(value:unknown)=>void;usage.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 await mount();await open();
 expect(container.querySelectorAll('[data-usage-row]')).toHaveLength(2);expect(container.textContent).toContain("—");
 expect(container.textContent).not.toContain("USD 0");
 await act(async()=>resolve({ok:false,reason:"rateLimit"}));
 expect(container.querySelector('[role="status"]')?.textContent).toContain("查询过于频繁");
 usage.mockResolvedValueOnce({ok:true,providerId:"openrouter",rows:[{id:"usage",label:"usage",unit:"money",currency:"USD",value:"12"}],updatedAt:2});
 await act(async()=>[...container.querySelectorAll('button')].find(button=>button.textContent==="重试")!.click());
 expect(usage).toHaveBeenLastCalledWith("openrouter",true);expect(container.textContent).toContain("USD 12");
});

it("closes on provider change and ignores the previous account's late response",async()=>{
 let old!:(value:unknown)=>void;usage.mockImplementationOnce(()=>new Promise(resolve=>{old=resolve;}));
 await mount();await open();
 await act(async()=>useSettingsStore.setState({apiProviders:{...state(),current:moonshot.id}}));
 expect(container.querySelector('[role="dialog"]')).toBeNull();expect(usage).toHaveBeenCalledTimes(1);
 await act(async()=>old({ok:true,providerId:router.id,rows:[{id:"old",label:"balance",value:"999",unit:"money"}],updatedAt:1}));
 expect(container.textContent).not.toContain("999");
 usage.mockResolvedValueOnce({ok:true,providerId:moonshot.id,rows:[{id:"balance",label:"balance",value:"7.5",currency:"CNY",unit:"money"}],updatedAt:2});
 await open();expect(usage).toHaveBeenLastCalledWith(moonshot.id,false);expect(container.textContent).toContain("CNY 7.5");
});
it("closes on a new login for the same provider and discards the old account response",async()=>{
 let authEvent:((message:ProviderAuthEventMessage)=>void)|undefined,old!:(value:unknown)=>void;
 Object.assign(window.electronAPI.provider,{onAuthEvent:(callback:typeof authEvent)=>{authEvent=callback;return()=>{authEvent=undefined;};}});
 usage.mockImplementationOnce(()=>new Promise(resolve=>{old=resolve;}));
 await mount();await open();
 await act(async()=>authEvent?.({providerId:router.id,requestId:"new-login",event:{kind:"progress"}}));
 expect(container.querySelector('[role="dialog"]')).toBeNull();
 await act(async()=>old({ok:true,providerId:router.id,rows:[{id:"old",label:"balance",value:"999",unit:"money"}],updatedAt:1}));
 expect(container.textContent).not.toContain("999");
});

it("refreshes on focus while open and stops querying after close",async()=>{
 vi.useFakeTimers();usage.mockResolvedValue({ok:true,providerId:router.id,rows:[{id:"usage",label:"usage",value:"3",unit:"money"}],updatedAt:1});
 await mount();await open();expect(usage).toHaveBeenCalledTimes(1);
 await act(async()=>window.dispatchEvent(new Event("focus")));expect(usage).toHaveBeenCalledTimes(2);
 await open();await act(async()=>{vi.advanceTimersByTime(61_000);window.dispatchEvent(new Event("focus"));});
 expect(usage).toHaveBeenCalledTimes(2);
});

it("retains known data with an explicit error when a later refresh fails",async()=>{
 usage.mockResolvedValueOnce({ok:true,providerId:router.id,rows:[{id:"usage",label:"usage",value:"3",currency:"USD",unit:"money"}],updatedAt:1});
 await mount();await open();usage.mockResolvedValueOnce({ok:false,reason:"unavailable"});
 await act(async()=>window.dispatchEvent(new Event("focus")));
 expect(container.textContent).toContain("USD 3");expect(container.querySelector('[role="status"]')).not.toBeNull();
});
it("clears account data if authentication is lost",async()=>{
 usage.mockResolvedValueOnce({ok:true,providerId:router.id,rows:[{id:"usage",label:"usage",value:"3",currency:"USD",unit:"money"}],updatedAt:1});
 await mount();await open();usage.mockResolvedValueOnce({ok:false,reason:"auth"});
 await act(async()=>window.dispatchEvent(new Event("focus")));
 expect(container.textContent).not.toContain("USD 3");expect(container.querySelector('[role="status"]')?.textContent).toContain("请检查登录状态");
});

it("only offers Claude usage with account login and keeps known unsupported platforms hidden",async()=>{
 const claude=provider("anthropic");useSettingsStore.setState({apiProviders:{current:claude.id,configs:{[claude.id]:claude}}});
 await mount();expect(container.textContent).toBe("");
 await act(async()=>useSettingsStore.setState({apiProviders:{current:claude.id,configs:{[claude.id]:{...claude,authType:"oauth"}}}}));
 expect(container.textContent).toBe("额度用量");
 expect(accountUsageLabels(provider("qwen-token-plan"))).toBeUndefined();
 expect(accountUsageLabels(provider("custom"))).toBeUndefined();
 // All advertised platform IDs exist in the application's actual preset catalog.
 const ids=new Set(listPresets().map(p=>p.id));
 for(const id of ["moonshotai","moonshotai-cn","openrouter","minimax","minimax-cn","kimi-coding","zai","zai-coding-cn","anthropic","github-copilot"])expect(ids.has(id)).toBe(true);
});
