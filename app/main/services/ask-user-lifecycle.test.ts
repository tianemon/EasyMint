import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "./pi-sdk";
import { createAskUserTool, getPendingAskSnapshots, respondAsk } from "./agent-service";

const sent = vi.hoisted(() => ({ events: [] as string[] }));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => "/tmp" }, BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("./pi-sdk", async importOriginal => ({ ...await importOriginal<typeof import("./pi-sdk")>(), getDefineToolFn: async () => (definition: ToolDefinition) => definition }));
vi.mock("./ipc-broadcast", () => ({ broadcast: (channel: string) => sent.events.push(channel) }));
afterEach(() => {
  for (const request of getPendingAskSnapshots("quality-ask")) respondAsk(request.requestId, null);
  sent.events.length = 0;
});
describe("user question cancellation", () => {
  it("does not open a pending question when the tool already has an aborted signal", async () => {
    const tool = await createAskUserTool("quality-ask");
    const controller = new AbortController(); controller.abort();
    const execute = tool.execute as unknown as (id: string, params: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
    let settled = false;
    const work = execute("call", { questions: [{ id: "q", question: "fixture" }] }, controller.signal).finally(() => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 0));
    const hanging = !settled;
    const pending = getPendingAskSnapshots("quality-ask");
    for (const request of pending) respondAsk(request.requestId, null);
    await work;
    expect(hanging).toBe(false);
    expect(pending).toEqual([]);
    expect(sent.events).not.toContain("agent:ask-request");
  });
});
