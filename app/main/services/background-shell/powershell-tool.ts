/** Windows PowerShell 工具的受保护执行替换。 */
import type { ToolDefinition } from "../pi-sdk";
import { getCreateExtraBuiltinTools } from "../pi-sdk";
import { executeForeground } from "./tool";
import { ensureSandbox, isSandboxBypassedForMode, wrapForSandbox } from "../sandbox/manager";
import { EXECUTION_POLICY } from "../permission/wrap-tool";
import { createExecutionContext, type ExecutionContext } from "../permission/execution-context";

export async function createEnhancedPowerShellTool(cwd: string): Promise<ToolDefinition> {
  const { createPowerShellToolDefinition } = await getCreateExtraBuiltinTools();
  const native = createPowerShellToolDefinition(cwd);
  return {
    ...native,
    async execute(_toolCallId: string, params: Record<PropertyKey, unknown>, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
      const command = String(params.command ?? "");
      if (!command.trim()) return { content: [{ type: "text" as const, text: "请提供 command" }], details: {} };
      const context = params[EXECUTION_POLICY] as ExecutionContext | undefined
        ?? createExecutionContext(cwd, "standard");
      // 关沙盒只换执行后端：wrapForSandbox 两条分支都返回带 env 的规格，一律由它产出执行目标。
      const sandboxed = !isSandboxBypassedForMode(context.mode);
      if (sandboxed) {
        const initialized = await ensureSandbox(context.workspaceRealPath, context.mode);
        if (!initialized.ok) return { content: [{ type: "text" as const, text: `系统保护初始化失败：${initialized.reason}` }], details: {} };
      }
      try {
        const wrapped = await wrapForSandbox(command, { context, windowsShell: "powershell", signal });
        if (wrapped.kind !== "argv") throw new Error("PowerShell 只在 Windows 受保护执行环境中可用");
        const result = await executeForeground(
          { argv: wrapped.argv, env: wrapped.env, release: wrapped.release, violationKey: wrapped.violationKey, exemptReason: wrapped.exemptReason },
          context.workspaceRealPath,
          signal,
          typeof params.timeout === "number" ? params.timeout : undefined,
          ctx,
          onUpdate,
        );
        return { ...result, details: {} };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `PowerShell 执行失败：${(error as Error).message}` }], details: {} };
      }
    },
  } as ToolDefinition;
}
