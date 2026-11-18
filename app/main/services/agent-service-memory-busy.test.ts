import fs from "node:fs";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { AgentService } from "./agent-service";
import { createDelegation, finishDelegation, resetRegistry } from "./task/registry";
import { runSubagents } from "./task/executor";
import type { Store } from "./store";

const fixture = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs"), os = process.getBuiltinModule("node:os"), path = process.getBuiltinModule("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-memory-busy-"));
  vi.stubEnv("EASYMINT_HOME", root);
  return { root, create: vi.fn(), dispose: vi.fn(async () => {}) };
});
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => "/tmp" }, BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("./ipc-broadcast", () => ({ broadcast: vi.fn(), broadcastEvent: vi.fn() }));
vi.mock("./pi-session", () => ({ createPiSession: fixture.create, disposePiSession: fixture.dispose, getPiSessionDir: () => fixture.root, resumePiSession: vi.fn(), listPiSessions: vi.fn() }));
vi.mock("./pi-init", () => ({ getActiveModel: async () => ({ id: "fixture", provider: "fixture", reasoning: false }), getModelRuntime: async () => ({ getModel: () => null }) }));
vi.mock("./tool-registry", () => ({ getReadOnlyTools: async () => [], getBaseTools: async () => [] }));
vi.mock("./enhanced-edit", () => ({ createEnhancedEditTool: async () => ({ name: "edit" }) }));

afterEach(() => { resetRegistry(); vi.clearAllMocks(); });
afterAll(() => { vi.unstubAllEnvs(); fs.rmSync(fixture.root, { recursive: true, force: true }); });
function setup() {
  const service = new AgentService({ getSettings: () => ({ memory: { enabled: false, background: false } }) } as unknown as Store);
  return { service, internal: service as any, busy: () => (service.memory as any).deps.busy() as boolean };
}

it.each(["completed", "aborted", "failed"] as const)("blocks memory while a detached delegation is running, then releases on %s", async status => {
  const { service, busy } = setup();
  const record = createDelegation("detached-parent", [{ task: "MOCK_TASK" }]);
  try {
    expect(busy()).toBe(true);
    // Aborting the controller is not completion: the child may still be unwinding.
    record.abort();
    expect(busy()).toBe(true);
    finishDelegation(record, status);
    expect(busy()).toBe(false);
  } finally { finishDelegation(record, "aborted"); await service.shutdown(); }
});

it("keeps memory busy after explicitly closing the parent until its actual task executor finishes", async () => {
  const { service, internal, busy } = setup();
  const parent = { isStreaming: false, abort: vi.fn(async () => {}), clearQueue: () => ({ steering: [], followUp: [] }) };
  internal.activeChats.set("parent-chat", { chatId: "parent-chat", sessionId: "parent", session: parent, abortController: new AbortController() });
  let release!: () => void, childExecuting = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const child = { sessionId: "mock-child", model: { id: "fixture" }, subscribe: () => () => {}, abort: vi.fn(async () => { release(); }), prompt: vi.fn(async () => { childExecuting = true; await gate; childExecuting = false; }) };
  fixture.create.mockResolvedValue(child);
  const record = createDelegation("parent", [{ task: "MOCK_READ_TASK", readOnly: true }]);
  const run = runSubagents(record, { cwd: fixture.root, agentDir: fixture.root, store: {} as Store, canUseTool: async () => ({ behavior: "allow" as const }) });
  try {
    await vi.waitFor(() => expect(child.prompt).toHaveBeenCalledOnce());
    expect(childExecuting).toBe(true);
    expect(internal.activeRuns.size).toBe(0);
    expect(busy()).toBe(true);
    await service.killSession("parent");
    expect(internal.activeChats.size).toBe(0);
    expect(record.status).toBe("running");
    expect(childExecuting).toBe(true);
    expect(child.abort).not.toHaveBeenCalled();
    expect(busy()).toBe(true);
    release(); await run;
    expect(childExecuting).toBe(false);
    expect(record.status).toBe("completed");
    expect(busy()).toBe(false);
  } finally { release(); await run; await service.shutdown(); }
});
