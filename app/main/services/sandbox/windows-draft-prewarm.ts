import { bindExecutionOwner, createExecutionContext } from "../permission/execution-context";
import { WINDOWS_SANDBOX_ENABLED } from "../../../shared/windows-sandbox";
import { prepareWindowsSessionSandbox } from "./manager";
import { adoptWindowsWorker, revokeWindowsExecutionOwners } from "./windows-execution-manager";

interface DraftPreparation {
  token: string;
  owner: string;
  workspace: string;
  controller: AbortController;
  adopted: boolean;
  pending: Promise<void>;
  priorCleanup: Promise<void>;
  stopping?: Promise<void>;
}
const drafts = new Map<string, DraftPreparation>();
let acceptingDrafts = true;

export function windowsDraftKey(windowId: number, tabId: string): string { return `${windowId}:${tabId}`; }

/** One draft per window/tab. The caller validates the project and current permission mode. */
export function startWindowsDraftPrewarm(key: string, token: string, cwd: string, onTimeout?: () => void): Promise<void> {
  if (process.platform !== "win32" || !WINDOWS_SANDBOX_ENABLED) return Promise.resolve();
  if (!acceptingDrafts) return Promise.reject(new Error("应用正在退出，不能准备沙盒"));
  const previous = drafts.get(key);
  if (previous?.adopted) return previous.pending;
  if (previous?.token === token) return previous.pending;
  const stopping = previous ? cancelWindowsDraftPrewarm(key, previous.token) : Promise.resolve();
  const controller = new AbortController();
  const context = bindExecutionOwner(createExecutionContext(cwd, "standard"), `draft:${key}:${token}`);
  const entry: DraftPreparation = { token, owner: context.ownerId!, workspace: context.workspaceRealPath, controller, adopted: false, pending: Promise.resolve(), priorCleanup: stopping };
  drafts.set(key, entry);
  entry.pending = (async () => {
    await stopping;
    controller.signal.throwIfAborted();
    await prepareWindowsSessionSandbox(context, controller.signal, () => !controller.signal.aborted, () => entry.owner, onTimeout);
  })();
  return entry.pending;
}

/** Called synchronously after the SDK assigns an id, before MCP starts. */
export function adoptWindowsDraftPrewarm(key: string, owner: string, workspace: string): boolean {
  const entry = drafts.get(key);
  if (!entry || entry.controller.signal.aborted || entry.workspace !== workspace) return false;
  if (!adoptWindowsWorker(entry.owner, owner, workspace)) {
    void cancelWindowsDraftPrewarm(key, entry.token).catch(error => console.warn("[sandbox] 草稿预热收尾失败:", error));
    return false;
  }
  entry.owner = owner; entry.adopted = true;
  return true;
}

export function commitWindowsDraftPrewarm(key: string, owner: string): void {
  const entry = drafts.get(key);
  if (!entry?.adopted || entry.owner !== owner) return;
  void entry.pending.then(
    () => { if (entry.adopted && !entry.stopping && drafts.get(key) === entry) drafts.delete(key); },
    () => { if (entry.adopted && !entry.stopping && drafts.get(key) === entry) drafts.delete(key); },
  );
}

export async function abandonWindowsDraftPrewarm(key: string, owner: string): Promise<void> {
  const entry = drafts.get(key);
  if (!entry?.adopted || entry.owner !== owner) return;
  entry.adopted = false;
  await cancelWindowsDraftPrewarm(key, entry.token);
}

/** Cleanup requests are token-scoped so a late cleanup cannot revoke a newer tab preparation. */
export async function cancelWindowsDraftPrewarm(key: string, token: string): Promise<void> {
  const entry = drafts.get(key);
  if (!entry || entry.token !== token || entry.adopted) return;
  if (entry.stopping) return entry.stopping;
  entry.controller.abort();
  const closing = revokeWindowsExecutionOwners([entry.owner]);
  entry.stopping = (async () => {
    const [, result, prior] = await Promise.allSettled([entry.pending, closing, entry.priorCleanup]);
    if (result.status === "rejected") throw result.reason;
    if (prior.status === "rejected") throw prior.reason;
    if (drafts.get(key) === entry) drafts.delete(key);
  })();
  return entry.stopping;
}

export async function cancelWindowsDraftsForWindow(windowId: number): Promise<void> {
  const prefix = `${windowId}:`;
  const results = await Promise.allSettled([...drafts.entries()].filter(([key, entry]) => key.startsWith(prefix) && !entry.adopted)
    .map(([key, entry]) => cancelWindowsDraftPrewarm(key, entry.token)));
  for (const result of results) if (result.status === "rejected") console.warn("[sandbox] 窗口预热收尾失败:", result.reason);
}

export async function cancelAdoptedWindowsDrafts(owner: string): Promise<void> {
  const entries = [...drafts.entries()].filter(([, entry]) => entry.adopted && entry.owner === owner);
  for (const [, entry] of entries) entry.adopted = false;
  const results = await Promise.allSettled(entries.map(([key, entry]) => cancelWindowsDraftPrewarm(key, entry.token)));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
}

export async function cancelAllWindowsDrafts(): Promise<void> {
  acceptingDrafts = false;
  const entries = [...drafts.entries()];
  for (const [, entry] of entries) entry.adopted = false;
  const results = await Promise.allSettled(entries.map(([key, entry]) => cancelWindowsDraftPrewarm(key, entry.token)));
  for (const result of results) if (result.status === "rejected") console.warn("[sandbox] 退出时预热收尾失败:", result.reason);
}
