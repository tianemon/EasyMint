import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExecutionContext } from "../permission/execution-context";
const mocks = vi.hoisted(() => ({
  ensure: vi.fn(), join: vi.fn(), init: vi.fn(), wrap: vi.fn(), prepared: vi.fn(),
}));
vi.mock("electron", () => ({ app: { isPackaged: false } }));
vi.mock("../windows-runtime", () => ({
  ensureWindowsRuntime: mocks.ensure, joinWindowsRuntime: mocks.join, preparedWindowsRuntime: mocks.prepared,
  windowsRuntimeEnvironment: (env: NodeJS.ProcessEnv, paths: { root: string }) => ({ ...env, PATH: `${paths.root};${env.PATH ?? ""}` }),
}));
vi.mock("@anthropic-ai/sandbox-runtime", () => ({ SandboxManager: { initialize: mocks.init }, checkWindowsSandboxStatusAsync: async () => ({ user: { provisioned: true, credPresent: true } }) }));
vi.mock("./srt-win", () => ({ srtWinSpawn: () => ({ exe: "srt-win.exe", prependArgs: [] }) }));
vi.mock("./windows-execution-manager", () => ({ wrapWithWindowsWorker: mocks.wrap }));
import { wrapForSandbox } from "./manager";
const paths = { root: "verified-tools", bash: "verified-tools/bash.exe", git: "verified-tools/git.exe" };
const context = (mode: "full" | "standard"): ExecutionContext => ({ mode, workspaceRealPath: "work", runtimeRoot: "runtime", environment: { PATH: "original" }, policyVersion: "2", ownerId: "session-a" });
beforeEach(() => {
  mocks.ensure.mockReset().mockResolvedValue(paths); mocks.join.mockReset().mockResolvedValue(paths);
  mocks.prepared.mockReset().mockReturnValue(undefined);
  mocks.init.mockReset(); mocks.wrap.mockReset().mockResolvedValue({ argv: ["srt-win.exe"], env: {}, commandId: "lease", release: vi.fn(async () => {}) });
  const win = Object.create(process); Object.defineProperty(win, "platform", { value: "win32" }); vi.stubGlobal("process", win);
});
afterEach(() => vi.unstubAllGlobals());
it("uses the verified bundled Bash and child PATH without initializing full-mode protection", async () => {
  const signal = new AbortController().signal;
  const spec = await wrapForSandbox("echo hi", { context: context("full"), gitBashPath: "unverified-bash.exe", signal });
  // 命令链路只**加入**准备，绝不新建（新建会把 400MB 解压挂在每条消息上）
  expect(mocks.join).toHaveBeenCalledWith({ signal });
  expect(mocks.ensure).not.toHaveBeenCalled();
  expect(spec.kind).toBe("argv"); if (spec.kind !== "argv") throw Error("wrong spawn form");
  expect(spec.argv).toEqual([paths.bash, "-c", "echo hi"]);
  expect(spec.env.PATH).toBe("verified-tools;original");
  expect(mocks.init).not.toHaveBeenCalled(); expect(mocks.wrap).not.toHaveBeenCalled();
});
it("keeps Windows sandbox execution and passes the verified tools read root with the owner", async () => {
  const spec = await wrapForSandbox("echo hi", { context: context("standard") });
  expect(mocks.wrap).toHaveBeenCalledWith("echo hi", expect.objectContaining({ mode: "standard", ownerId: "session-a", bundledRuntimeRoot: paths.root }), paths.bash, undefined);
  const worker = await mocks.wrap.mock.results[0]!.value;
  await spec.release?.();
  expect(worker.release).toHaveBeenCalledOnce();
});
it("preserves a native PowerShell fallback without forcing Bash preparation or sandbox setup in full mode", async () => {
  const spec = await wrapForSandbox("Get-Location", { context: context("full"), windowsShell: "powershell" });
  expect(mocks.ensure).not.toHaveBeenCalled(); expect(mocks.join).not.toHaveBeenCalled(); expect(mocks.init).not.toHaveBeenCalled();
  expect(spec.kind).toBe("argv"); if (spec.kind !== "argv") throw Error("wrong spawn form");
  expect(spec.argv[0]).toBe("powershell.exe");
});
it("does not proceed to a spawn target after preparation is cancelled", async () => {
  const controller = new AbortController();
  mocks.join.mockImplementation(async () => {
    controller.abort();
    throw Object.assign(new Error("Cancelled"), { name: "AbortError" });
  });
  await expect(wrapForSandbox("echo hi", { context: context("full"), signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(mocks.wrap).not.toHaveBeenCalled();
});
