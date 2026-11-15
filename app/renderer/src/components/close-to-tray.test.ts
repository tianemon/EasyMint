// @vitest-environment happy-dom
import {act,createElement} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,it,expect,vi} from "vitest";
import type {TrayCloseRequest,TrayCloseResponse} from "@shared/window-tray";
import {CloseToTrayPrompt} from "./CloseToTrayPrompt";
import {uiI18n} from "../lib/i18n";
let host:HTMLDivElement,root:Root,notify:(request:TrayCloseRequest)=>void;
const respond=vi.fn<(response:TrayCloseResponse)=>Promise<void>>(),ready=vi.fn(),off=vi.fn();
beforeEach(async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);await uiI18n.changeLanguage("zh-CN");respond.mockReset().mockResolvedValue(undefined);ready.mockReset().mockResolvedValue(undefined);off.mockReset();
 Object.assign(window,{electronAPI:{win:{onTrayPrompt:(cb:typeof notify)=>{notify=cb;return off;},trayReady:ready,respondToTray:respond}}});
 host=document.createElement("div");document.body.append(host);root=createRoot(host);await act(async()=>root.render(createElement(CloseToTrayPrompt)));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const open=()=>act(async()=>notify({id:"4c0f3f3c-b1cd-4527-b3ed-2cc7d501e588"}));
const click=(name:string)=>act(async()=>{const button=[...document.querySelectorAll("button")].find(node=>node.textContent===name);expect(button).toBeDefined();button!.click();});
it("registers a window-scoped prompt and sends the explicit checkbox choice only when hiding",async()=>{
 expect(ready).toHaveBeenCalledWith(true);expect(document.querySelector('[role="dialog"]')).toBeNull();await open();
 expect(document.querySelector('select,input[type="checkbox"]')).toBeNull();
 await act(async()=>document.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());await click("最小化到托盘");
 expect(respond).toHaveBeenCalledExactlyOnceWith({id:"4c0f3f3c-b1cd-4527-b3ed-2cc7d501e588",hide:true,dontRemind:true});expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("cancels with Escape without persisting a checked preference",async()=>{
 await open();await act(async()=>document.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
 await act(async()=>window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
 expect(respond).toHaveBeenCalledExactlyOnceWith({id:"4c0f3f3c-b1cd-4527-b3ed-2cc7d501e588",hide:false,dontRemind:false});
});
it("keeps a failed preference save actionable and rejects duplicate submits while pending",async()=>{
 await open();respond.mockRejectedValueOnce(new Error("无法保存设置"));await click("最小化到托盘");
 expect(document.querySelector('[role="alert"]')?.textContent).toContain("无法保存设置");expect(document.querySelector('[role="dialog"]')).not.toBeNull();
 let release!:()=>void;respond.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));await click("最小化到托盘");
 await act(async()=>{window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));});expect(respond).toHaveBeenCalledTimes(2);expect(document.querySelector('[role="dialog"]')).not.toBeNull();
 await act(async()=>release());expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("unregisters readiness and the subscription when its renderer is gone",async()=>{
 await act(async()=>root.render(null));expect(off).toHaveBeenCalledOnce();expect(ready).toHaveBeenLastCalledWith(false);
});
