import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { WINDOWS_SANDBOX_ENABLED } from "../../../shared/windows-sandbox";
import { resolveHome } from "../../utils/paths";
import { normalizePermissionMode } from "../permission/execution-context";
import { cancelWindowsDraftPrewarm, cancelWindowsDraftsForWindow, startWindowsDraftPrewarm, windowsDraftKey } from "./windows-draft-prewarm";

interface Sender { id: number; isDestroyed(): boolean; once(event: "destroyed", listener: () => void): unknown; send(channel: string, data: unknown): void }
interface Dependencies {
  projectRootContaining(path: string): string | null;
  deferProjectPrewarm?(root: string): boolean;
  defaultMode(): string | undefined;
  sessionMode(sessionId: string): string | undefined;
  hasSessionPrewarm(sessionId: string): boolean;
}
const safeKey = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const identity = z.object({ tabId: safeKey, token: safeKey });
const preparation = identity.extend({ projectPath: z.string().min(1).max(4096), sessionId: z.string().max(200).optional(), mode: z.enum(["standard", "readonly", "full"]) });

export function createWindowsDraftHandlers(deps: Dependencies) {
  const owners = new Set<number>();
  return {
    async prepare(sender: Sender, input: unknown) {
      const data = preparation.parse(input);
      if (process.platform !== "win32" || !WINDOWS_SANDBOX_ENABLED || data.mode !== "standard") return { state: "skipped" as const };
      const project = deps.projectRootContaining(data.projectPath);
      if (!project || path.resolve(resolveHome(data.projectPath)) !== project) throw new Error("项目目录不可用，请重新打开项目");
      if (deps.deferProjectPrewarm?.(project)) return { state: "skipped" as const };
      if (!fs.statSync(project, { throwIfNoEntry: false })?.isDirectory()) throw new Error("项目目录不存在，请重新打开项目");
      const savedMode = data.sessionId && !data.sessionId.startsWith("__new_") ? deps.sessionMode(data.sessionId) ?? deps.defaultMode() : deps.defaultMode();
      if (normalizePermissionMode(savedMode) !== "standard" || (data.sessionId && deps.hasSessionPrewarm(data.sessionId))) return { state: "skipped" as const };
      if (sender.isDestroyed()) return { state: "skipped" as const };
      if (!owners.has(sender.id)) {
        owners.add(sender.id);
        sender.once("destroyed", () => { owners.delete(sender.id); void cancelWindowsDraftsForWindow(sender.id); });
      }
      try {
        await startWindowsDraftPrewarm(windowsDraftKey(sender.id, data.tabId), data.token, project, () => {
          if (!sender.isDestroyed()) sender.send("sandbox:draft-progress", { tabId: data.tabId, token: data.token, state: "stopping" });
        });
        return { state: "ready" as const };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return { state: "cancelled" as const };
        return { state: "failed" as const, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async cancel(sender: Sender, input: unknown) {
      const data = identity.parse(input);
      await cancelWindowsDraftPrewarm(windowsDraftKey(sender.id, data.tabId), data.token);
    },
  };
}
