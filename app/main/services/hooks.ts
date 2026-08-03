/**
 * 工具执行前校验 — set_task_status 的状态一致性规则
 *
 * 原版 EM 通过 Claude SDK 的 PreToolUse hook 实现。Pi 不支持 hooks，
 * 改为在工具 execute 内调用校验函数。校验逻辑集中在此文件。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface TaskRecord { id: number | string; status?: string; title?: string }

function readTasks(projectPath: string): TaskRecord[] {
  const filePath = join(projectPath, "task.json");
  if (!existsSync(filePath)) return [];
  try { return (JSON.parse(readFileSync(filePath, "utf-8")).tasks || []) as TaskRecord[]; }
  catch { return []; }
}

/** 状态变更校验(并行友好 + 终态自动维护) */
export function validateTaskStatus(projectPath: string | undefined, taskId: string, newStatus: string): string | null {
  if (!projectPath) return null;
  const tasks = readTasks(projectPath);
  const target = tasks.find((t) => String(t.id) === String(taskId));
  if (!target) return `未找到 id=${taskId} 的任务`;

  // done: 由委派执行结果自动回写,不手动标记
  if (newStatus === "done") {
    return `任务 ${taskId} 的 done 状态由委派执行结果自动回写,无需手动标记。`;
  }
  // building: 支持并行(多个任务可同时进行中,契合批量委派)
  // evaluating: 目标必须 building
  if (newStatus === "evaluating" && target.status !== "building") {
    return `任务 ${taskId} 必须先标记为 building 才能进入 evaluating，当前状态: ${target.status}。`;
  }
  // failed: 目标必须 building 或 evaluating(或由委派结果自动回写)
  if (newStatus === "failed" && target.status !== "building" && target.status !== "evaluating") {
    return `只能将 building/evaluating 状态的任务标记为 failed，当前状态: ${target.status}。`;
  }
  return null;
}

