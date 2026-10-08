import { afterEach, describe, expect, it, vi } from "vitest";
import { migrationService } from "./migration-service";
import { broadcast } from "./ipc-broadcast";

vi.mock("./network-service", async () => {
  const { EventEmitter } = await import("node:events");
  return { networkService: Object.assign(new EventEmitter(), { sendToDevice: vi.fn() }) };
});
vi.mock("./ipc-broadcast", () => ({ broadcast: vi.fn() }));
vi.mock("./pi-session", () => ({ tryGetPiSessionDir: vi.fn() }));
vi.mock("electron", () => ({ app: { isPackaged: false } }));

// Inspect protocol state without starting network services, packing archives or restoring user files.
const service = migrationService as unknown as {
  handleProtocolMessage(peerId: string, msg: Record<string, unknown>): Promise<void>;
  pending: Map<string, { peerId: string; chunks: Buffer[]; receivedBytes: number; completeArrived?: boolean }>;
  acceptWaiters: Map<string, { peerId: string; resolve: (value: string) => void; timer: ReturnType<typeof setTimeout> }>;
  sentTransfers: Map<string, { peerId: string; projectPath: string; manifest: { fileCount: number; sessionFiles: string[] } }>;
};
afterEach(() => {
  service.pending.clear();
  for (const waiter of service.acceptWaiters.values()) clearTimeout(waiter.timer);
  service.acceptWaiters.clear(); service.sentTransfers.clear();
  migrationService.removeAllListeners(); vi.clearAllMocks();
});
const request = (extra: Record<string, unknown> = {}) => ({
  type: "transfer-request", transferId: "transfer-one", manifest: { projectName: "example", zipSize: 5, sessionFiles: [] }, ...extra,
});

describe("migration transfer ownership", () => {
  it("takes sender identity from the authenticated channel, ignoring payload fromId", async () => {
    await service.handleProtocolMessage("owner", request({ fromId: "other" }));
    expect(service.pending.get("transfer-one")?.peerId).toBe("owner");
  });

  it("does not replace an existing request or discard its received chunks", async () => {
    await service.handleProtocolMessage("owner", request());
    migrationService.handleChunk("owner", { transferId: "transfer-one", index: 0, data: Buffer.from("hello").toString("base64") });
    const pending = service.pending.get("transfer-one");
    await service.handleProtocolMessage("other", request());
    await service.handleProtocolMessage("owner", request());
    expect(service.pending.get("transfer-one")).toBe(pending);
    expect(pending?.receivedBytes).toBe(5);
  });

  it("ignores another device's chunks and completion but accepts the owner's messages", async () => {
    await service.handleProtocolMessage("owner", request());
    migrationService.handleChunk("other", { transferId: "transfer-one", index: 0, data: "YQ==" });
    await migrationService.completeTransfer("other", { transferId: "transfer-one" });
    const pending = service.pending.get("transfer-one")!;
    expect(pending.chunks).toEqual([]); expect(pending.receivedBytes).toBe(0);
    expect(pending.completeArrived).toBeUndefined();
    migrationService.handleChunk("owner", { transferId: "transfer-one", index: 0, data: "YQ==" });
    await migrationService.completeTransfer("owner", { transferId: "transfer-one" });
    expect(pending.chunks[0]?.toString()).toBe("a");
    expect(pending.completeArrived).toBe(true);
  });

  it.each(["transfer-accept", "transfer-reject"])("only the intended recipient can answer %s", async type => {
    const resolve = vi.fn();
    service.acceptWaiters.set("transfer-one", { peerId: "owner", resolve, timer: setTimeout(() => {}, 30000) });
    await service.handleProtocolMessage("other", { type, transferId: "transfer-one" });
    expect(resolve).not.toHaveBeenCalled();
    await service.handleProtocolMessage("owner", { type, transferId: "transfer-one" });
    expect(resolve).toHaveBeenCalledWith(type === "transfer-accept" ? "accepted" : "rejected");
  });

  it.each(["transfer-done", "transfer-failed"])("checks the recipient of %s and keeps event identity authoritative", async type => {
    const listener = vi.fn();
    migrationService.on(type === "transfer-done" ? "done" : "failed", listener);
    service.sentTransfers.set("transfer-one", { peerId: "owner", projectPath: "/expected-project", manifest: { fileCount: 1, sessionFiles: [] } });
    const msg = { type, transferId: "transfer-one", restoredCount: 1, peerId: "spoof", projectPath: "/spoof" };
    await service.handleProtocolMessage("other", msg);
    expect(listener).not.toHaveBeenCalled();
    await service.handleProtocolMessage("owner", msg);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ peerId: "owner", projectPath: "/expected-project" }));
    expect(service.sentTransfers.has("transfer-one")).toBe(false);
    await service.handleProtocolMessage("owner", msg);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("settles the handshake when the intended recipient reports failure before acceptance", async () => {
    const resolve = vi.fn();
    service.acceptWaiters.set("transfer-one", { peerId: "owner", resolve, timer: setTimeout(() => {}, 30000) });
    service.sentTransfers.set("transfer-one", { peerId: "owner", projectPath: "/expected-project", manifest: { fileCount: 1, sessionFiles: [] } });
    await service.handleProtocolMessage("owner", { type: "transfer-failed", transferId: "transfer-one", failures: ["receiver failure"] });
    expect(resolve).toHaveBeenCalledWith("rejected");
    expect(service.acceptWaiters.has("transfer-one")).toBe(false);
    expect(service.sentTransfers.has("transfer-one")).toBe(false);
  });
});
