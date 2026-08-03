/**
 * task.json 状态回写 — 委派完成/中止时自动更新任务状态(不再依赖手动 set_task_status)
 *
 * 对齐 set_task_status 的写回模式:读 → 找 id → 更新 → tmp 原子写 → 广播刷新。
 * 回写失败(文件缺失/id 不存在/解析错)只打日志不抛错——不影响委派收尾。
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { broadcast } from "../ipc-broadcast";

/** 回写 task.json 中某任务状态;成功返回 true */
export function writeTaskStatus(projectPath: string, taskId: string, status: string): boolean {
  if (!projectPath || !taskId) return false;
  const fp = join(projectPath, "task.json");
  if (!existsSync(fp)) {
    console.warn(`[task] writeTaskStatus: task.json not found ${fp}`);
    return false;
  }
  try {
    const data = JSON.parse(readFileSync(fp, "utf-8")) as { tasks?: Array<{ id: unknown; status?: string }> };
    const task = (data.tasks || []).find((t) => String(t.id) === String(taskId));
    if (!task) {
      console.warn(`[task] writeTaskStatus: task id=${taskId} not found`);
      return false;
    }
    task.status = status;
    const tmp = fp + ".tmp";
    writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tmp, fp);
    broadcast("agent:task-status", { taskId: String(taskId), status, projectPath });
    return true;
  } catch (e) {
    console.warn(`[task] writeTaskStatus failed: ${(e as Error).message}`);
    return false;
  }
}
