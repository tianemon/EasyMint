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
  // restore：正文不复制留史，需要回查来源后带入凝练正文。
  if(!prior.text && !input?.text)throw new Error("请先回查来源，再提供恢复正文");
  if(input && input.kind!==prior.kind)throw new Error("恢复须保留原记忆类型");
  return {
    ...input,
    lifecycle: "active",
    reason: "用户明确恢复",
    ...(prior.expiresAt !== undefined && prior.expiresAt <= now ? { expiresAt: null } : {}),
    ...(prior.effectiveAt !== undefined && prior.effectiveAt > now ? { effectiveAt: null } : {}),
  };
}
