import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postToAgent } from "./agent-stream";

let stream!: (event: StreamEvent) => void;
let exit!: (event: { runId: string; code?: number }) => void;
let started!: (value: { chatId: string; sessionId: string }) => void;
let offStream: ReturnType<typeof vi.fn>, offExit: ReturnType<typeof vi.fn>;
beforeEach(() => {
  offStream = vi.fn(); offExit = vi.fn();
  vi.stubGlobal("window", { electronAPI: { agent: {
    onStream: (callback: typeof stream) => { stream = callback; return offStream; },
    onExit: (callback: typeof exit) => { exit = callback; return offExit; },
    sendMessage: () => new Promise(resolve => { started = resolve; }),
  } } });
});
afterEach(() => vi.unstubAllGlobals());
const message = (chatId: string, texts: string[]): StreamEvent => ({ seq: 1, type: "message", runId: chatId, chatId, blocks: texts.map(text => ({ type: "text", text })) });

describe("form agent response isolation", () => {
  it("ignores another chat's early exit and retains this chat's early reply", async () => {
    let settled = false;
    const work = postToAgent({ cwd: "/fixture", sessionId: null }, "question").finally(() => { settled = true; });
    stream(message("other", ["wrong reply"])); exit({ runId: "other", code: 0 });
    await Promise.resolve();
    const premature = settled;
    stream(message("own", ["first ", "second"])); exit({ runId: "own", code: 0 });
    started({ chatId: "own", sessionId: "own-session" });
    const result = await work;
    expect(premature).toBe(false);
    expect(result.chatId).toBe("own");
    expect(await result.replyText).toBe("first second");
    expect(offStream).toHaveBeenCalledTimes(1); expect(offExit).toHaveBeenCalledTimes(1);
  });
  it("rejects a failed model turn even when the SDK prompt resolves with exit code zero", async () => {
    const work = postToAgent({ cwd: "/fixture", sessionId: "own-session" }, "question").catch(error => error);
    started({ chatId: "own", sessionId: "own-session" }); await Promise.resolve();
    stream({ seq: 2, type: "error", runId: "own", chatId: "own", message: "fixture failure" });
    stream({ seq: 3, type: "turn_end", runId: "own", chatId: "own", outcome: "failed" });
    exit({ runId: "own", code: 0 });
    expect((await work).message).toContain("fixture failure");
    expect(offStream).toHaveBeenCalledTimes(1); expect(offExit).toHaveBeenCalledTimes(1);
  });
});
