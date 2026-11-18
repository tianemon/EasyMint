import { getPromptDefaults } from "../../../../main/services/system-prompt-manager";
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => "/tmp" } }));
const DEFAULT_MAIN_CHAT = getPromptDefaults().main;
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConversationConfig } from "@shared/collaboration";

import { uiI18n } from "../../lib/i18n";
import { MainChatSettings, CollaborationSettings } from "./ConversationSettings";
import { AgentTemplateSettings } from "../AgentTemplateSettings";
import { CollaborationModePicker } from "../CollaborationModePicker";
import { useConversationStore } from "../../stores/conversation-store";
import { SettingsDialog } from "../SettingsDialog";
import { useCollaborationModes } from "../../hooks/useCollaborationModes";

let host: HTMLDivElement, root: Root;
let config: ConversationConfig;
const saveMain = vi.fn(), saveMode = vi.fn(), update = vi.fn(), create = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  config = { main: { ...DEFAULT_MAIN_CHAT, rules: "Existing rules" }, modes: [
    { id: "ui-design", name: "UI 设计", scenario: "设计新界面时", customizedFields: ["scenario"], prompt: "UI rules", defaultEnabled: false, builtin: true },
    { id: "domain-guidance", name: "领域引导", scenario: "进入陌生领域时", customizedFields: ["scenario"], prompt: "Guidance rules", defaultEnabled: false, builtin: true },
  ] };
  saveMain.mockReset().mockImplementation(async main => { config = { ...config, main }; return config; });
  saveMode.mockReset().mockResolvedValue(config);
  update.mockReset().mockResolvedValue({});
  create.mockReset().mockResolvedValue({});
  Object.assign(window, { electronAPI: {
    conversation: { get: async () => config, onChanged: () => () => {}, saveMain, saveMode },
    agentTemplates: { list: async () => [{ id: "mint", name: "Mint", description: "Main", prompt: "Main rules", agentType: "mint" }, { id: "default-builder", name: "Builder", description: "Implementation", prompt: "Builder rules", agentType: "builder" }], update, create },
  } });
  useConversationStore.getState().setConfig(config);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); await uiI18n.changeLanguage("zh-CN"); vi.unstubAllGlobals(); });
const clickText = async (label: string) => act(async () => {
  const button = [...host.querySelectorAll("button")].find(button => button.textContent === label);
  expect(button).toBeDefined(); button!.click();
});
const input = async (element: HTMLInputElement | HTMLTextAreaElement, value: string) => act(async () => {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
});

it("saves nickname, user address, personality and rules as separate main-chat fields", async () => {
  await act(async () => root.render(createElement(MainChatSettings, { onSaved: () => {} })));
  expect(host.querySelectorAll('input:not([type="file"])')).toHaveLength(2);
  expect(host.querySelectorAll("textarea")).toHaveLength(2);
  await input(host.querySelectorAll<HTMLInputElement>('input:not([type="file"])')[0]!, "Mori");
  await input(host.querySelectorAll<HTMLInputElement>('input:not([type="file"])')[1]!, "Amon");
  await input(host.querySelectorAll("textarea")[0]!, "Concise style");
  await input(host.querySelectorAll("textarea")[1]!, "Updated rules");
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(saveMain).toHaveBeenCalledWith({ nickname: "Mori", userAddress: "Amon", avatar: "", personality: "Concise style", rules: "Updated rules" }, undefined);
  expect(host.textContent).not.toContain("适用范围");
});

it.each([false, true])("refreshes an untouched editor but preserves a dirty draft when the latest revision arrives (dirty=%s)", async dirty => {
  config.main = { ...config.main, nickname: "Cached" }; config.mainRevision = "old-revision";
  useConversationStore.getState().setConfig(config);
  let resolve!: (value: ConversationConfig) => void;
  window.electronAPI.conversation.get = () => new Promise(done => { resolve = done; });
  await act(async () => root.render(createElement(MainChatSettings, { onSaved: () => {} })));
  if (dirty) await input(host.querySelector('input:not([type="file"])')!, "Draft");
  const fresh = { ...config, main: { ...config.main, nickname: "Fresh" }, mainRevision: "fresh-revision" };
  await act(async () => resolve(fresh));
  expect((host.querySelector('input:not([type="file"])') as HTMLInputElement).value).toBe(dirty ? "Draft" : "Fresh");
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(saveMain.mock.lastCall?.[1]).toBe(dirty ? "old-revision" : "fresh-revision");
});

