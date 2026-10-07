import { afterEach, describe, expect, it, vi } from "vitest";
import { ProtectedMcpTransport } from "./mcp-transport";

const mocks = vi.hoisted(() => ({ wrap: vi.fn(), release: vi.fn(async () => {}), start: vi.fn(async () => {}), close: vi.fn(async () => {}), initialize: vi.fn(async () => ({ ok: true })) }));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => "/tmp" } }));
vi.mock("./permission/execution-context", () => ({ bindExecutionOwner: (value: unknown) => value, createExecutionContext: () => ({ environment: { SAFE: "yes" } }) }));
vi.mock("./sandbox/manager", () => ({ ensureSandbox: mocks.initialize, isSandboxBypassedForMode: (mode: string) => mode === "full", wrapForSandbox: mocks.wrap }));
vi.mock("@earendil-works/pi-mcp", () => ({
  StreamableHttpTransport: class {},
  StdioTransport: class {
    onMessage() {} onError() {} onClose() {} start = mocks.start; close = mocks.close;
  },
}));
afterEach(() => { vi.clearAllMocks(); });
const entry = { name: "fixture", source: "test", config: { command: "node" } };

describe("MCP async transport boundary", () => {
  it("releases exactly once if closed while sandbox preparation is pending", async () => {
    let resolve!: (spec: unknown) => void;
    mocks.wrap.mockReturnValue(new Promise(done => { resolve = done; }));
    const transport = new ProtectedMcpTransport({ entry, cwd: "/tmp", owner: "session", mode: () => "standard" });
    const started = transport.start();
    await vi.waitFor(() => expect(mocks.wrap).toHaveBeenCalled());
    const closed = transport.close();
    resolve({ kind: "argv", argv: ["node"], env: {}, release: mocks.release });
    await expect(started).rejects.toThrow("撤销");
    await closed; await transport.close();
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.release).toHaveBeenCalledTimes(1);
  });
  it("rechecks mode after async preparation and releases when spawn fails", async () => {
    let mode: "standard" | "readonly" = "standard";
    mocks.wrap.mockImplementation(async () => { mode = "readonly"; return { kind: "argv", argv: ["node"], env: {}, release: mocks.release }; });
    const revoked = new ProtectedMcpTransport({ entry, cwd: "/tmp", owner: "session", mode: () => mode });
    await expect(revoked.start()).rejects.toThrow("撤销"); await revoked.close();
    expect(mocks.release).toHaveBeenCalledTimes(1);
    mode = "standard";
    mocks.wrap.mockResolvedValue({ kind: "argv", argv: ["missing"], env: {}, release: mocks.release });
    mocks.start.mockRejectedValueOnce(new Error("spawn failed"));
    const failed = new ProtectedMcpTransport({ entry, cwd: "/tmp", owner: "session", mode: () => mode });
    await expect(failed.start()).rejects.toThrow("spawn failed"); await failed.close();
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });
  it("readonly rejects before importing/spawning the backend", async () => {
    const transport = new ProtectedMcpTransport({ entry, cwd: "/tmp", owner: "session", mode: () => "readonly" });
    await expect(transport.start()).rejects.toThrow("撤销");
    expect(mocks.wrap).not.toHaveBeenCalled();
  });
});
