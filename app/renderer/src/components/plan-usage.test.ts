// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as confirmation from "./ui/ConfirmDialog";
import { PlanUsageButton } from "./PlanUsageButton";
import { useSettingsStore } from "../stores/settings-store";
import type { ApiProvidersData } from "@shared/platform-presets";

let container: HTMLDivElement;
let root: Root;
const codexQuota = vi.fn();
const fetchBalance = vi.fn();
const providers: ApiProvidersData = { current: "codex", configs: {
  codex: { id: "codex", name: "Codex", presetId: "openai-codex", authType: "oauth", apiKey: "", model: "gpt", models: ["gpt"], createdAt: 0 },
  deepseek: { id:"deepseek",name:"DeepSeek",presetId:"deepseek",apiKey:"",model:"deepseek-chat",models:["deepseek-chat"],createdAt:0 },
  api: { id: "api", name: "API", presetId: "openai", apiKey: "", model: "gpt", models: ["gpt"], createdAt: 0 },
} };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.assign(window, { electronAPI: { provider: { codexQuota }, settings:{fetchBalance} } });
  codexQuota.mockReset();
  fetchBalance.mockReset();
  useSettingsStore.setState({ apiProviders: providers });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("loads subscription windows from its own entry without a session and dismisses on provider switch", async () => {
  codexQuota.mockResolvedValue({ ok: true, quota: { plan: "plus", primary: { usedPercent: 25, windowSeconds: 18000, reached: false }, secondary: { usedPercent: 60, windowSeconds: 604800, reached: false }, credits: { available: 0, items: [] }, fetchedAt: 0 } });
  await act(async () => root.render(createElement(PlanUsageButton)));
  expect(codexQuota).not.toHaveBeenCalled();
  await act(async () => container.querySelector("button")!.click());
  // 标题带套餐等级（去括号，档位单独一段）；界面按剩余展示：已用 25% / 60% → 剩余 75% / 40%
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Codex 套餐");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Plus");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("75%");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("40%");
  expect(codexQuota).toHaveBeenCalledTimes(1);
  const popup = document.querySelector('[role="dialog"]')!;
  expect(popup.parentElement).toBe(container.firstElementChild);
  expect(popup.hasAttribute("aria-modal")).toBe(false);
  expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
  await act(async () => useSettingsStore.setState({ apiProviders: { ...providers, current: "api" } }));
  expect(container.textContent).toBe("");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => useSettingsStore.setState({ apiProviders: providers }));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("shows a loading state, then allows retry after an unavailable quota response", async () => {
  let resolveQuota!: (value: unknown) => void;
  codexQuota.mockImplementationOnce(() => new Promise(resolve => { resolveQuota = resolve; }));
  await act(async () => root.render(createElement(PlanUsageButton)));
  await act(async () => container.querySelector("button")!.click());
  const rows = [...document.querySelectorAll('[data-quota-window]')];
  expect(rows).toHaveLength(2);
  expect(rows[0]?.textContent).toContain("5 小时额度");
  expect(rows[1]?.textContent).toContain("每周额度");
  expect(rows.every(row => row.textContent?.includes("剩余 —"))).toBe(true);
  // 每组是「额度名 → 剩余值 → 重置时间」的顺序（时间在数值下方）
  const rowText = rows[0]?.textContent ?? "";
  expect(rowText.indexOf("5 小时额度")).toBeLessThan(rowText.indexOf("剩余"));
  expect(rowText.indexOf("剩余")).toBeLessThan(rowText.indexOf("重置"));
  expect(document.querySelector('[data-quota-section]')?.getAttribute("aria-busy")).toBe("true");
  await act(async () => resolveQuota({ ok: false, reason: "network" }));
  const retry = document.querySelector<HTMLButtonElement>('[role="status"] button');
  expect(retry).not.toBeNull();
  codexQuota.mockResolvedValueOnce({ ok: true, quota: { credits: { available: 0, items: [] }, fetchedAt: 0 } });
  await act(async () => retry!.click());
  expect(codexQuota).toHaveBeenLastCalledWith(true);
  expect([...document.querySelectorAll('[data-quota-window]')]).toEqual(rows);
  // 成功后错误条整条移除：不再用固定高度空行撑出弹窗底部的空白
  expect(document.querySelector('[role="status"]')).toBeNull();
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(container.querySelector("button"));
  await act(async () => container.querySelector("button")!.click());
  await act(async () => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

const quotaResponse = (usedPercent: number) => ({ ok: true, quota: { primary: {usedPercent,windowSeconds:18000,reached:false},secondary:{usedPercent:61,windowSeconds:604800,reached:false},credits:{available:0,items:[]},fetchedAt:0} });

it("updates only values on refresh, keeps the last usage on failure, and stops polling when closed", async () => {
  vi.useFakeTimers();
  Object.defineProperty(document,"visibilityState",{configurable:true,value:"visible"});
  codexQuota.mockResolvedValue(quotaResponse(88));
  await act(async()=>root.render(createElement(PlanUsageButton)));
  await act(async()=>container.querySelector("button")!.click());
  const rows=[...document.querySelectorAll('[data-quota-window]')];
  expect(rows[0]?.textContent).toContain("剩余 12%");
  expect(rows[0]?.textContent).not.toContain("39%");
  codexQuota.mockResolvedValueOnce(quotaResponse(90));
  await act(async()=>{vi.advanceTimersByTime(60_000);});
  expect(rows[0]?.textContent).toContain("剩余 10%");
  expect([...document.querySelectorAll('[data-quota-window]')]).toEqual(rows);
  codexQuota.mockResolvedValueOnce({ok:false,reason:"network"});
  await act(async()=>{vi.advanceTimersByTime(60_000);});
  expect(rows[0]?.textContent).toContain("剩余 10%");
  expect(document.querySelector('[role="status"]')?.textContent).toContain("上次用量");
  await act(async()=>container.querySelector("button")!.click());
  const count=codexQuota.mock.calls.length;
  await act(async()=>{vi.advanceTimersByTime(120_000);});
  expect(codexQuota).toHaveBeenCalledTimes(count);
});

it("does not overlap periodic requests or let a closed popup overwrite a newer one", async () => {
  vi.useFakeTimers();
  let resolveOld!: (value: unknown)=>void;
  codexQuota.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));
  await act(async()=>root.render(createElement(PlanUsageButton)));
  await act(async()=>container.querySelector("button")!.click());
  await act(async()=>{vi.advanceTimersByTime(120_000);});
  expect(codexQuota).toHaveBeenCalledTimes(1);
  await act(async()=>container.querySelector("button")!.click());
  codexQuota.mockResolvedValueOnce(quotaResponse(42));
  await act(async()=>container.querySelector("button")!.click());
  expect(document.querySelector('[data-quota-window="primary"]')?.textContent).toContain("剩余 58%");
  await act(async()=>resolveOld(quotaResponse(99)));
  expect(document.querySelector('[data-quota-window="primary"]')?.textContent).toContain("剩余 58%");
});

it("reloads fresh usage after reset even if an earlier poll is still running",async()=>{
  const initial=quotaResponse(90);initial.quota.credits.available=1;
  const consumed=vi.fn().mockResolvedValue({code:"reset",windowsReset:2});
  Object.assign(window.electronAPI.provider,{codexConsumeReset:consumed});
  codexQuota.mockResolvedValueOnce(initial);
  let confirm!: (value:boolean)=>void;
  vi.spyOn(confirmation,"confirmDialog").mockImplementationOnce(()=>new Promise(resolve=>{confirm=resolve;}));
  await act(async()=>root.render(createElement(PlanUsageButton)));
  await act(async()=>container.querySelector("button")!.click());
  const reset=[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button=>button.textContent==="使用一次重置")!;
  await act(async()=>reset.click());
  let finishPoll!: (value:unknown)=>void;
  codexQuota.mockImplementationOnce(()=>new Promise(resolve=>{finishPoll=resolve;}));
  await act(async()=>window.dispatchEvent(new Event("focus")));
  await act(async()=>confirm(true));
  expect(consumed).toHaveBeenCalledTimes(1);
  expect(codexQuota).toHaveBeenCalledTimes(2);
  codexQuota.mockResolvedValueOnce(quotaResponse(0));
  await act(async()=>finishPoll(initial));
  expect(codexQuota).toHaveBeenCalledTimes(3);
  expect(document.querySelector('[data-quota-window="primary"]')?.textContent).toContain("剩余 100%");
});

it("uses the same account entry for DeepSeek balances and keeps all reported currencies",async()=>{
  useSettingsStore.setState({apiProviders:{...providers,current:"deepseek"}});
  fetchBalance.mockResolvedValue({balance_infos:[{currency:"CNY",total_balance:"0.00"},{currency:"USD",total_balance:"12.34"}]});
  await act(async()=>root.render(createElement(PlanUsageButton)));
  expect(container.querySelector("button")?.textContent).toBe("账户余额");
  expect(fetchBalance).not.toHaveBeenCalled();
  await act(async()=>container.querySelector("button")!.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("DeepSeek 账户余额");
  expect(document.querySelector('[data-account-balance]')?.textContent).toContain("CNY 0.00");
  expect(document.querySelector('[data-account-balance]')?.textContent).toContain("USD 12.34");
  expect(codexQuota).not.toHaveBeenCalled();
  await act(async()=>useSettingsStore.setState({apiProviders:providers}));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(codexQuota).not.toHaveBeenCalled();
  expect(container.querySelector("button")?.textContent).toBe("套餐用量");
});
it("does not let a delayed previous-account balance leak into the Codex popup",async()=>{
  let resolveOld!:(value:unknown)=>void;
  useSettingsStore.setState({apiProviders:{...providers,current:"deepseek"}});
  fetchBalance.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));
  await act(async()=>root.render(createElement(PlanUsageButton)));
  await act(async()=>container.querySelector("button")!.click());
  await act(async()=>useSettingsStore.setState({apiProviders:providers}));
  codexQuota.mockResolvedValue(quotaResponse(25));
  await act(async()=>container.querySelector("button")!.click());
  await act(async()=>resolveOld({balance_infos:[{currency:"CNY",total_balance:"999.00"}]}));
  expect(document.querySelector('[data-account-balance]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("999.00");
  expect(document.querySelector('[data-quota-section]')).not.toBeNull();
});
it("keeps the balance row visible on unavailable data and supports retry",async()=>{
  useSettingsStore.setState({apiProviders:{...providers,current:"deepseek"}});
  fetchBalance.mockResolvedValueOnce(null);
  await act(async()=>root.render(createElement(PlanUsageButton)));
  await act(async()=>container.querySelector("button")!.click());
  expect(document.querySelector('[data-account-balance]')?.textContent).toContain("账户余额");
  expect(document.querySelector('[role="status"]')?.textContent).toContain("无法刷新余额");
  fetchBalance.mockResolvedValueOnce({balance_infos:[{currency:"CNY",total_balance:"110.00"}]});
  await act(async()=>document.querySelector<HTMLButtonElement>('[role="status"] button')!.click());
  expect(document.querySelector('[data-account-balance]')?.textContent).toContain("CNY 110.00");
  expect(document.querySelector('[role="status"]')).toBeNull();
});

it("coalesces DeepSeek refreshes and clears its timer when the account popup closes",async()=>{
  vi.useFakeTimers();
  Object.defineProperty(document,"visibilityState",{configurable:true,value:"visible"});
  useSettingsStore.setState({apiProviders:{...providers,current:"deepseek"}});
  let finish!:(value:unknown)=>void;
  fetchBalance.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  await act(async()=>root.render(createElement(PlanUsageButton)));
  await act(async()=>container.querySelector("button")!.click());
  await act(async()=>{vi.advanceTimersByTime(120_000);});
  expect(fetchBalance).toHaveBeenCalledTimes(1);
  await act(async()=>container.querySelector("button")!.click());
  await act(async()=>{vi.advanceTimersByTime(120_000);finish({balance_infos:[{currency:"CNY",total_balance:"42.00"}]});});
  expect(fetchBalance).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-account-balance]')).toBeNull();
});
