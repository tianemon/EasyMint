import type { AgentSession } from "./pi-sdk";

/** Restore the previous branch after a multi-entry image edit failed. */
export function rollbackImageContextBranch(session: Pick<AgentSession, "sessionManager" | "refreshContext">, previousLeaf: string | null): boolean {
  const manager = session.sessionManager;
  try {
    if (previousLeaf === null) manager.resetLeaf();
    else manager.branch(previousLeaf);
    session.refreshContext();
    // A branch() choice is memory-only. Pin it so reopening follows the restored branch.
    manager.appendCustomEntry("em_rewind_pin", { reason: "image-edit-rollback", leaf: previousLeaf });
    session.refreshContext();
    return true;
  } catch (error) {
    console.error("[agent] 图片编辑回滚未能写盘:", error);
    // Keep this process on the original context even if disk persistence failed.
    try {
      if (previousLeaf === null) manager.resetLeaf();
      else manager.branch(previousLeaf);
      session.refreshContext();
    } catch (restoreError) {
      console.error("[agent] 图片编辑回滚未能恢复内存上下文:", restoreError);
    }
    return false;
  }
}
