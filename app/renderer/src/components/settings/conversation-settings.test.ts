// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConversationConfig } from "@shared/collaboration";
import { DEFAULT_MAIN_CHAT, BUILTIN_MODE_DISPLAY } from "@shared/collaboration";
import { uiI18n } from "../../lib/i18n";
import { MainChatSettings, CollaborationSettings } from "./ConversationSettings";
import { AgentTemplateSettings } from "../AgentTemplateSettings";
import { CollaborationModePicker } from "../CollaborationModePicker";
import { useConversationStore } from "../../stores/conversation-store";

let host: HTMLDivElement, root: Root;
let config: ConversationConfig;
const saveMain = vi.fn(), saveMode = vi.fn(), update = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  config = { main: { ...DEFAULT_MAIN_CHAT, rules: "Existing rules" }, modes: [
    { id: "ui-design", name: "UI 设计", scenario: "设计新界面时", prompt: "UI rules", defaultEnabled: false, builtin: true },
    { id: "domain-guidance", name: "领域引导", scenario: "进入陌生领域时", prompt: "Guidance rules", defaultEnabled: false, builtin: true },
  ] };
  saveMain.mockReset().mockImplementation(async main => ({ ...config, main }));
  saveMode.mockReset().mockResolvedValue(config);
  update.mockReset().mockResolvedValue({});
  Object.assign(window, { electronAPI: {
    conversation: { get: async () => config, onChanged: () => () => {}, saveMain, saveMode },
    agentTemplates: { list: async () => [{ id: "mint", name: "Mint", description: "Main", prompt: "Main rules", agentType: "mint" }, { id: "default-builder", name: "Builder", description: "Implementation", prompt: "Builder rules", agentType: "builder" }], update },
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

it("saves nickname, personality and rules as separate main-chat fields", async () => {
  await act(async () => root.render(createElement(MainChatSettings, { onClose: () => {} })));
  expect(host.querySelectorAll('input:not([type="file"])')).toHaveLength(1);
  expect(host.querySelectorAll("textarea")).toHaveLength(2);
  await input(host.querySelector('input:not([type="file"])')!, "Mori");
  await input(host.querySelectorAll("textarea")[0]!, "Concise style");
  await input(host.querySelectorAll("textarea")[1]!, "Updated rules");
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(saveMain).toHaveBeenCalledWith({ nickname: "Mori", avatar: "", personality: "Concise style", rules: "Updated rules" });
  expect(host.textContent).not.toContain("适用范围");
});

it("edits only the execution template prompt and sends no main-chat profile fields", async () => {
  await act(async () => root.render(createElement(AgentTemplateSettings)));
  const builder = [...host.querySelectorAll("div.group")].find(row => row.textContent?.includes("Builder"))!;
  await act(async () => builder.querySelector<HTMLButtonElement>("button")!.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog).not.toBeNull();
  expect(dialog.querySelectorAll("input")).toHaveLength(0);
  expect(dialog.querySelectorAll("textarea")).toHaveLength(1);
  expect(dialog.querySelector(".overflow-y-auto")!.contains(dialog.querySelector('button[type="submit"]'))).toBe(false);
  await input(dialog.querySelector("textarea")!, "New builder instructions");
  await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(update).toHaveBeenCalledWith("default-builder", { prompt: "New builder instructions" });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const main = [...host.querySelectorAll("div.group")].find(row => row.textContent?.includes("Mint"))!;
  await act(async () => main.querySelector<HTMLButtonElement>("button")!.click());
  const mainDialog = document.querySelector('[role="dialog"]')!;
  expect(mainDialog.querySelectorAll("textarea")).toHaveLength(2);
  expect(mainDialog.querySelector(".overflow-y-auto")!.contains(mainDialog.querySelector('button[type="submit"]'))).toBe(false);
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
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
  await input(fields[0]!, "Writing"); await input(fields[1]!, "When writing reports");
  await input(editor.querySelector("textarea")!, "Write short paragraphs");
  await act(async () => editor.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => editor.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(saveMode).toHaveBeenCalledWith({ id: undefined, name: "Writing", scenario: "When writing reports", prompt: "Write short paragraphs", defaultEnabled: true, builtin: false });
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

it("localizes untouched built-in mode labels while keeping user wording", async () => {
  config.modes[0] = { ...config.modes[0]!, name: BUILTIN_MODE_DISPLAY["ui-design"]!.name, scenario: BUILTIN_MODE_DISPLAY["ui-design"]!.scenario };
  config.modes[1] = { ...config.modes[1]!, name: "我的引导", scenario: "我的场景" };
  await uiI18n.changeLanguage("en");
  await act(async () => root.render(createElement(CollaborationModePicker, { modes: config.modes, selected: [], onChange: () => {} })));
  await act(async () => host.querySelector("button")!.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("UI design");
  expect(dialog.textContent).toContain("When designing an interface");
  expect(dialog.textContent).toContain("我的引导");
  expect(dialog.textContent).toContain("我的场景");
});
