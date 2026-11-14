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
  expect(host.querySelectorAll("input")).toHaveLength(0);
  expect(host.querySelectorAll("textarea")).toHaveLength(1);
  await input(host.querySelector("textarea")!, "New builder instructions");
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(update).toHaveBeenCalledWith("default-builder", { prompt: "New builder instructions" });
});

it("creates a custom mode without configuring an icon and supports stacked selections", async () => {
  await act(async () => root.render(createElement(CollaborationSettings)));
  await clickText("新增模式");
  const fields = host.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])');
  await input(fields[0]!, "Writing"); await input(fields[1]!, "When writing reports");
  await input(host.querySelector("textarea")!, "Write short paragraphs");
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(saveMode).toHaveBeenCalledWith({ id: undefined, name: "Writing", scenario: "When writing reports", prompt: "Write short paragraphs", defaultEnabled: true, builtin: false });
  const change = vi.fn();
  await act(async () => root.render(createElement(CollaborationModePicker, { modes: config.modes, selected: ["ui-design"], onChange: change })));
  await act(async () => host.querySelector("button")!.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.querySelectorAll("svg")).toHaveLength(0);
  expect(dialog.textContent).toContain("进入陌生领域时");
  await act(async () => dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!.click());
  expect(change).toHaveBeenCalledWith(["ui-design", "domain-guidance"]);
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
