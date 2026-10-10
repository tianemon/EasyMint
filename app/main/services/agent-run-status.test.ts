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
    firstUserMessage: "", learnToolInstalled: false, promptDone: undefined as Promise<void> | undefined };
  const service = new AgentService({} as Store);
  (service as unknown as { activeChats: Map<string, object> }).activeChats.set("chat", chat);
  return { service, chat, session, listeners };
}
const stream = () => sent.events.filter(event => event.channel === "agent:stream").map(event => event.data as { type: string; outcome?: string });

describe("host run status ownership", () => {
  it("registers system-triggered runs and publishes completion only after prompt settlement", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { service, chat, listeners } = setup(async emit => {
      emit({ type: "turn_start" } as AgentSessionEvent);
      emit({ type: "agent_settled", aborted: false });
      await gate;
    });
    service.injectSystemMessage("session", "summary", "delegation", { triggerTurn: true });
    expect(service.getBusyState("session").busy).toBe(true);
    expect(stream().map(event => event.type)).toEqual(["turn_start"]);
    expect(sent.events.some(event => event.channel === "agent:exit")).toBe(false);
    const done = chat.promptDone; release(); await done;
    expect(stream().at(-1)).toMatchObject({ type: "turn_end", outcome: "completed" });
    expect(service.getBusyState("session").busy).toBe(false);
    expect(listeners.size).toBe(0);
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
