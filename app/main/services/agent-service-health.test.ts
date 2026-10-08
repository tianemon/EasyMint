import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentService } from "./agent-service";
import type { Store } from "./store";
import { broadcast } from "./ipc-broadcast";
import { buildExperienceInjection } from "./experience-service";
import { THINKING_LANGUAGE_PROMPT } from "../../shared/prompts";
import { PERMISSION_RULES_PROMPT } from "./prompt-sections";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => "/tmp" }, BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("./ipc-broadcast", () => ({ broadcast: vi.fn() }));
vi.mock("./system-prompt-manager", () => ({ resolveEffectivePrompt: () => "CUSTOM_PROMPT" }));
vi.mock("./experience-service", async importOriginal => ({ ...await importOriginal<object>(), buildExperienceInjection: vi.fn(() => "EXPERIENCE_MARKER") }));

function create(session?: object) {
  const service = new AgentService({ getSettings: () => ({ learnEnabled: true }) } as unknown as Store);
  const internals = service as unknown as {
    activeChats: Map<string, unknown>;
    buildSystemPrompt(path: string, designer?: boolean, opts?: { worker?: boolean; learnInstalled?: boolean }): string;
  };
  if (session) internals.activeChats.set("chat-health", { chatId: "chat-health", sessionId: "session-health", session, abortController: new AbortController() });
  return { service, internals };
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("final prompt assembly", () => {
  it("keeps custom content, environment and permission rules exactly once, with language rules last", () => {
    const { internals } = create();
    const prompt = internals.buildSystemPrompt("/tmp/health-project", true);
    expect(prompt.startsWith("CUSTOM_PROMPT")).toBe(true);
    expect(prompt).toContain("/tmp/health-project");
    expect(prompt.split(PERMISSION_RULES_PROMPT)).toHaveLength(2);
    expect(prompt.endsWith(THINKING_LANGUAGE_PROMPT)).toBe(true);
  });
  it("does not inject experiences when the tools were not installed even if settings enable them", () => {
    const { internals } = create();
    expect(internals.buildSystemPrompt("/tmp", false, { learnInstalled: false })).not.toContain("EXPERIENCE_MARKER");
    expect(buildExperienceInjection).not.toHaveBeenCalled();
    expect(internals.buildSystemPrompt("/tmp", false, { learnInstalled: true })).toContain("EXPERIENCE_MARKER");
    expect(internals.buildSystemPrompt("/tmp", false, { worker: true, learnInstalled: true })).not.toContain("EXPERIENCE_MARKER");
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
