// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TodoButton } from "./TodoButton";
let host: HTMLDivElement, root: Root;
const update = vi.fn();
const todo = {id:7,title:"Original",status:"done",createdAt:100,doneAt:200,note:"Details"};
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  update.mockReset();
  Object.assign(window, {electronAPI:{todos:{list:vi.fn(async () => ({ok:true,data:{todos:[todo]}})),onChanged:()=>()=>{},update}}});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(TodoButton,{projectPath:"/fixture"})));
  await act(async () => host.querySelector("button")!.click());
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const edit = async () => act(async () => host.querySelector<HTMLButtonElement>('[aria-label="编辑"]')!.click());
const enter = async (value: string) => act(async () => {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="编辑"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);
  input.dispatchEvent(new Event("input",{bubbles:true}));
});
it("uses the provided square-pen and updates the original item without replacing its metadata",async () => {
  expect(host.querySelector('[aria-label="编辑"] path')?.getAttribute("d")).toBe("M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7");
  await edit(); await enter(" Revised ");
  update.mockResolvedValue({ok:true});
  await act(async () => host.querySelector('input[aria-label="编辑"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})));
  expect(update).toHaveBeenCalledWith("/fixture",7,"Revised");
  expect(host.querySelector('input[aria-label="编辑"]')).toBeNull();
});
it("keeps the draft on failure and Escape cancels editing without closing the list",async () => {
  await edit(); await enter("Draft"); update.mockResolvedValue({ok:false,error:"Failure"});
  await act(async () => [...host.querySelectorAll("button")].find(button=>button.textContent==="保存")!.click());
  expect(host.querySelector<HTMLInputElement>('input[aria-label="编辑"]')?.value).toBe("Draft");
  expect(host.textContent).toContain("Failure");
  await act(async () => host.querySelector('input[aria-label="编辑"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
  expect(host.querySelector('input[aria-label="编辑"]')).toBeNull();
  expect(host.textContent).toContain("Original");
});
it("does not submit empty titles or Enter during IME composition",async () => {
  await edit(); await enter(" ");
  expect([...host.querySelectorAll("button")].find(button=>button.textContent==="保存")?.disabled).toBe(true);
  await enter("输入中");
  await act(async () => host.querySelector('input[aria-label="编辑"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,isComposing:true})));
  expect(update).not.toHaveBeenCalled();
});
it("removes the previous project's editable rows while the next project is still loading",async()=>{
  await edit(); await enter("Unsaved old project draft");
  vi.mocked(window.electronAPI.todos.list).mockImplementation(()=>new Promise(()=>{}));
  await act(async()=>root.render(createElement(TodoButton,{projectPath:"/other-project"})));
  expect(host.querySelector('[aria-label="编辑"]')).toBeNull();
  expect(host.textContent).not.toContain("Original");
  await act(async()=>host.querySelector("button")!.click());
  expect(host.querySelector('[aria-label="编辑"]')).toBeNull();
  expect(update).not.toHaveBeenCalled();
});
