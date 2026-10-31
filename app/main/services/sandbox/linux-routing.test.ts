import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ fail: false, init: vi.fn(), wrap: vi.fn(async (...args: unknown[]) => { void args; return "wrapped"; }) }));
vi.mock("@anthropic-ai/sandbox-runtime", () => ({ SandboxManager: { initialize: h.init, wrapWithSandbox: h.wrap, reset: vi.fn() } }));
vi.mock("./srt-linux", () => ({ linuxSandboxConfig: (cfg: object) => {
  if (h.fail) throw new Error("missing trusted helper");
  return { ...cfg, seccomp: { applyPath: "/bundle/app.asar.unpacked/helper" } };
} }));
vi.mock("../permission/access-policy", () => ({ buildExecutionPolicy: () => ({}), }));
vi.mock("../permission/execution-context", () => ({ createExecutionContext: () => ({}) }));
import { ensureSandbox, wrapForSandbox, releaseSandbox } from "./manager";
const context = { mode: "standard", environment: {}, workspaceRealPath: "/workspace", runtimeRoot: "/runtime" } as never;
beforeEach(() => { vi.spyOn(process, "platform", "get").mockReturnValue("linux"); h.fail = false; h.init.mockClear(); h.wrap.mockClear(); });
afterEach(async () => { await releaseSandbox(); vi.restoreAllMocks(); });
describe("Linux execution routing", () => {
  it("passes the real helper to initialize and wrap", async () => {
    expect((await ensureSandbox("/workspace", "standard")).ok).toBe(true);
    expect(h.init.mock.calls[0]?.[0].seccomp.applyPath).toContain(".asar.unpacked");
    await wrapForSandbox("echo ok", { context });
    expect((h.wrap.mock.calls[0]?.[2] as { seccomp: { applyPath: string } }).seccomp.applyPath).toContain(".asar.unpacked");
  });
  it("does not initialize or wrap when the helper is missing", async () => {
    h.fail = true;
    expect((await ensureSandbox("/workspace", "standard")).ok).toBe(false);
    expect(h.init).not.toHaveBeenCalled();
    await expect(wrapForSandbox("echo ok", { context })).rejects.toThrow("missing trusted helper");
    expect(h.wrap).not.toHaveBeenCalled();
  });
  it("full access never checks the sandbox helper", async () => {
    h.fail = true;
    expect((await ensureSandbox("/workspace", "full")).ok).toBe(true);
    const spec = await wrapForSandbox("echo ok", { context: { ...context as object, mode: "full" } as never });
    expect(spec.kind).toBe("shell"); expect(h.init).not.toHaveBeenCalled(); expect(h.wrap).not.toHaveBeenCalled();
  });
});
