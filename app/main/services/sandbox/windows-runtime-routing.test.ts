vi.mock("../../../shared/windows-sandbox", () => ({ WINDOWS_SANDBOX_ENABLED: true }));
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExecutionContext } from "../permission/execution-context";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const mocks = vi.hoisted(() => ({
  ensure: vi.fn(), join: vi.fn(), init: vi.fn(), reset: vi.fn(), wrap: vi.fn(), prepare: vi.fn(), revoke: vi.fn(), waitCleanup: vi.fn(), prepared: vi.fn(), status: vi.fn(),
}));
vi.mock("electron", () => ({ app: { isPackaged: false } }));
vi.mock("../windows-runtime", () => ({
  ensureWindowsRuntime: mocks.ensure, joinWindowsRuntime: mocks.join, preparedWindowsRuntime: mocks.prepared,
  windowsRuntimeEnvironment: (env: NodeJS.ProcessEnv, paths: { root: string }) => ({ ...env, PATH: `${paths.root};${env.PATH ?? ""}` }),
}));
vi.mock("@anthropic-ai/sandbox-runtime", () => ({ SandboxManager: { initialize: mocks.init, reset: mocks.reset }, checkWindowsSandboxStatusAsync: mocks.status }));
vi.mock("./srt-win", () => ({ srtWinSpawn: () => ({ exe: "srt-win.exe", prependArgs: [] }), windowsSandboxIssue: () => undefined }));
vi.mock("./windows-execution-manager", () => ({ wrapWithWindowsWorker: mocks.wrap, prepareWindowsWorker: mocks.prepare, revokeWindowsExecutionOwners: mocks.revoke, waitWindowsOwnerCleanup: mocks.waitCleanup, WindowsSandboxInitializationTimeout: class extends Error {} }));
import { ensureSandbox, preflightWindowsSandbox, prepareWindowsSessionSandbox, releaseSandbox, wrapForSandbox } from "./manager";
const paths = { root: "verified-tools", bash: "verified-tools/bash.exe", git: "verified-tools/git.exe" };
const context = (mode: "full" | "standard"): ExecutionContext => ({ mode, workspaceRealPath: process.cwd(), runtimeRoot: "runtime", environment: { PATH: "original" }, policyVersion: "2", ownerId: "session-a" });
beforeEach(() => {
  mocks.ensure.mockReset().mockResolvedValue(paths); mocks.join.mockReset().mockResolvedValue(paths);
  mocks.prepared.mockReset().mockReturnValue(undefined);
  mocks.init.mockReset(); mocks.wrap.mockReset().mockResolvedValue({ argv: ["srt-win.exe"], env: {}, commandId: "lease", release: vi.fn(async () => {}) });
  mocks.reset.mockReset().mockResolvedValue(undefined);
  mocks.prepare.mockReset().mockResolvedValue(undefined);
  mocks.revoke.mockReset().mockResolvedValue(undefined);
  mocks.waitCleanup.mockReset().mockResolvedValue(undefined);
  mocks.status.mockReset().mockResolvedValue({ user: { provisioned: true, credPresent: true } });
  const win = Object.create(process); Object.defineProperty(win, "platform", { value: "win32" }); vi.stubGlobal("process", win);
});
afterEach(async () => { await releaseSandbox(); vi.unstubAllGlobals(); });
it("shares the read-only startup system check without initializing a worker", async () => {
  let finish!: (value: unknown) => void;
  mocks.status.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const first = preflightWindowsSandbox(), second = preflightWindowsSandbox();
  await vi.waitFor(() => expect(mocks.status).toHaveBeenCalledTimes(1));
  finish({ user: { provisioned: true, credPresent: true } });
  expect(await first).toEqual({ ok: true }); expect(await second).toEqual({ ok: true });
  expect(await ensureSandbox("work", "standard")).toEqual({ ok: true });
  expect(mocks.status).toHaveBeenCalledTimes(1);
  expect(mocks.init).not.toHaveBeenCalled(); expect(mocks.wrap).not.toHaveBeenCalled();
});
it("allows a later system check after a transient startup failure", async () => {
  mocks.status.mockRejectedValueOnce(new Error("temporary failure"));
  expect(await preflightWindowsSandbox()).toEqual({ ok: false, reason: "temporary failure" });
  expect(await preflightWindowsSandbox()).toEqual({ ok: true });
  expect(mocks.status).toHaveBeenCalledTimes(2);
});
it("does not reuse a startup result that finishes after sandbox reset", async () => {
  let finish!: (value: unknown) => void;
  mocks.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = preflightWindowsSandbox();
  await vi.waitFor(() => expect(mocks.status).toHaveBeenCalledTimes(1));
  await releaseSandbox();
  finish({ user: { provisioned: true, credPresent: true } });
  expect(await first).toEqual({ ok: true });
  expect(await ensureSandbox("work", "standard")).toEqual({ ok: true });
  expect(mocks.status).toHaveBeenCalledTimes(2);
});
it("does not mark a pending execution check ready after sandbox reset", async () => {
  let finish!: (value: unknown) => void;
  mocks.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = ensureSandbox("work", "standard");
  await vi.waitFor(() => expect(mocks.status).toHaveBeenCalledTimes(1));
  await releaseSandbox();
  finish({ user: { provisioned: true, credPresent: true } });
  expect(await first).toEqual({ ok: false, reason: "系统保护状态已重置，请重试" });
  expect(await ensureSandbox("work", "standard")).toEqual({ ok: true });
  expect(mocks.status).toHaveBeenCalledTimes(2);
});
it("prepares the same Windows worker configuration that a later command uses", async () => {
  await prepareWindowsSessionSandbox(context("standard"));
  await wrapForSandbox("echo hi", { context: context("standard") });
  const prepared = mocks.prepare.mock.calls[0]![0] as ExecutionContext;
  const wrapped = mocks.wrap.mock.calls[0]![1] as ExecutionContext;
  expect(prepared).toEqual(wrapped);
  expect(mocks.ensure).not.toHaveBeenCalled();
});
it("does not initialize a worker for full access or a cancelled preparation", async () => {
  await prepareWindowsSessionSandbox(context("full"));
  const controller = new AbortController(); controller.abort();
  await expect(prepareWindowsSessionSandbox(context("standard"), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it("revokes a worker if the mode changes while initialization is pending", async () => {
  let ready!: () => void; let allowed = true;
  mocks.prepare.mockImplementation(() => new Promise<void>(resolve => { ready = resolve; }));
  const preparing = prepareWindowsSessionSandbox(context("standard"), undefined, () => allowed);
  await vi.waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
  allowed = false; ready();
  await expect(preparing).rejects.toMatchObject({ name: "AbortError" });
  expect(mocks.revoke).toHaveBeenCalledWith(["session-a"]);
});
it("keeps background preparation pending until a timed-out worker has finished cleanup", async () => {
  const { WindowsSandboxInitializationTimeout } = await import("./windows-execution-manager");
  let finish!: () => void;
  mocks.prepare.mockRejectedValueOnce(new WindowsSandboxInitializationTimeout());
  mocks.waitCleanup.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const onTimeout = vi.fn();
  const preparing = prepareWindowsSessionSandbox(context("standard"), undefined, undefined, undefined, onTimeout);
  const rejected = expect(preparing).rejects.toThrow("后台收尾已结束");
  await vi.waitFor(() => expect(mocks.waitCleanup).toHaveBeenCalledWith("session-a"));
  expect(onTimeout).toHaveBeenCalledOnce();
  let settled = false; void preparing.catch(() => { settled = true; }); await Promise.resolve(); expect(settled).toBe(false);
  finish(); await rejected;
});
it("does not initialize a replacement project directory after a delayed runtime check", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-sandbox-project-"));
  const project = path.join(root, "project"); fs.mkdirSync(project);
  try {
    let resume!: (value: typeof paths) => void;
    mocks.join.mockImplementation(() => new Promise(resolve => { resume = resolve; }));
    const preparing = prepareWindowsSessionSandbox({ ...context("standard"), workspaceRealPath: project });
    await vi.waitFor(() => expect(mocks.join).toHaveBeenCalledOnce());
    fs.renameSync(project, path.join(root, "old")); fs.mkdirSync(project); resume(paths);
    await expect(preparing).rejects.toThrow("项目目录已变化");
    expect(mocks.prepare).not.toHaveBeenCalled();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
it("uses the verified bundled Bash and child PATH without initializing full-mode protection", async () => {
  const signal = new AbortController().signal;
  const spec = await wrapForSandbox("echo hi", { context: context("full"), signal });
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
  expect(mocks.wrap).toHaveBeenCalledWith("echo hi", expect.objectContaining({ mode: "standard", ownerId: "session-a", bundledRuntimeRoot: paths.root }), paths.bash, undefined, undefined);
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
it("reports the missing Bash runtime even with full access and never starts a repair from a command", async () => {
  mocks.join.mockResolvedValue(undefined);
  await expect(wrapForSandbox("echo hi", { context: context("full") })).rejects.toThrow("环境检测");
  expect(mocks.ensure).not.toHaveBeenCalled();
  expect(mocks.wrap).not.toHaveBeenCalled();
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
