/** Append the native edit diff without dropping images or other SDK result fields. */
import type { ToolDefinition } from "./pi-sdk";
import { getCreateEditToolDefinition, getDefineToolFn } from "./pi-sdk";

export async function createEnhancedEditTool(cwd: string): Promise<ToolDefinition> {
  const createEditToolDefinition = await getCreateEditToolDefinition();
  const defineTool = await getDefineToolFn();
  const native = createEditToolDefinition(cwd);
  return defineTool({
    ...native,
    name: "edit",
    label: "edit",
    description: `${native.description}\n本工具编辑文件，不编辑聊天气泡；用户消息上的铅笔是界面功能。用户说上条edit改错时，先核对所指文件并修正，不把界面操作当作文件修改。`,
    async execute(...args: Parameters<typeof native.execute>) {
      const result = await native.execute(...args), diff = result.details?.diff;
      if (!diff) return result;
      return { ...result, content: [...result.content, { type: "text" as const, text: `变更内容:\n${diff}` }] };
    },
  });
}
