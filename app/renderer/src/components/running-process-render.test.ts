// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RunningAssistantContent } from "./RunningAssistantContent";
import { buildRunningProcessSlices } from "./chat-running-process";
import { buildTurnPresentations } from "./chat-turn-presentation";
import { useProcessDisclosure } from "./chat-process-disclosure";
import type { ChatMessage } from "./chat-utils";
import type { StreamEntry } from "./StreamPanel";

vi.mock("../lib/diff-highlight", () => ({ inferLang: () => "TEXT", tokenizeLines: () => [] }));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  useProcessDisclosure.setState({ expanded: {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(entries: StreamEntry[]): Promise<void> {
  const messages: ChatMessage[] = [{ id: 1, role: "ai", timestamp: 0, streaming: true, entries }];
  const slices = buildRunningProcessSlices(messages, buildTurnPresentations(messages, true)).get(0)!;
  await act(async () => root.render(createElement(RunningAssistantContent, { slices, sessionId: "s", messageId: "1", toolInputs: new Map(), streaming: true })));
}

it("renders each conclusion between separate process controls and retains expansion during streaming", async () => {
  const entries: StreamEntry[] = [
    { kind: "thinking", text: "first reasoning", timestamp: 0 },
    { kind: "text", text: "First conclusion", timestamp: 1 },
    { kind: "thinking", text: "second reasoning", timestamp: 2 },
    { kind: "text", text: "Second conclusion", timestamp: 3 },
  ];
  await render(entries);
  const controls = () => [...container.querySelectorAll<HTMLButtonElement>(".execution-process-toggle")];
  expect(controls()).toHaveLength(2);
  expect(controls().every(control => control.getAttribute("aria-expanded") === "false")).toBe(true);
  expect(container.textContent).toMatch(/思考过程.*First conclusion.*思考过程.*Second conclusion/s);
  expect(container.textContent).not.toContain("reasoning");
  await act(async () => controls()[0]!.click());
  expect(controls()[0]!.getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector<HTMLDivElement>(".execution-process-viewport")?.hidden).toBe(false);
  expect(container.textContent).toContain("first reasoning");
  expect(container.querySelector(".execution-process-record")).toBeNull();
  expect(container.querySelector(".execution-process-toggle svg path")?.getAttribute("d")).toBe("M12 18V5");
  await render([...entries.slice(0, -1), { ...entries.at(-1)!, text: "Second conclusion grows" } as StreamEntry]);
  expect(controls()[0]!.getAttribute("aria-expanded")).toBe("true");
  expect(controls()[1]!.getAttribute("aria-expanded")).toBe("false");
  expect(container.textContent).toContain("Second conclusion grows");
});

it("summarizes thoughts and tools between prose, without putting another thinking toggle inside its details", async () => {
  const thought: StreamEntry = {kind:"thinking",text:"mixed reasoning",timestamp:0};
  const call: StreamEntry = {kind:"tool_use",id:"read",name:"read",input:{path:"/project/file.ts"},timestamp:1,collapsed:true};
  const result: StreamEntry = {kind:"tool_result",toolUseId:"read",content:"file",isError:false,timestamp:2};
  await render([thought]);
  await act(async()=>container.querySelector<HTMLButtonElement>(".execution-process-toggle")!.click());
  expect(container.textContent).toContain("mixed reasoning");
  // New tool activity grows the same segment; an opened thought remains readable.
  await render([thought,call,result]);
  expect(container.querySelector(".execution-process-toggle")?.textContent).toContain("思考过程、读取文件");
  expect(container.querySelectorAll(".execution-process-toggle")).toHaveLength(1);
  expect(container.querySelectorAll(".execution-process-record")).toHaveLength(2);
  expect(container.querySelector<HTMLDetailsElement>(".execution-process-record")?.open).toBe(true);
  expect(container.textContent).toContain("mixed reasoning");
  expect(container.querySelector(".execution-process-detail button")).toBeNull();
});
