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
 view={settings:{enabled:true,background:false},status:{count:77,pending:8,usedTokens:55},reports:[{directory:"secret-project",backup:"secret-backup",imported:1,unchanged:0,conflicts:0,errors:["secret-error"],missing:[]}],ready:true};
 documentValue={file:"/synthetic/MEMORY.md",hash:"a".repeat(64),content:"# 我的记忆\n用户直接编辑的原文 <!-- memory:global/existing r:1 -->\n",reviewHash:"b".repeat(64),available:"",protectedLines:[],changes:"",removed:[]};
 query.mockReset();readDocument.mockReset().mockImplementation(async()=>structuredClone(documentValue));saveDocument.mockReset().mockImplementation(async(content,hash)=>({...documentValue,content,hash}));
 configure.mockReset().mockImplementation(async patch=>view.settings={...view.settings,...patch});
 Object.assign(window,{electronAPI:{memory:{state:async()=>structuredClone(view),onChanged:(cb:()=>void)=>{changed=cb;return ()=>{};},query,readDocument,saveDocument,configure}}});
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
 await act(async()=>root.render(createElement(Fragment,null,createElement(MemoryTab),createElement(ConfirmHost))));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const button=(text:string)=>[...document.querySelectorAll("button")].find(node=>node.textContent===text);
const click=(text:string)=>act(async()=>{const node=button(text);expect(node).toBeDefined();node!.click();});
const input=(value:string)=>act(async()=>{const field=document.querySelector("textarea")!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,value);field.dispatchEvent(new Event("input",{bubbles:true}));});
it("shows only two slider switches and a document entry without reading database rows",()=>{
 expect(host.querySelectorAll('[role="switch"]')).toHaveLength(2);expect(host.querySelector('[role="checkbox"],select,input')).toBeNull();
 expect(host.textContent).toContain("MEMORY.md");for(const value of ["secret-project","secret-backup","secret-error","待确认","归档","每日预算","77"])expect(host.textContent).not.toContain(value);
 expect(query).not.toHaveBeenCalled();expect(readDocument).not.toHaveBeenCalled();
});
it("changes only the chosen toggle and keeps document editing available while memory is disabled",async()=>{
 const enabled=host.querySelector<HTMLButtonElement>('[aria-label="启用记忆"]')!;await act(async()=>enabled.click());
 expect(configure).toHaveBeenCalledExactlyOnceWith({enabled:false});expect(host.querySelector<HTMLButtonElement>('[aria-label="后台自动整理"]')!.disabled).toBe(true);
 await click("查看和编辑");expect(document.querySelector("textarea")?.value).toBe(documentValue.content);expect(document.querySelector("textarea")?.classList.contains("flex-1")).toBe(true);
});
it("saves exact MD contents with the opened version, including edits to linked lines",async()=>{
 await click("查看和编辑");const updated="# 新记忆\n我自己写的完整文字\n";await input(updated);await click("保存");
 expect(saveDocument).toHaveBeenCalledExactlyOnceWith(updated,"a".repeat(64));expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("retains unsaved edits across background notifications and failed concurrent saves",async()=>{
 await click("查看和编辑");await input("未保存的文字");await act(async()=>changed());expect(document.querySelector("textarea")?.value).toBe("未保存的文字");expect(readDocument).toHaveBeenCalledOnce();
 saveDocument.mockRejectedValueOnce(new Error("MEMORY.md changed. Reopen it before saving."));await click("保存");expect(document.querySelector("textarea")?.value).toBe("未保存的文字");expect(document.querySelector('[role="alert"]')?.textContent).toContain("重新打开");
});
it("asks before discarding a dirty document",async()=>{
 await click("查看和编辑");await input("保留草稿");await click("取消");expect(document.body.textContent).toContain("放弃未保存的修改");await click("放弃修改");expect(document.querySelector("textarea")).toBeNull();
});
it("disables repeated switch writes until the first request settles",async()=>{
 let release!:(value:MemoryView["settings"])=>void;configure.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const enabled=host.querySelector<HTMLButtonElement>('[aria-label="启用记忆"]')!;await act(async()=>{enabled.click();enabled.click();});expect(configure).toHaveBeenCalledOnce();
 await act(async()=>release({...view.settings,enabled:false}));expect(enabled.getAttribute("aria-checked")).toBe("false");
});
