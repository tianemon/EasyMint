import { isPermissionModeTightening, normalizePermissionMode } from "./permission/execution-context";
import { readCache, writeClientCache, type SessionCache } from "./session-cache";
import { withSessionCreationLock } from "./session-permission-gate";

interface PermissionTransitionService {
  sandboxSessionIdentity(sessionId: string): object | undefined;
  stopSandboxPrewarm(sessionId: string): Promise<void>;
  revokeElevatedExecution(sessionId: string): Promise<void>;
  refreshPermissionMcp(sessionId: string): Promise<void>;
  schedulePermissionToolRebuild(sessionId: string, closingFull?: boolean): void;
}

const transitions = new Map<string, Promise<void>>();
export async function waitForSessionPermissionTransition(sessionId: string): Promise<void> {
  while (transitions.has(sessionId)) await transitions.get(sessionId)?.catch(() => undefined);
}

export function applySessionPermissionTransition(sessionId: string, data: Partial<SessionCache>, service: PermissionTransitionService): Promise<void> {
  const run = (transitions.get(sessionId) ?? Promise.resolve()).catch(() => undefined)
    .then(() => transition(sessionId, data, service));
  transitions.set(sessionId, run);
  const remove = () => { if (transitions.get(sessionId) === run) transitions.delete(sessionId); };
  void run.then(remove, remove);
  return run;
}

async function transition(sessionId: string, data: Partial<SessionCache>, service: PermissionTransitionService): Promise<void> {
  let preparedSession: object | undefined;
  const next = data.permissionMode;
  for (;;) {
    const step = await withSessionCreationLock(async () => {
      const previous = readCache(sessionId)?.permissionMode;
      const session = service.sandboxSessionIdentity(sessionId);
      if (session && session !== preparedSession && next !== undefined &&
          normalizePermissionMode(previous) === "standard" && normalizePermissionMode(next) !== "standard") {
        const cleanup = service.stopSandboxPrewarm(sessionId);
        void cleanup.catch(() => undefined);
        return { session, cleanup };
      }
      writeClientCache(sessionId, data);
      const closingFull = next !== undefined && normalizePermissionMode(previous) === "full" && normalizePermissionMode(next) !== "full";
      if (closingFull || next !== undefined && (
        normalizePermissionMode(previous) === "readonly" && normalizePermissionMode(next) !== "readonly" ||
        normalizePermissionMode(previous) !== "full" && normalizePermissionMode(next) === "full"
      )) service.schedulePermissionToolRebuild(sessionId, closingFull);
      return {
        tighten: isPermissionModeTightening(previous, next),
        refreshMcp: !!session && normalizePermissionMode(previous) === "standard" && next !== undefined && normalizePermissionMode(next) === "full",
      };
    });
    if (!step.cleanup) {
      if (step.tighten) await service.revokeElevatedExecution(sessionId);
      if (step.refreshMcp) await service.refreshPermissionMcp(sessionId);
      return;
    }
    await step.cleanup;
    preparedSession = step.session;
  }
}
