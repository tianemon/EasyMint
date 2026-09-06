/**
 * wrapToolWithPermission — 在每个工具 execute 前做权限拦截
 *
 * 移植自 Proma pi-agent-adapter.ts:721-755
 */

import type { PermissionResult } from "./agent-permission-service";

export interface ToolWrapOptions {
  canUseTool?: (
    toolName: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal; toolUseID: string; displayName?: string; description?: string },
  ) => Promise<PermissionResult>;
}

function displayToolName(name: string, input: Record<string, unknown>): string {
  if (name === "Bash") {
    const cmd = typeof input.command === "string" ? input.command : "?";
    return cmd.length > 40 ? `Bash(${cmd.slice(0, 40)}…)` : `Bash(${cmd})`;
  }
  if (name === "write" || name === "Write") {
    const fp = typeof input.file_path === "string" ? input.file_path : "?";
    return `Write(${fp})`;
  }
  if (name.startsWith("mcp__")) {
    return name.replace(/^mcp__/, "").split("__").join(" / ");
  }
  return name;
}

export function wrapToolWithPermission<T extends { name: string; label?: string; description?: string; execute: (...args: any[]) => any }>(
  definition: T,
  options: ToolWrapOptions,
): T {
  const { canUseTool } = options;
  if (!canUseTool) return definition;

  const originalExecute = definition.execute as (...args: any[]) => any;

  return {
    ...definition,
    async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) {
      const rawInput = params as Record<string, unknown>;
      const permission = await canUseTool(
        definition.name,
        rawInput,
        {
          signal: signal ?? new AbortController().signal,
          toolUseID: toolCallId,
          displayName: displayToolName(definition.name, rawInput),
          description: definition.description,
        },
      );
      if (permission.behavior === "deny") {
        throw new Error(permission.message || "操作被拒绝");
      }
      // allow 可携带 updatedInput（如沙盒执行标记 sandbox: true）——合并后传给工具 execute。
      // EM 权限在自研 wrap 层（非 SDK 机制），此处是标记的唯一传递通道。
      const updated = (permission as { updatedInput?: Record<string, unknown> }).updatedInput;
      const finalParams = updated ? { ...rawInput, ...updated } : params;
      return originalExecute.call(definition, toolCallId, finalParams, signal, onUpdate, ctx);
    },
  };
}
