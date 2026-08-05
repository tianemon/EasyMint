/**
 * 增强 edit 工具 — 让变更 diff 进入模型可见的返回文本。
 *
 * Pi 原生 edit 把 diff 放在 details.diff(仅 UI 渲染用),模型的 content 只有
 * "Successfully replaced N block(s)"——Mint 看不到改了哪些行。
 * 包装原生工具,执行后把 details.diff 追加进 content 文本返回。
 */

import type { ToolDefinition } from "./pi-sdk";
import { getCreateEditToolDefinition } from "./pi-sdk";

export async function createEnhancedEditTool(cwd: string): Promise<ToolDefinition> {
  const createEditToolDefinition = await getCreateEditToolDefinition();
  const native = createEditToolDefinition(cwd);

  return {
    ...native,
    name: "edit",
    label: "edit",
    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate: any,
      ctx: any,
    ) {
      const result = await native.execute(
        _toolCallId as any,
        params as any,
        signal,
        onUpdate,
        ctx,
      );
      // 把 diff 追加进模型可见文本(content),details 保留(UI 渲染仍用)
      const diff = (result as any).details?.diff as string | undefined;
      if (diff && result.content) {
        const text = (result.content as Array<{ type: string; text?: string }>)
          .filter((c) => c.type === "text")
          .map((c) => c.text || "")
          .join("\n");
        result.content = [
          { type: "text" as const, text: `${text}\n\n变更内容:\n${diff}` },
        ];
      }
      return result;
    },
  } as any as ToolDefinition;
}
