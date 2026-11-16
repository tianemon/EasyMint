/**
 * 工具结果与工具定义的统一入口。
 *
 * 为什么需要：SDK 的 `AgentToolResult` 要求 `details` 必填、`content` 的 type 是字面量，
 * 而手写工具对象时这两点都容易漏，之前的做法是 `as any) as ToolDefinition` 把问题藏起来。
 * 这里把"补 details + 收敛 content"收口到一处，新增工具只写业务、不再各写各的返回形状。
 */
import type { ToolDefinition } from "../pi-sdk";

export type TextItem = { type: "text"; text: string };
export type ToolResult = { content: TextItem[]; details: unknown };

/** 纯文本结果（最常用）。 */
export const ok = (text: string, details: unknown = undefined): ToolResult => ({ content: [{ type: "text", text }], details });

type LooseExecute = (...args: any[]) => Promise<{ content: any[]; details?: unknown }>;
type LooseTool = {
  readonly name: string;
  readonly execute: LooseExecute;
  readonly [key: string]: unknown;
};

/**
 * 统一工具定义：把 execute 的返回值补齐 details，并断言一次类型。
 * 断言只在这里出现，新增工具用 `defineTool({...})` 即可，编译期仍会检查除 execute
 * 之外的所有字段（name / label / description / parameters）。
 */
export function defineTool(tool: LooseTool): ToolDefinition {
  const execute: LooseExecute = async (...args) => {
    const result = await tool.execute(...args);
    return { content: result.content as TextItem[], details: result.details ?? undefined };
  };
  return { ...tool, execute } as unknown as ToolDefinition;
}
