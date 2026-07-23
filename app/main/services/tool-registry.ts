/**
 * 工具注册 — 基于 Pi SDK defineTool() / createCodingTools
 *
 * 通过 pi-sdk wrapper 懒加载 Pi SDK
 */

import type { ToolDefinition } from "./pi-sdk";
import { getCreateCodingTools, getCreateReadOnlyTools } from "./pi-sdk";

/** 返回基础 coding 工具列表（read/write/edit/bash/grep/glob） */
export async function getBaseTools(cwd: string): Promise<ToolDefinition[]> {
  const fn = await getCreateCodingTools();
  return fn(cwd);
}

/** 返回只读工具列表 */
export async function getReadOnlyTools(cwd: string): Promise<ToolDefinition[]> {
  const fn = await getCreateReadOnlyTools();
  return fn(cwd);
}
