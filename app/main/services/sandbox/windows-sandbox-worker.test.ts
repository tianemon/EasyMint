import { afterEach, expect, it, vi } from "vitest";
import type { WindowsSandboxWorkerRequest, WindowsSandboxWorkerResponse } from "./windows-worker-protocol";

const mocks = vi.hoisted(() => ({ initialize: vi.fn(), wrap: vi.fn(), reset: vi.fn() }));
vi.mock("@anthropic-ai/sandbox-runtime", () => ({
  SandboxManager: { initialize: mocks.initialize, wrapWithSandboxArgv: mocks.wrap, reset: mocks.reset },
  VENDORED_SRT_WIN_EXE: "srt-win.exe",
}));
vi.mock("./srt-win", () => ({ unpackedAsarPath: (value: string) => value }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it("uses each request's environment when a worker is reused", async () => {
  let receive!: (request: WindowsSandboxWorkerRequest) => void;
  const sent: WindowsSandboxWorkerResponse[] = [];
  const childProcess = Object.create(process) as NodeJS.Process;
  childProcess.on = ((event: string, listener: (request: WindowsSandboxWorkerRequest) => void) => {
    if (event === "message") receive = listener;
    return childProcess;
  }) as NodeJS.Process["on"];
  childProcess.send = ((message: WindowsSandboxWorkerResponse) => { sent.push(message); return true; }) as NodeJS.Process["send"];
  vi.stubGlobal("process", childProcess);
  mocks.initialize.mockReset().mockResolvedValue(undefined);
  mocks.wrap.mockReset().mockResolvedValue({ argv: ["sandbox"], env: { PROXY: "sandbox" } });
  await import("./windows-sandbox-worker");
  receive({ type: "initialize", requestId: "init", context: { mode: "standard", workspaceRealPath: "work", runtimeRoot: "runtime", environment: { SOURCE: "initial" }, policyVersion: "2" }, policy: { network: { allowedDomains: [], deniedDomains: [] }, filesystem: { denyRead: [], allowWrite: [], denyWrite: [] } } });
  await vi.waitFor(() => expect(sent.some(message => message.requestId === "init")).toBe(true));
  for (const source of ["mcp", "shell"]) {
    receive({ type: "wrap", requestId: source, command: "test", shell: "powershell", commandId: source, environment: { SOURCE: source, PROXY: "original" } });
    await vi.waitFor(() => expect(sent.some(message => message.requestId === source)).toBe(true));
    expect(sent.find(message => message.requestId === source)).toMatchObject({ type: "wrapped", env: { SOURCE: source, PROXY: "sandbox" } });
  }
});

it("waits for an in-flight initialization before cleaning up after parent disconnect", async () => {
  let receive!: (request: WindowsSandboxWorkerRequest) => void, disconnect!: () => void, finish!: () => void;
  const sent: WindowsSandboxWorkerResponse[] = [];
  const childProcess = Object.create(process) as NodeJS.Process;
  Object.defineProperty(childProcess, "connected", { value: true, writable: true, configurable: true });
  childProcess.on = ((event: string, listener: (...args: never[]) => void) => {
    if (event === "message") receive = listener as (request: WindowsSandboxWorkerRequest) => void;
    if (event === "disconnect") disconnect = listener;
    return childProcess;
  }) as NodeJS.Process["on"];
  childProcess.send = ((message: WindowsSandboxWorkerResponse) => { sent.push(message); return true; }) as NodeJS.Process["send"];
  vi.stubGlobal("process", childProcess);
  mocks.initialize.mockReset().mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  mocks.reset.mockReset().mockResolvedValue(undefined);
  await import("./windows-sandbox-worker");
  receive({ type: "initialize", requestId: "init", context: { mode: "standard", workspaceRealPath: "work", runtimeRoot: "runtime", environment: {}, policyVersion: "2" }, policy: { network: { allowedDomains: [], deniedDomains: [] }, filesystem: { denyRead: [], allowWrite: [], denyWrite: [] } } });
  Object.defineProperty(childProcess, "connected", { value: false, configurable: true }); disconnect();
  await Promise.resolve(); expect(mocks.reset).not.toHaveBeenCalled();
  finish(); await vi.waitFor(() => expect(mocks.reset).toHaveBeenCalledOnce());
  expect(sent).toEqual([]);
});
