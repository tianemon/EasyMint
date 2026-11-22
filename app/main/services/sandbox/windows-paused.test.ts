import { afterEach, expect, it, vi } from "vitest";
import type { ExecutionContext } from "../permission/execution-context";
import { ensureSandbox, prepareWindowsSessionSandbox, wrapForSandbox } from "./manager";
import { effectiveWindowsExecutionMode } from "../permission/execution-context";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

afterEach(() => vi.unstubAllGlobals());

it("routes Windows standard commands to the native backend and preserves read-only mode", async () => {
  const win = Object.create(process);
  Object.defineProperty(win, "platform", { value: "win32" });
  vi.stubGlobal("process", win);
  const standard: ExecutionContext = {
    mode: "standard", ownerId: "fixture", workspaceRealPath: "C:\\work",
    runtimeRoot: "C:\\runtime", environment: {}, policyVersion: "2",
  };
  expect(effectiveWindowsExecutionMode("standard")).toBe("full");
  expect(effectiveWindowsExecutionMode("readonly")).toBe("readonly");
  await expect(prepareWindowsSessionSandbox(standard)).resolves.toBeUndefined();
  await expect(ensureSandbox(standard.workspaceRealPath, "standard")).resolves.toMatchObject({ ok: true });
  await expect(wrapForSandbox("Write-Output test", { context: standard, windowsShell: "powershell" }))
    .resolves.toMatchObject({ kind: "argv", argv: expect.arrayContaining(["powershell.exe"]) });
  await expect(ensureSandbox(standard.workspaceRealPath, "readonly")).resolves.toMatchObject({ ok: false });
  await expect(wrapForSandbox("Write-Output test", { context: { ...standard, mode: "full" }, windowsShell: "powershell" }))
    .resolves.toMatchObject({ kind: "argv", argv: expect.arrayContaining(["powershell.exe"]) });
});
