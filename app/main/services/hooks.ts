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

/** 规则 ①③④: building / evaluating / failed 状态变更校验 */
export function validateTaskStatus(projectPath: string | undefined, taskId: string, newStatus: string): string | null {
  if (!projectPath) return null;
  const tasks = readTasks(projectPath);
  const target = tasks.find((t) => String(t.id) === String(taskId));
  if (!target) return `未找到 id=${taskId} 的任务`;

  // ① building: 不能有其他任务在 building 或 evaluating
  if (newStatus === "building") {
    const stuck = tasks.find((t) => String(t.id) !== String(taskId) && (t.status === "building" || t.status === "evaluating"));
    if (stuck) return `不能同时有两个进行中的任务。请先把任务 ${stuck.id}（${stuck.title || ""}）标记为 done 或 failed。`;
  }
  // ③ evaluating: 目标必须 building
  if (newStatus === "evaluating" && target.status !== "building") {
    return `任务 ${taskId} 必须先标记为 building 才能进入 evaluating，当前状态: ${target.status}。`;
  }
  // ④ failed: 目标必须 building 或 evaluating
  if (newStatus === "failed" && target.status !== "building" && target.status !== "evaluating") {
    return `只能将 building/evaluating 状态的任务标记为 failed，当前状态: ${target.status}。`;
  }
  return null;
}

