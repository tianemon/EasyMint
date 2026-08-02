/**
 * 委派记录表 — task 工具异步执行的核心
 *
 * tool.execute 创建委派记录后立即返回（不阻塞 Mint 模型循环），
 * executor 后台执行子 Agent，完成后 resolve completion，
 * agent-service 订阅 completion 向主会话注入结果。
 *
 * 纯模块：不依赖 agent-service / 前端，只依赖 types。
 */

import { randomUUID } from "node:crypto";
import type { BatchResult, DelegationRecord, DelegationStatus, TaskItem } from "./types";

/** 主会话的 EM 临时 ID（新建会话时 task 工具绑定的 ID;真实 ID 回填后保留作双匹配） */
export const TEMP_ID_FIELD = "tempParentSessionId";

const delegations = new Map<string, DelegationRecord>();

/** 保留最近 N 条已完成记录（供查询/调试），超出清理 */
const MAX_KEEP = 50;

/** 创建委派记录：立即返回，后台执行器随后启动 */
export function createDelegation(
  parentSessionId: string,
  tasks: TaskItem[],
  /** 原始 ID（新会话 = 临时 UUID;缺省同 parentSessionId）。steer/abort 按它双匹配 */
  rawParentSessionId?: string,
): DelegationRecord {
  const abortController = new AbortController();
  let resolveCompletion!: (result: BatchResult) => void;
  const completion = new Promise<BatchResult>((resolve) => { resolveCompletion = resolve; });

  const record: DelegationRecord = {
    delegationId: randomUUID(),
    parentSessionId,
    tempParentSessionId: rawParentSessionId ?? parentSessionId,
    childSessionIds: [],
    status: "running",
    tasks,
    startedAt: Date.now(),
    completion,
    resolveCompletion,
    abortController,
    abort: () => {
      if (record.status !== "running") return;
      abortController.abort();
      // 等执行器把 status 更新为 aborted 并 resolve
    },
  };

  delegations.set(record.delegationId, record);
  prune();
  return record;
}

export function getDelegation(delegationId: string): DelegationRecord | undefined {
  return delegations.get(delegationId);
}

/** 临时 ID → 真实 ID 映射（createPiSession 返回后注册；委派创建时解析） */
const tempIdToRealId = new Map<string, string>();

/** createPiSession 返回后注册映射（新会话:临时 UUID → Pi 真实 ID） */
export function registerSessionIdMapping(tempId: string, realId: string): void {
  if (tempId === realId) return;
  tempIdToRealId.set(tempId, realId);
}

/** 解析为真实主会话 ID（无映射则原样返回,如恢复会话直接是真实 ID） */
export function resolveParentSessionId(id: string): string {
  return tempIdToRealId.get(id) ?? id;
}

/** 某主会话名下所有运行中的委派（用户 steer 打断时用；临时/真实 ID 双匹配） */
export function getRunningDelegations(sessionId: string): DelegationRecord[] {
  const out: DelegationRecord[] = [];
  for (const r of delegations.values()) {
    if (r.status !== "running") continue;
    if (r.parentSessionId === sessionId || r.tempParentSessionId === sessionId) out.push(r);
  }
  return out;
}

/** 中止某主会话的全部运行中委派（调用各子会话 abort） */
export function abortDelegations(parentSessionId: string): number {
  const running = getRunningDelegations(parentSessionId);
  for (const r of running) r.abort();
  return running.length;
}

/** 执行器完成时调用：更新状态并 resolve completion */
export function finishDelegation(
  record: DelegationRecord,
  status: Exclude<DelegationStatus, "running">,
  payload: { result?: BatchResult; error?: string } = {},
): void {
  if (record.status !== "running") return;
  record.status = status;
  record.completedAt = Date.now();
  if (payload.result) record.result = payload.result;
  if (payload.error) record.error = payload.error;
  // resolve 最终结果：aborted/failed 也返回空结果结构（或带 error）
  const result: BatchResult = payload.result ?? {
    results: [],
    totalDurationMs: (record.completedAt ?? Date.now()) - record.startedAt,
    aborted: status === "aborted",
  };
  record.resolveCompletion(result);
}

/** 清理超出上限的已完成记录（FIFO） */
function prune(): void {
  if (delegations.size <= MAX_KEEP) return;
  const finished = [...delegations.values()]
    .filter((r) => r.status !== "running")
    .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
  const excess = delegations.size - MAX_KEEP;
  for (const r of finished.slice(0, excess)) delegations.delete(r.delegationId);
}

/** 测试用：清空 */
export function resetRegistry(): void {
  delegations.clear();
}
