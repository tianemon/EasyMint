import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "./pi-sdk";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { AgentService } from "./agent-service";
import type { Store } from "./store";

const sent = vi.hoisted(() => ({ events: [] as Array<{ channel: string; data: unknown }>, dispose: vi.fn(async () => {}) }));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => "/tmp" }, BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("./ipc-broadcast", () => ({
  broadcast: (channel: string, data: unknown) => { sent.events.push({ channel, data }); },
  broadcastEvent: (channel: string, data: unknown) => { sent.events.push({ channel, data }); return { sequence: sent.events.length }; },
}));
vi.mock("./pi-session", async importOriginal => ({ ...await importOriginal<typeof import("./pi-session")>(), disposePiSession: sent.dispose }));
afterEach(() => { sent.events.length = 0; sent.dispose.mockClear(); vi.restoreAllMocks(); vi.useRealTimers(); });

function setup(run: (emit: (event: AgentSessionEvent) => void) => Promise<void>) {
  const listeners = new Set<(event: AgentSessionEvent) => void>();
  const emit = (event: AgentSessionEvent) => { for (const listener of listeners) listener(event); };
  const session = {
    sessionManager: SessionManager.inMemory("/tmp"), messages: [{ role: "assistant", stopReason: "stop" }],
    isIdle: true, isStreaming: false, isCompacting: false,
    abort: vi.fn(async () => {}), clearQueue: () => ({ steering: [], followUp: [] }),
    subscribe: (listener: (event: AgentSessionEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    sendCustomMessage: vi.fn(() => run(emit)), getContextUsage: () => undefined, getLastAssistantText: () => "",
  };
  const chat = { chatId: "chat", sessionId: "session", session, abortController: new AbortController(),
    firstUserMessage: "", promptDone: undefined as Promise<void> | undefined };
  const service = new AgentService({} as Store);
  (service as unknown as { activeChats: Map<string, object> }).activeChats.set("chat", chat);
  return { service, chat, session, listeners };
}
const stream = () => sent.events.filter(event => event.channel === "agent:stream").map(event => event.data as { type: string; outcome?: string });

describe("host run status ownership", () => {
  it("registers system-triggered runs and publishes completion only after prompt settlement", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { service, chat, session, listeners } = setup(async emit => {
      emit({ type: "turn_start" } as AgentSessionEvent);
      emit({ type: "agent_settled", aborted: false });
      await gate;
    });
    service.injectSystemMessage("session", "summary", "delegation", { triggerTurn: true });
    expect(session.sendCustomMessage).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ startsExecution: true }) }), { triggerTurn: true });
    expect(service.getBusyState("session").busy).toBe(true);
    expect(stream().map(event => event.type)).toEqual(["turn_start"]);
    expect(sent.events.some(event => event.channel === "agent:exit")).toBe(false);
    const done = chat.promptDone; release(); await done;
    expect(stream().at(-1)).toMatchObject({ type: "turn_end", outcome: "completed" });
    expect(service.getBusyState("session").busy).toBe(false);
    expect(listeners.size).toBe(0);
  });
  it("does not start a learning continuation after a long completed run, including recovered legacy flags", async () => {
    vi.useFakeTimers();
    const { service, chat, session, listeners } = setup(async emit => {
      emit({ type: "agent_start" } as AgentSessionEvent);
      emit({ type: "turn_start" } as AgentSessionEvent);
      for (let i = 0; i < 16; i++) {
        emit({ type: "tool_execution_start", toolCallId: `tool-${i}`, toolName: "bash", args: {} });
        emit({ type: "tool_execution_end", toolCallId: `tool-${i}`, toolName: "bash", result: { content: [{ type: "text", text: i === 0 ? "failed" : "ok" }] }, isError: i === 0 });
      }
      emit({ type: "agent_settled", aborted: false });
    });
    // Old in-memory metadata must not revive the removed automatic follow-up.
    Object.assign(chat, { learnToolInstalled: true, learnSuggestDone: false });
    const inject = vi.spyOn(service, "injectSystemMessage");
    service.injectSystemMessage("session", "requested work", "delegation", { triggerTurn: true });
    await chat.promptDone;
    await vi.runAllTimersAsync();
    expect(session.sendCustomMessage).toHaveBeenCalledTimes(1);
    expect(inject).toHaveBeenCalledTimes(1);
    expect(stream().filter(event => event.type === "turn_end")).toEqual([expect.objectContaining({ outcome: "completed" })]);
    expect(service.getBusyState("session").busy).toBe(false);
    expect(listeners.size).toBe(0);
  });
  it("marks ordinary notifications as part of the current execution", async () => {
    const { service, session } = setup(async () => {});
    service.injectSystemMessage("session", "progress", "delegation");
    expect(session.sendCustomMessage).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ startsExecution: false }) }), undefined);
    await Promise.resolve();
  });
  it.each([false, true])("reports failed/cancelled startup accurately (abort=$0)", async aborted => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let fail!: () => void;
    const { service, chat } = setup(() => new Promise((_, reject) => { fail = () => reject(new Error("network unavailable")); }));
    service.injectSystemMessage("session", "summary", "delegation", { triggerTurn: true });
    if (aborted) chat.abortController.abort();
    const done = chat.promptDone; fail(); await done;
    expect(stream().at(-1)).toMatchObject({ type: "turn_end", outcome: aborted ? "cancelled" : "failed" });
    expect(service.peekBufferedStream("session").at(-1)).toMatchObject({ type: "turn_end" });
    expect(service.getBusyState("session").busy).toBe(false);
  });
  it("releases an intercepted prompt without claiming model success", async () => {
    const { service, chat } = setup(async () => {});
    service.injectSystemMessage("session", "summary", "delegation", { triggerTurn: true });
    await chat.promptDone;
    expect(stream().some(event => event.type === "turn_end")).toBe(false);
    expect(sent.events.at(-1)).toMatchObject({ channel: "agent:exit" });
    expect(service.getBusyState("session").busy).toBe(false);
  });
  it("defers a system continuation until the prior bridge releases its registration", async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    let runs = 0;
    const { service, chat, session, listeners } = setup(async emit => {
      emit({ type: "turn_start" } as AgentSessionEvent);
      await new Promise<void>(resolve => { if (++runs === 1) releaseFirst = resolve; else releaseSecond = resolve; });
      emit({ type: "agent_settled", aborted: false });
    });
    service.injectSystemMessage("session", "first", "delegation", { triggerTurn: true });
    const firstDone = chat.promptDone;
    service.injectSystemMessage("session", "second", "delegation", { triggerTurn: true });
    expect(session.sendCustomMessage).toHaveBeenCalledTimes(1);
    releaseFirst(); await firstDone;
    await vi.waitFor(() => expect(session.sendCustomMessage).toHaveBeenCalledTimes(2));
    expect(service.getBusyState("session").busy).toBe(true);
    expect(listeners.size).toBe(1);
    const secondDone = chat.promptDone; releaseSecond(); await secondDone;
    expect(stream().filter(event => event.type === "turn_end")).toHaveLength(2);
    expect(service.getBusyState("session").busy).toBe(false);
  });
  it("distinguishes a running prompt from an idle manual compaction in recovery snapshots", () => {
    const { service, session } = setup(async () => {});
    session.isCompacting = true;
    expect(service.getBusyState("session")).toMatchObject({ busy: true, running: false, compacting: true, chatId: "chat", pendingAsks: [] });
  });
  it("does not confirm closing before a prompt finishes, and shares concurrent close calls", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { service, chat } = setup(async emit => { await gate; emit({ type: "agent_settled", aborted: true }); });
    service.injectSystemMessage("session", "pending", "delegation", { triggerTurn: true });
    let closed = false;
    const first = service.killChat("chat").then(() => { closed = true; });
    const second = service.killChat("chat");
    await new Promise(resolve => setTimeout(resolve, 0));
    const premature = closed;
    const disposedEarly = sent.dispose.mock.calls.length;
    release(); await chat.promptDone; await Promise.all([first, second]);
    expect(premature).toBe(false); expect(disposedEarly).toBe(0);
    expect(sent.dispose).toHaveBeenCalledTimes(1);
    expect(sent.events.filter(event => event.channel === "agent:chat-closed")).toHaveLength(1);
  });
  it("retains a session when closing cannot confirm settlement within its budget", async () => {
    vi.useFakeTimers(); vi.spyOn(console, "warn").mockImplementation(() => {});
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { service, chat } = setup(async () => { await gate; });
    service.injectSystemMessage("session", "pending", "delegation", { triggerTurn: true });
    const result = service.killChat("chat").catch(error => error);
    await vi.advanceTimersByTimeAsync(8000);
    expect((await result).message).toContain("已保留会话");
    expect(service.findActiveChat("session")).toBe(chat);
    expect(sent.dispose).not.toHaveBeenCalled();
    release(); await chat.promptDone;
    await service.killChat("chat");
    expect(sent.dispose).toHaveBeenCalledTimes(1);
  });
});
