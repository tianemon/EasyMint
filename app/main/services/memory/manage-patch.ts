/**
 * 记忆管理动作 → 更新补丁。
 *
 * 单独成函数的原因：这段映射原来内联在 `manageFromAgent` 里，三元链嵌套后
 * 既难读也没法单测（需要整套 service 夹具）。抽出来后可对每个动作逐一断言。
 */
import type { MemoryRecord, MemoryWrite } from "../../../shared/memory";

export type ManageAction = "edit" | "archive" | "restore" | "cancel";

export type ManagePatch = Partial<MemoryWrite> &
  Partial<Pick<MemoryRecord, "lifecycle">> & {
    cancelPending?: boolean;
    unmerge?: boolean;
    reason?: string;
    summary?: string;
    expiresAt?: number | null;
    effectiveAt?: number | null;
  };

export function managePatch(action: ManageAction, prior: MemoryRecord, input?: MemoryWrite, now = Date.now()): ManagePatch {
  if (action === "cancel") return { cancelPending: true };
  if (action === "edit") {
    if (!input) throw new Error("整理编辑需要新的结论");
    return input;
  }
  if (action === "archive") return { lifecycle: "archived", reason: "用户收进历史", summary: "" };
  // restore：解除合并、恢复生命周期，并把"已过期／未到生效"的调度清掉
  return {
    unmerge: true,
    lifecycle: prior.kind === "activity" ? "archived" : "active",
    reason: "用户明确恢复",
    ...(prior.expiresAt !== undefined && prior.expiresAt <= now ? { expiresAt: null } : {}),
    ...(prior.effectiveAt !== undefined && prior.effectiveAt > now ? { effectiveAt: null } : {}),
  };
}