it("edits only the execution template prompt and sends no main-chat profile fields", async () => {
  await act(async () => root.render(createElement(AgentTemplateSettings)));
  const builder = [...host.querySelectorAll("div.group")].find(row => row.textContent?.includes("Builder"))!;
  await act(async () => builder.querySelector<HTMLButtonElement>("button")!.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog).not.toBeNull();
  const metadata = dialog.querySelectorAll("input");
  expect(metadata).toHaveLength(2);
  expect([...metadata].every(field => field.readOnly)).toBe(true);
  expect(metadata[0]!.value).toBe("Builder");
  expect(metadata[1]!.value).toBe("Implementation");
  expect(dialog.querySelectorAll("textarea")).toHaveLength(1);
  expect(dialog.querySelector(".overflow-y-auto")!.contains(dialog.querySelector('button[type="submit"]'))).toBe(false);
  await input(dialog.querySelector("textarea")!, "New builder instructions");
  await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(update).toHaveBeenCalledWith("default-builder", { prompt: "New builder instructions" }, undefined);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const mainForm=host.querySelector('form[aria-label="主对话"]')!;
  expect(mainForm.querySelectorAll("textarea")).toHaveLength(2);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("shows the main profile inline and keeps its saved nickname without a duplicate role card",async()=>{
  await act(async()=>root.render(createElement(AgentTemplateSettings)));
  const form=host.querySelector('form[aria-label="主对话"]')!;
  expect(form).not.toBeNull();expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(form.querySelector('input[type="file"]')).not.toBeNull();
  await input(form.querySelector('input:not([type="file"])')!,"Mori");
  await act(async()=>form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
  expect(saveMain.mock.lastCall?.[0].nickname).toBe("Mori");
  expect(form.querySelector<HTMLInputElement>('input:not([type="file"])')!.value).toBe("Mori");
  expect([...host.querySelectorAll('div.group')].map(row=>row.querySelector('span')?.textContent)).toEqual(["Builder"]);
});

it("uses matching template field titles and helpful placeholders when adding a template", async () => {
  await act(async () => root.render(createElement(AgentTemplateSettings)));
  await clickText("+ 新建角色");
  const dialog = document.querySelector('[role="dialog"]')!;
  expect([...dialog.querySelectorAll("label")].map(label => label.textContent)).toEqual(["名称", "描述", "规则提示词"]);
  expect([...dialog.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea")].every(field => field.placeholder.trim())).toBe(true);
});

it("keeps a saving template dialog open until its request settles", async () => {
  let finish!: () => void;
  update.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => root.render(createElement(AgentTemplateSettings)));
  const builder = [...host.querySelectorAll("div.group")].find(row => row.textContent?.includes("Builder"))!;
  await act(async () => builder.querySelector<HTMLButtonElement>("button")!.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(dialog.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.disabled).toBe(true);
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
  await act(async () => {
    const overlay = dialog.parentElement!;
    overlay.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    overlay.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
  await act(async () => finish());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("creates a custom mode without configuring an icon and supports stacked selections", async () => {
  await act(async () => root.render(createElement(CollaborationSettings)));
  await clickText("新增模式");
  const editor = document.querySelector('[role="dialog"]')!;
  const fields = editor.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])');
  expect([...fields].every(field => field.placeholder.trim())).toBe(true);
  expect(editor.querySelector("textarea")!.placeholder).not.toBe("");
  await input(fields[0]!, "Writing"); await input(fields[1]!, "When writing reports");
  await input(editor.querySelector("textarea")!, "Write short paragraphs");
  expect(editor.querySelector('input[type="checkbox"]')).toBeNull();
  const defaultEnabled = editor.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
  expect(defaultEnabled.getAttribute("aria-checked")).toBe("false");
  await act(async () => defaultEnabled.click());
  expect(defaultEnabled.getAttribute("aria-checked")).toBe("true");
  await act(async () => editor.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(saveMode).toHaveBeenCalledWith({ id: undefined, customizedFields: ["name", "scenario"], name: "Writing", scenario: "When writing reports", prompt: "Write short paragraphs", defaultEnabled: true, builtin: false });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const change = vi.fn();
  await act(async () => root.render(createElement(CollaborationModePicker, { modes: config.modes, selected: ["ui-design"], onChange: change })));
  await act(async () => host.querySelector("button")!.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect([...dialog.querySelectorAll("svg")].every(svg => svg.closest('[role="checkbox"]'))).toBe(true);
  expect(dialog.textContent).toContain("进入陌生领域时");
  expect(host.querySelector("button")!.textContent).not.toContain("协作模式");
  expect(dialog.classList.contains("w-max")).toBe(true);
  await act(async () => dialog.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')[1]!.click());
  expect(change).toHaveBeenCalledWith(["ui-design", "domain-guidance"]);
  expect(change).toHaveBeenCalledOnce();
});

it("blocks empty and whitespace-only modes before calling the API, including direct form submission", async () => {
  await act(async () => root.render(createElement(CollaborationSettings)));
  await clickText("新增模式");
  const dialog = document.querySelector('[role="dialog"]')!;
  const form = dialog.querySelector("form")!;
  const submit = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const name = dialog.querySelector<HTMLInputElement>("input")!;
  const prompt = dialog.querySelector("textarea")!;
  expect(form.noValidate).toBe(true);
  expect(submit.disabled).toBe(true);
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(saveMode).not.toHaveBeenCalled();
  await input(name, "Writing"); await input(prompt, "   ");
  expect(submit.disabled).toBe(true);
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(saveMode).not.toHaveBeenCalled();
  await input(prompt, "Write short paragraphs");
  expect(submit.disabled).toBe(false);
});

it("localizes untouched built-in mode labels while keeping user wording", async () => {
  config.modes[0] = { ...config.modes[0]!, name: getPromptDefaults().modes[0]!.name, scenario: getPromptDefaults().modes[0]!.scenario, customizedFields: [] };
  config.modes[1] = { ...config.modes[1]!, name: "我的引导", scenario: "我的场景", customizedFields: ["name", "scenario"] };
  await uiI18n.changeLanguage("en");
  await act(async () => root.render(createElement(CollaborationModePicker, { modes: config.modes, selected: [], onChange: () => {} })));
  await act(async () => host.querySelector("button")!.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("UI design");
  expect(dialog.textContent).toContain("When designing an interface");
  expect(dialog.textContent).toContain("我的引导");
  expect(dialog.textContent).toContain("我的场景");
});

it("locks main profile fields during a request and retains an editable draft after failure", async () => {
  let fail!: (error: Error) => void;
  saveMain.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  const close = vi.fn();
  await act(async () => root.render(createElement(MainChatSettings, { onSaved: close })));
  await input(host.querySelectorAll("textarea")[1]!, "Draft retained after failure");
  const form = host.querySelector("form")!;
  await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(saveMain).toHaveBeenCalledOnce();
  expect([...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea")].every(field => field.disabled)).toBe(true);
  await act(async () => fail(new Error("synthetic write failure")));
  expect(close).not.toHaveBeenCalled();
  expect(host.querySelectorAll("textarea")[1]!.value).toBe("Draft retained after failure");
  expect([...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea")].every(field => !field.disabled)).toBe(true);
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(close).toHaveBeenCalledOnce();
});

it.each(["builder", "custom"])("locks %s template fields and allows retry after a failed save", async kind => {
  const api = kind === "builder" ? update : create;
  let fail!: (error: Error) => void;
  api.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  await act(async () => root.render(createElement(AgentTemplateSettings)));
  if (kind === "builder") {
    const row = [...host.querySelectorAll("div.group")].find(node => node.textContent?.includes("Builder"))!;
    await act(async () => row.querySelector<HTMLButtonElement>("button")!.click());
  } else {
    await clickText("+ 新建角色");
    await input(document.querySelector('[role="dialog"] input')!, "New template");
  }
  const dialog = document.querySelector('[role="dialog"]')!, form = dialog.querySelector("form")!;
  await input(dialog.querySelector("textarea")!, "Retained template draft");
  await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(api).toHaveBeenCalledOnce();
  expect([...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([readonly]),textarea')].every(field => field.disabled)).toBe(true);
  await act(async () => fail(new Error("synthetic template failure")));
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
  expect(dialog.querySelector("textarea")!.value).toBe("Retained template draft");
  expect([...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([readonly]),textarea')].every(field => !field.disabled)).toBe(true);
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("locks mode edits during save and preserves them for retry after failure", async () => {
  let fail!: (error: Error) => void;
  saveMode.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  await act(async () => root.render(createElement(CollaborationSettings)));
  await clickText("新增模式");
  const dialog = document.querySelector('[role="dialog"]')!, form = dialog.querySelector("form")!;
  await input(dialog.querySelector("input")!, "Test mode"); await input(dialog.querySelector("textarea")!, "Mode draft");
  await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(saveMode).toHaveBeenCalledOnce();
  expect([...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea")].every(field => field.disabled)).toBe(true);
  expect(dialog.querySelector<HTMLButtonElement>('[role="checkbox"]')!.disabled).toBe(true);
  await act(async () => fail(new Error("synthetic mode failure")));
  expect(dialog.querySelector("textarea")!.value).toBe("Mode draft");
  expect([...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea")].every(field => !field.disabled)).toBe(true);
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("focuses and navigates mode options, then returns focus on Escape", async () => {
  await act(async () => root.render(createElement(CollaborationModePicker, { modes: config.modes, selected: ["ui-design"], onChange: vi.fn() })));
  const trigger = host.querySelector("button")!;
  await act(async () => { trigger.focus(); trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); });
  const options = document.querySelectorAll<HTMLButtonElement>('[role="checkbox"]');
  expect(document.activeElement).toBe(options[0]);
  await act(async () => options[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(options[1]);
  await act(async () => options[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(options[0]);
  await act(async () => options[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(trigger);
});

it.each([false, true])("restores picker focus after the real mode hook finishes writing (closed during save=%s)", async closeDuringSave => {
  let finish!: () => void;
  window.electronAPI.conversation.getModes = async () => ["ui-design"];
  window.electronAPI.sessionCache = { write: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) } as unknown as ElectronAPI["sessionCache"];
  function Harness() {
    const state = useCollaborationModes("__new_fixture-session");
    return createElement(CollaborationModePicker, { modes: config.modes, selected: state.ids, disabled: !state.ready, onChange: ids => { void state.change(ids); } });
  }
  await act(async () => root.render(createElement(Harness)));
  const trigger = host.querySelector<HTMLButtonElement>("button")!;
  await act(async () => trigger.click());
  await act(async () => document.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')[1]!.click());
  expect(trigger.disabled).toBe(true);
  if (closeDuringSave) {
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  }
  await act(async () => finish());
  expect(trigger.disabled).toBe(false);
  if (closeDuringSave) expect(document.activeElement).toBe(trigger);
  else {
    expect(document.activeElement).toBe(document.querySelectorAll('[role="checkbox"]')[1]);
    expect(document.activeElement?.getAttribute("aria-checked")).toBe("true");
  }
});

it("keeps an existing conversation's modes read-only while displaying its saved selection",async()=>{
 const write=vi.fn();window.electronAPI.sessionCache={write} as unknown as ElectronAPI['sessionCache'];
 window.electronAPI.conversation.getModes=async()=>['ui-design'];
 let current!:ReturnType<typeof useCollaborationModes>;
 function Harness(){current=useCollaborationModes('created-session');return createElement(CollaborationModePicker,{modes:config.modes,selected:current.ids,disabled:!current.ready||!current.editable,onChange:ids=>{void current.change(ids);}});}
 await act(async()=>root.render(createElement(Harness)));
 expect(host.querySelector('button')!.disabled).toBe(true);expect(host.querySelector('button')!.textContent).toBe('UI 设计');
 await act(async()=>current.change(['domain-guidance']));expect(write).not.toHaveBeenCalled();expect(current.ids).toEqual(['ui-design']);
});
it("freezes a draft selection while creation is pending, unlocks on failure, and stays fixed after identity binding",async()=>{
 const write=vi.fn(async()=>{});window.electronAPI.sessionCache={write} as unknown as ElectronAPI['sessionCache'];
 window.electronAPI.conversation.getModes=async()=>['ui-design'];
 let current!:ReturnType<typeof useCollaborationModes>;
 function Harness({id}:{id:string}){current=useCollaborationModes(id);return createElement(CollaborationModePicker,{modes:config.modes,selected:current.ids,disabled:!current.ready||!current.editable,onChange:ids=>{void current.change(ids);}});}
 await act(async()=>root.render(createElement(Harness,{id:'__new_draft'})));
 expect(current.editable).toBe(true);
 await act(async()=>{expect(await current.getIds()).toEqual(['ui-design']);});
 expect(current.editable).toBe(false);await act(async()=>current.change([]));expect(write).not.toHaveBeenCalled();
 await act(async()=>current.cancelCreation());expect(current.editable).toBe(true);
 await act(async()=>current.change(['domain-guidance']));expect(write).toHaveBeenCalledOnce();
 await act(async()=>root.render(createElement(Harness,{id:'created-real'})));
 expect(current.editable).toBe(false);await act(async()=>current.cancelCreation());expect(current.editable).toBe(false);
});

it("keeps the inline profile mounted while saving and releases settings navigation after failure",async()=>{
 let fail!:(error:Error)=>void;saveMain.mockImplementationOnce(()=>new Promise((_done,reject)=>{fail=reject;}));
 const close=vi.fn();await act(async()=>root.render(createElement(SettingsDialog,{open:true,initialTab:'agent',onClose:close})));
 const form=host.querySelector('form[aria-label="主对话"]')!;await input(form.querySelectorAll('textarea')[1]!,'Inline draft protected');
 await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect([...host.querySelectorAll<HTMLButtonElement>('.settings-header-tab,.settings-header .dialog-close-button')].every(button=>button.disabled)).toBe(true);
 expect([...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='协作模式')!.disabled).toBe(true);
 await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(close).not.toHaveBeenCalled();expect(form.isConnected).toBe(true);
 await act(async()=>fail(new Error('synthetic inline save failure')));
 expect(form.querySelectorAll('textarea')[1]!.value).toBe('Inline draft protected');
 expect(host.querySelector<HTMLButtonElement>('.settings-header .dialog-close-button')!.disabled).toBe(false);
 await act(async()=>host.querySelector<HTMLButtonElement>('.settings-header .dialog-close-button')!.click());expect(close).toHaveBeenCalledOnce();
});
it("does not confuse temporary send blocking with a created conversation",async()=>{
 const get=vi.fn(async()=>['ui-design']);window.electronAPI.conversation.getModes=get;
 let current!:ReturnType<typeof useCollaborationModes>;
 function Harness({blocked}:{blocked:boolean}){current=useCollaborationModes('__new_waiting',undefined,{blocked});return createElement('span',null,String(current.editable));}
 await act(async()=>root.render(createElement(Harness,{blocked:true})));
 expect(get).toHaveBeenCalledExactlyOnceWith('__new_waiting',undefined,false);expect(current.editable).toBe(false);
 await act(async()=>root.render(createElement(Harness,{blocked:false})));
 expect(current.editable).toBe(true);expect(get).toHaveBeenCalledOnce();
});
