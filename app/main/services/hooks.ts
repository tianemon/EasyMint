/**
 * PreToolUse hooks — validate MCP tool calls before they execute.
 * These run in the main process (SDK hook system), not in the renderer.
 *
 * Rules enforced:
 * 1. set_task_status(?, "building") — no other tasks stuck in building/evaluating
 * 2. set_project_stage("done")       — all tasks must be done or failed
 * 3. set_task_status(id, "evaluating") — task must be building first
 * 4. set_task_status(id, "failed")     — task must be building or evaluating
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HookInput, HookJSONOutput, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

interface TaskRecord {
  id: number | string;
  title?: string;
  status?: string;
  passes?: boolean;
}

function readTasks(projectPath: string): { tasks: TaskRecord[]; path: string } | null {
  const tp = join(projectPath, "task.json");
  if (!existsSync(tp)) return null;
  try {
    const data = JSON.parse(readFileSync(tp, "utf-8"));
    return { tasks: (data.tasks || []) as TaskRecord[], path: tp };
  } catch {
    return null;
  }
}

function taskStatus(t: TaskRecord): string {
  return t.status || (t.passes ? "done" : "pending");
}

/**
 * Create a PreToolUse validator bound to a specific project directory.
 */
function deny(reason: string, context: string): HookJSONOutput {
  return {
    decision: "block",
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny" as const,
      permissionDecisionReason: reason,
      additionalContext: context,
    },
  };
}

function pass(): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse" as const,
    },
  };
}

export function createTaskStatusValidator(projectPath: string) {
  return async (
    input: HookInput,
    _toolUseID: string | undefined,
    _options: { signal: AbortSignal },
  ): Promise<HookJSONOutput> => {
    const hi = input as PreToolUseHookInput;
    const name = hi.tool_name;
    const args = hi.tool_input as Record<string, unknown> | undefined;
    if (!args) return pass();

    // ── set_task_status ──
    if (name === "mcp__easymint-ui__set_task_status") {
      const taskId = String(args.taskId ?? "");
      const status = String(args.status ?? "");

      if (status === "building") {
        const r = readTasks(projectPath);
        if (!r) return pass();
        const stuck = r.tasks.find(
          (t) =>
            String(t.id) !== taskId &&
            (taskStatus(t) === "building" || taskStatus(t) === "evaluating"),
        );
        if (stuck) {
          return deny(
            "有未完成的任务",
            `任务 ${stuck.id}（${stuck.title || "无标题"}）仍在 ${taskStatus(stuck)} 状态。` +
              `请先调 set_task_status(${stuck.id}, "done") 或 set_task_status(${stuck.id}, "failed") 标记最终状态，` +
              `再开始新任务。`,
          );
        }
        return pass();
      }

      if (status === "evaluating") {
        const r = readTasks(projectPath);
        if (!r) return pass();
        const target = r.tasks.find((t) => String(t.id) === taskId);
        if (target && taskStatus(target) !== "building") {
          return deny(
            "状态顺序错误",
            `任务 ${taskId} 当前状态是 ${taskStatus(target)}，不是 building。` +
              `必须先调 set_task_status(${taskId}, "building") 才能进入 evaluating。`,
          );
        }
        return pass();
      }

      if (status === "failed") {
        const r = readTasks(projectPath);
        if (!r) return pass();
        const target = r.tasks.find((t) => String(t.id) === taskId);
        if (target) {
          const cur = taskStatus(target);
          if (cur !== "building" && cur !== "evaluating") {
            return deny(
              "任务不在进行中",
              `任务 ${taskId} 当前状态是 ${cur}，只有 building 或 evaluating 的任务才能标记为 failed。` +
                `如果任务已完成，请调 set_task_status(${taskId}, "done")。`,
            );
          }
        }
        return pass();
      }

      // "done" / "pending" — no validation
      return pass();
    }

    // ── set_project_stage ──
    if (name === "mcp__easymint-ui__set_project_stage") {
      const stage = String(args.stage ?? "");
      if (stage !== "done") return pass();

      const r = readTasks(projectPath);
      if (!r || r.tasks.length === 0) return pass();

      const incomplete = r.tasks.filter(
        (t) => {
          const s = taskStatus(t);
          return s !== "done" && s !== "failed";
        },
      );
      if (incomplete.length > 0) {
        const ids = incomplete.map((t) => `#${t.id}`).join(", ");
        return deny(
          "有未完成的任务",
          `还有 ${incomplete.length} 个任务未完成（${ids}），不能标记项目为 done。` +
            `请先完成或标记这些任务为 failed，再调 set_project_stage("done")。`,
        );
      }
      return pass();
    }

    return pass();
  };
}
