import { getPromptDefaults } from "./system-prompt-manager";
const THINKING_LANGUAGE_PROMPT = getPromptDefaults().main.rules.match(/<thinking_language>[\s\S]*?<\/thinking_language>/)![0];
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentService } from "./agent-service";
import type { Store } from "./store";
import { broadcast } from "./ipc-broadcast";

import { PERMISSION_RULES_PROMPT } from "./prompt-sections";
import * as piSessions from "./pi-session";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => "/tmp" }, BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("./ipc-broadcast", () => ({ broadcast: vi.fn() }));


function create(session?: object) {
  const service = new AgentService({ getSettings: () => ({ memory: { enabled: false } }) } as unknown as Store);
  const internals = service as unknown as {
    activeChats: Map<string, unknown>;
    buildSystemPrompt(path: string, designer?: boolean, opts?: { worker?: boolean; memoryInstalled?: boolean }): string;
  };
  if (session) internals.activeChats.set("chat-health", { chatId: "chat-health", sessionId: "session-health", session, abortController: new AbortController() });
  return { service, internals };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("final prompt assembly", () => {
  it("routes a background worker as a task even with a custom main-role prompt", async () => {
    const { service } = create();
    const execution = service as unknown as {
      getModel(): Promise<unknown>;
      buildExtraTools(): Promise<unknown>;
      promptAndBridge(): Promise<void>;
    };
    vi.spyOn(execution, "getModel").mockResolvedValue({ id: "fixture" });
    vi.spyOn(execution, "buildExtraTools").mockResolvedValue({ tools: [] });
    vi.spyOn(execution, "promptAndBridge").mockResolvedValue();
    const factory = vi.spyOn(piSessions, "createPiSession").mockResolvedValue({ sessionId: "worker" } as never);
    const dispose = vi.spyOn(piSessions, "disposePiSession").mockResolvedValue();
    await service.runWorker("/tmp/health-project", "AUTHORIZED_TASK", {} as never);
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(factory).toHaveBeenCalledOnce();
    expect(factory.mock.calls[0][0]).toMatchObject({ deliveryMode: "task", systemPrompt: expect.stringContaining("EasyMint") });
  });
  it("keeps the runtime base separate from editable role and thinking language preferences", () => {
    const { internals } = create();
    const prompt = internals.buildSystemPrompt("/tmp/health-project", true);
    expect(prompt).not.toContain("项目经理 + 架构师");
    expect(prompt).toContain("/tmp/health-project");
    expect(prompt.split(PERMISSION_RULES_PROMPT)).toHaveLength(2);
    expect(prompt).not.toContain(THINKING_LANGUAGE_PROMPT);
  });
});

describe("bounded stale SDK recovery", () => {
  it("steer returns a recoverable error instead of hanging or queuing into stale busy state", async () => {
    vi.useFakeTimers();
    const never = new Promise<void>(() => {});
    const steer = vi.fn();
    const { service } = create({ isStreaming: true, abort: () => never, waitForIdle: () => never, steer });
    const result = service.steer("session-health", "new message").catch(error => error);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await result).toMatchObject({ message: expect.stringContaining("会话尚未停止") });
    expect(steer).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("compact recovery failure releases its subscription and closes the UI waiting state", async () => {
    vi.useFakeTimers();
    const never = new Promise<void>(() => {});
    const unsub = vi.fn(); const compact = vi.fn();
    const { service } = create({ isStreaming: true, abort: () => never, waitForIdle: () => never, compact, subscribe: () => unsub });
    const result = service.compact("session-health");
    await vi.advanceTimersByTimeAsync(8000); await result;
    expect(unsub).toHaveBeenCalledOnce(); expect(compact).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith("agent:context-summarizing", expect.objectContaining({ type: "done" }));
    expect(broadcast).toHaveBeenCalledWith("agent:stream", expect.objectContaining({ type: "error", canRetry: true }));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("successful compaction does not leave its 120-second timer behind", async () => {
    vi.useFakeTimers();
    const unsub = vi.fn();
    const { service } = create({ isStreaming: false, compact: async () => {}, subscribe: () => unsub });
    await service.compact("session-health");
    expect(unsub).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not overlap manual compactions or let one call clear another's waiting state", async () => {
    vi.useFakeTimers();
    const compact = vi.fn(() => new Promise<void>(() => {}));
    const abortCompaction = vi.fn();
    const { service } = create({ isStreaming: false, compact, abortCompaction, subscribe: () => vi.fn() });
    const first = service.compact("session-health");
    await expect(service.compact("session-health")).rejects.toThrow("会话正在处理另一项操作");
    expect(compact).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(120000); await first;
    expect(abortCompaction).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
