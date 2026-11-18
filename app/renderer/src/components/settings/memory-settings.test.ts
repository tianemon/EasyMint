// @vitest-environment happy-dom
import {act,createElement,Fragment} from "react";
import {createRoot,type Root} from "react-dom/client";
import {beforeEach,afterEach,expect,it,vi} from "vitest";
import type {MemoryDocument,MemoryView} from "@shared/memory";
import {MemoryTab} from "./MemoryTab";
import {ConfirmHost} from "../ui/ConfirmDialog";
import {uiI18n} from "../../lib/i18n";
let host:HTMLDivElement,root:Root,view:MemoryView,documentValue:MemoryDocument,changed:()=>void;
const query=vi.fn(),readDocument=vi.fn(),saveDocument=vi.fn(),configure=vi.fn();
beforeEach(async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);await uiI18n.changeLanguage("zh-CN");
 view={settings:{enabled:true,background:false},status:{count:77,pending:8,usedTokens:55},ready:true};
 documentValue={file:"/synthetic/MEMORY.md",hash:"a".repeat(64),content:"# 我的记忆\n用户直接编辑的原文 <!-- memory:global/existing r:1 -->\n"};
 query.mockReset();readDocument.mockReset().mockImplementation(async()=>structuredClone(documentValue));saveDocument.mockReset().mockImplementation(async(content,hash)=>({...documentValue,content,hash}));
 configure.mockReset().mockImplementation(async patch=>view.settings={...view.settings,...patch});
 Object.assign(window,{electronAPI:{memory:{state:async()=>structuredClone(view),onChanged:(cb:()=>void)=>{changed=cb;return ()=>{};},query,readDocument,saveDocument,configure}}});
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
 await act(async()=>root.render(createElement(Fragment,null,createElement(MemoryTab),createElement(ConfirmHost))));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const button=(text:string)=>[...document.querySelectorAll("button")].find(node=>node.textContent===text);
it("shows only two slider switches and a document entry without reading database rows",()=>{
 expect(host.querySelectorAll('[role="switch"]')).toHaveLength(2);expect(host.querySelector('[role="checkbox"],select,input')).toBeNull();
 expect(host.textContent).toContain("MEMORY.md");for(const value of ["secret-project","secret-backup","secret-error","待确认","归档","每日预算","77"])expect(host.textContent).not.toContain(value);
 expect(query).not.toHaveBeenCalled();expect(readDocument).toHaveBeenCalledOnce();
});
it("changes only the chosen toggle and keeps document viewing available while memory is disabled",async()=>{
 const enabled=host.querySelector<HTMLButtonElement>('[aria-label="启用记忆"]')!;await act(async()=>enabled.click());
 expect(configure).toHaveBeenCalledExactlyOnceWith({enabled:false});expect(host.querySelector<HTMLButtonElement>('[aria-label="后台自动整理"]')!.disabled).toBe(true);
 expect(document.querySelector("textarea")?.value).toBe(documentValue.content);expect(document.querySelector("textarea")?.classList.contains("flex-1")).toBe(true);
});
it("shows the read-only document inline and refreshes it when memory changes",async()=>{
 const field=host.querySelector("textarea")!;expect(field.readOnly).toBe(true);expect(field.value).toBe(documentValue.content);expect(button("保存")).toBeUndefined();expect(button("查看")).toBeUndefined();
 documentValue={...documentValue,content:"# MEMORY\nA newly saved fact"};await act(async()=>changed());
 expect(readDocument).toHaveBeenCalledTimes(2);expect(field.value).toBe(documentValue.content);expect(saveDocument).not.toHaveBeenCalled();expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("disables repeated switch writes until the first request settles",async()=>{
 let release!:(value:MemoryView["settings"])=>void;configure.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const enabled=host.querySelector<HTMLButtonElement>('[aria-label="启用记忆"]')!;await act(async()=>{enabled.click();enabled.click();});expect(configure).toHaveBeenCalledOnce();
 expect(host.textContent).toContain("正在保存设置");
 await act(async()=>{view.settings={...view.settings,enabled:false};release(view.settings);});expect(enabled.getAttribute("aria-checked")).toBe("false");
});

it("shows initialization and resolved service errors without mistaking enabled settings for readiness",async()=>{
 view.ready=false;await act(async()=>changed());expect(host.querySelector('[role="status"]')?.textContent??"").toContain("正在准备记忆");
 view.status.error="合成数据库不可用";await act(async()=>changed());
 expect(host.querySelector('[role="alert"]')?.textContent??"").toContain("记忆暂不可用");expect(host.textContent).toContain("合成数据库不可用");
 expect(host.querySelector('[aria-label="启用记忆"]')?.getAttribute("aria-checked")).toBe("true");
 view.ready=true;view.settings.background=true;view.status.error="合成整理失败";await act(async()=>changed());
 expect(host.querySelector('[role="alert"]')?.textContent??"").toContain("记忆处理遇到问题");
 view.status.error=undefined;await act(async()=>changed());expect(host.querySelector('[role="alert"]')).toBeNull();expect(host.querySelector('[role="status"]')).toBeNull();
});

it("keeps an unavailable status after a setting was saved successfully",async()=>{
 view.settings.enabled=false;view.ready=false;view.status.error="合成初始化失败";await act(async()=>changed());
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="启用记忆"]')!.click());
 expect(configure).toHaveBeenCalledExactlyOnceWith({enabled:true});
 expect(host.querySelector('[aria-label="启用记忆"]')?.getAttribute("aria-checked")).toBe("true");
 expect(host.querySelector('[role="alert"]')?.textContent??"").toContain("合成初始化失败");
 expect(host.querySelectorAll('[role="switch"]')).toHaveLength(2);expect(button("重试")).toBeUndefined();
});

it("keeps toggles usable and the last document visible when a refresh fails, then recovers",async()=>{
 readDocument.mockRejectedValueOnce(new Error('synthetic document failure'));await act(async()=>changed());
 expect(host.textContent).toContain('synthetic document failure');expect(host.querySelector('textarea')!.value).toBe(documentValue.content);
 expect(host.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(false);
 documentValue={...documentValue,content:'# MEMORY\nRecovered content'};await act(async()=>changed());
 expect(host.querySelector('textarea')!.value).toBe(documentValue.content);expect(host.textContent).not.toContain('synthetic document failure');
});
