import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProtectedMcpTransport } from "./mcp-transport";

const mocks = vi.hoisted(() => ({ wrap: vi.fn(), release: vi.fn(async () => {}), start: vi.fn(async () => {}), close: vi.fn(async () => {}), initialize: vi.fn(async () => ({ ok: true })) }));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => "/tmp" } }));
vi.mock("./permission/execution-context", () => ({ bindExecutionOwner: (value: unknown) => value, createExecutionContext: () => ({ environment: { SAFE: "yes", PATH: "D:\\managed\\bin;C:\\Windows\\System32", LOCALAPPDATA: "D:\\sandbox\\Local" } }) }));
vi.mock("./background-shell/registry", () => ({ findBashOnWindows: () => "C:\\Git\\bin\\bash.exe" }));
vi.mock("./sandbox/manager", () => ({ ensureSandbox: mocks.initialize, isSandboxBypassedForMode: (mode: string) => mode === "full", wrapForSandbox: mocks.wrap }));
vi.mock("@earendil-works/pi-mcp", () => ({
  StreamableHttpTransport: class {},
  StdioTransport: class {
    onMessage() {} onError() {} onClose() {} start = mocks.start; close = mocks.close;
  },
}));
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const entry = { name: "fixture", source: "test", config: { command: "node" } };

describe("MCP async transport boundary", () => {
  it.each(["standard", "full"] as const)("launches a Windows standalone CodeGraph through its own node in %s mode", async mode => {
    const platform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      vi.stubEnv("LOCALAPPDATA", "C:\\Users\\Test User\\AppData\\Local");
      vi.stubEnv("CODEGRAPH_INSTALL_DIR", "");
      const bundle = "C:\\Users\\Test User\\AppData\\Local\\codegraph\\current";
      const files = new Set([`${bundle}\\bin\\codegraph.cmd`, `${bundle}\\node.exe`, `${bundle}\\lib\\dist\\bin\\codegraph.js`]);
      vi.spyOn(fs, "existsSync").mockImplementation(value => files.has(String(value)));
      mocks.wrap.mockResolvedValue({ kind: "argv", argv: ["mock-worker"], env: {}, release: mocks.release });
      const transport = new ProtectedMcpTransport({ entry: { name: "codegraph", source: "test", config: { command: "codegraph", args: ["serve", "--mcp"] } }, cwd: "D:\\project", owner: "session", mode: () => mode });
      await transport.start();
      expect(mocks.wrap).toHaveBeenCalledWith(`'${bundle}\\node.exe' '${bundle}\\lib\\dist\\bin\\codegraph.js' 'serve' '--mcp'`, expect.objectContaining({
        context: expect.objectContaining({ environment: expect.objectContaining({
          PATH: expect.stringContaining("D:\\managed\\bin;C:\\Windows\\System32"), LOCALAPPDATA: "D:\\sandbox\\Local",
        }) }), gitBashPath: "C:\\Git\\bin\\bash.exe",
      }));
      await transport.close();
      expect(mocks.release).toHaveBeenCalledTimes(1);
    } finally { Object.defineProperty(process, "platform", { value: platform }); }
  });

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
