import { randomUUID } from "node:crypto";
import { WINDOWS_SANDBOX_ENABLED } from "../../../shared/windows-sandbox";
import { bindExecutionOwner, createExecutionContext, normalizePermissionMode } from "../permission/execution-context";
import { prepareWindowsSessionSandbox } from "./manager";
import { revokeWindowsExecutionOwners, waitWindowsOwnerCleanup } from "./windows-execution-manager";
import { cancelAdoptedWindowsDrafts } from "./windows-draft-prewarm";

export type WindowsPreparationStatus = "preparing" | "ready" | "failed" | "stopping" | "stopped";
type StatusHandler = (state: WindowsPreparationStatus, error: string | undefined, preparationId: string) => void;
interface Preparation {
  controller: AbortController;
  pending: Promise<void>;
  owner: string;
  status?: StatusHandler;
  id: string;
  state: WindowsPreparationStatus;
  error?: string;
  stopping?: Promise<void>;
}
const preparations = new WeakMap<object, Preparation>();
export function hasWindowsSessionPrewarm(session: object): boolean { return preparations.has(session); }
export function getWindowsSessionPrewarm(session: object): { preparationId: string; state: WindowsPreparationStatus; error?: string } | undefined {
  const entry = preparations.get(session);
  return entry && { preparationId: entry.id, state: entry.state, error: entry.error };
}
function emitStatus(entry: Preparation, state: WindowsPreparationStatus, error?: string): void {
  entry.state = state; entry.error = error;
  try { entry.status?.(state, error, entry.id); } catch (cause) { console.warn("[sandbox] 后台准备状态通知失败:", cause); }
}

/** Prepare only a real standard-mode session; never install the runtime or start a command. */
export function startWindowsSessionPrewarm(session: object, cwd: string, owner: string, getMode: () => string | undefined, status?: StatusHandler): void {
  if (process.platform !== "win32" || !WINDOWS_SANDBOX_ENABLED || normalizePermissionMode(getMode()) !== "standard" || preparations.has(session)) return;
  const entry: Preparation = { controller: new AbortController(), pending: Promise.resolve(), owner, status, id: randomUUID(), state: "preparing" };
  preparations.set(session, entry);
  emitStatus(entry, "preparing");
  entry.pending = (async () => {
    const context = bindExecutionOwner(createExecutionContext(cwd, "standard"), owner);
    if (normalizePermissionMode(getMode()) !== "standard") {
      emitStatus(entry, "stopped");
      if (preparations.get(session) === entry) preparations.delete(session);
      return;
    }
    await prepareWindowsSessionSandbox(context, entry.controller.signal, () => normalizePermissionMode(getMode()) === "standard", undefined, () => emitStatus(entry, "stopping"));
    if (!entry.controller.signal.aborted) emitStatus(entry, "ready");
  })().catch(error => {
    if (!entry.controller.signal.aborted && error instanceof Error && error.name === "AbortError") {
      emitStatus(entry, "stopped");
      if (preparations.get(session) === entry) preparations.delete(session);
    } else if (!entry.controller.signal.aborted) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[sandbox] 会话后台准备失败，执行时将重新检查:", message);
      emitStatus(entry, "failed", message);
    }
  });
}

/** Mark the worker revoking before awaiting initialization; an in-flight command retains its lease. */
export function stopWindowsSessionPrewarm(session: object): Promise<void> {
  const entry = preparations.get(session);
  if (!entry) return Promise.resolve();
  if (entry.stopping) return entry.stopping;
  entry.controller.abort();
  emitStatus(entry, "stopping");
  const draftClosing = cancelAdoptedWindowsDrafts(entry.owner);
  const closing = revokeWindowsExecutionOwners([entry.owner]);
  const stopping = (async () => {
    const results = await Promise.allSettled([entry.pending, closing, draftClosing]);
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) {
      const message = failed.reason instanceof Error ? failed.reason.message : String(failed.reason);
      emitStatus(entry, "failed", message);
      throw failed.reason;
    }
  })();
  // A running command or MCP may retain its lease past the permission commit.
  // Capture the actual shutdown now, before the worker can leave the registry.
  void Promise.all([stopping, waitWindowsOwnerCleanup(entry.owner)]).then(() => {
    emitStatus(entry, "stopped");
    if (preparations.get(session) === entry) preparations.delete(session);
  }).catch(error => {
    if (entry.state !== "failed") emitStatus(entry, "failed", error instanceof Error ? error.message : String(error));
  });
  entry.stopping = stopping;
  return stopping;
}
