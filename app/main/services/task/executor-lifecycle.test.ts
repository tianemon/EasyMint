import { afterEach, describe, expect, it, vi } from "vitest";
import { runSubagents } from "./executor";
import { createDelegation, resetRegistry } from "./registry";
import type { Store } from "../store";

const mocks = vi.hoisted(() => ({ create: vi.fn(), dispose: vi.fn(async () => {}) }));
vi.mock("../pi-session", () => ({ createPiSession: mocks.create, disposePiSession: mocks.dispose, getPiSessionDir: () => "/fixture/sessions" }));
vi.mock("../pi-init", () => ({ getActiveModel: async () => ({ id: "fixture", provider: "fixture", reasoning: false }), getModelRuntime: async () => ({ getModel: () => null }) }));
vi.mock("../tool-registry", () => ({ getReadOnlyTools: async () => [], getBaseTools: async () => [] }));
vi.mock("../enhanced-edit", () => ({ createEnhancedEditTool: async () => ({ name: "edit" }) }));
vi.mock("../ipc-broadcast", () => ({ broadcast: vi.fn() }));
afterEach(() => { resetRegistry(); vi.clearAllMocks(); vi.restoreAllMocks(); });

describe("subagent lifecycle integration", () => {
  it("never prompts a child cancelled during session preparation", async () => {
    let prepared!: (session: object) => void;
    mocks.create.mockImplementationOnce(() => new Promise(resolve => { prepared = resolve; }));
    const record = createDelegation("parent", [{ task: "fixture", readOnly: true }]);
    const prompt = vi.fn(async () => {});
    const session = { sessionId: "child", model: { id: "fixture" }, subscribe: () => () => {}, abort: vi.fn(async () => {}), prompt };
    const work = runSubagents(record, { cwd: "/fixture", agentDir: "/fixture/agent", store: {} as Store });
    await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    record.taskAbortControllers[0]!.abort();
    prepared(session); await work;
    expect(prompt).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    expect((await record.completion).results[0]?.aborted).toBe(true);
  });
  it("propagates a sibling preparation failure and waits for disposal before finishing the batch", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let fail!: () => void, releasePrompt!: () => void, releaseCleanup!: () => void;
    const first = new Promise((_, reject) => { fail = () => reject(new Error("preparation failed")); });
    const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve; });
    const session = { sessionId: "child", model: { id: "fixture" }, subscribe: () => () => {},
      prompt: vi.fn(() => new Promise<void>(resolve => { releasePrompt = resolve; })),
      abort: vi.fn(async () => { releasePrompt(); }),
    };
    mocks.create.mockImplementation(options => options.systemPrompt.startsWith("first") ? first : Promise.resolve(session));
    mocks.dispose.mockImplementationOnce(async () => { await cleanup; });
    const record = createDelegation("parent", [{ task: "first", outputSchema: {}, readOnly: true }, { task: "second", outputSchema: {}, readOnly: true }]);
    let settled = false;
    const work = runSubagents(record, { cwd: "/fixture", agentDir: "/fixture/agent", store: {} as Store }).finally(() => { settled = true; });
    await vi.waitFor(() => expect(session.prompt).toHaveBeenCalledTimes(1));
    fail();
    await vi.waitFor(() => expect(session.abort).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false); expect(record.status).toBe("running");
    releaseCleanup(); await work;
    expect(record.status).toBe("failed");
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });
});
