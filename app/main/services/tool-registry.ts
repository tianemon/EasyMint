/**
 * 工具注册 — 基于 Pi SDK defineTool() / createCodingTools
 *
 * 步骤三：只用 Pi 内置的基础工具（read/write/edit/bash/grep/glob）
 * 步骤五：追加 EM 产品工具（show_confirm_dev, set_task_status 等）
 *
 * 参考：Proma pi-builtin-tools.ts + pi-agent-adapter.ts
 */

import {
  createCodingTools,
  createReadOnlyTools,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

/** 返回基础 coding 工具列表（read/write/edit/bash/grep/glob） */
export function getBaseTools(cwd: string): ToolDefinition[] {
  return createCodingTools(cwd);
}

/** 返回只读工具列表（read/grep/glob/ls），用于受限场景 */
export function getReadOnlyTools(cwd: string): ToolDefinition[] {
  return createReadOnlyTools(cwd);
}
