/**
 * 增强 bash 工具 — 前台委托 Pi 原生实现,新增 background: true 后台执行
 *
 * 前台分支:直接调 createBashToolDefinition(cwd) 的原生 execute,
 * 行为零改动(同步执行 + tool_execution_update 实时流式输出)。
 * 后台分支:spawn 子进程注册到 BackgroundShellRegistry,立即返回
 * 「已后台启动」,不阻塞回合——对齐 Claude Code run_in_background。
 */

import type { ToolDefinition } from "../pi-sdk";
import { getCreateBashToolDefinition } from "../pi-sdk";
import { backgroundShellRegistry, type BackgroundShell } from "./registry";

export interface EnhancedBashOptions {
  /** 进程退出回调(agent-service 注入结果到主会话;缺省仅后台跑不通知) */
  onExit?: (shell: BackgroundShell) => void;
}

/** 输出尾部预览行数(通知精简:完整输出落盘,会话内只带尾部几行) */
const PREVIEW_TAIL_LINES = 10;

/** 后台命令退出 → 注入主会话的文本(⏺ 摘要行对齐委派通知渲染,前端按状态着色) */
export function formatShellResult(shell: BackgroundShell): string {
  const status = shell.stopped ? "中止" : (shell.exitCode === 0 ? "完成" : "失败");
  const dur = Math.max(0, Math.round((Date.now() - shell.startedAt) / 1000));
  const summary = `⏺ 后台命令 — ${status}${dur > 0 ? ` · ${dur}s` : ""}`;
  const head = `命令: ${shell.command}\n退出码: ${shell.exitCode ?? "?"}`;
  const tail = shell.output.trim().split("\n").slice(-PREVIEW_TAIL_LINES).join("\n").trim();
  const output = tail
    ? `输出(尾部 ${PREVIEW_TAIL_LINES} 行):\n${tail}`
    : "(无输出)";
  const logHint = `完整输出: ${shell.logPath}`;
  return `${summary}\n${head}\n${output}\n${logHint}`;
}

export async function createEnhancedBashTool(
  cwd: string,
  options?: EnhancedBashOptions,
): Promise<ToolDefinition> {
  const createBashToolDefinition = await getCreateBashToolDefinition();
  const native = createBashToolDefinition(cwd);

  return {
    name: "bash",
    label: "bash",
    description:
      "Execute a bash command in the current working directory. Returns stdout and stderr. "
      + "For long-running or service commands (dev server, watchers, background jobs), "
      + "pass background: true to run in the background without blocking the conversation — "
      + "the result will be injected back when the command exits.",
    promptSnippet: native.promptSnippet,
    promptGuidelines: native.promptGuidelines,
    parameters: {
      type: "object" as const,
      properties: {
        command: { type: "string" as const, description: "要执行的命令" },
        timeout: { type: "number" as const, description: "超时秒数(前台模式)" },
        background: {
          type: "boolean" as const,
          description: "true 时后台执行:立即返回,命令在后台运行,退出后结果注入会话",
        },
      },
      required: ["command"],
    },
    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate: any,
      ctx: any,
    ) {
      const command = String(params.command || "");
      if (!command) {
        return { content: [{ type: "text" as const, text: "请提供 command" }] };
      }

      // 前台:委托 Pi 原生实现(同步执行 + 流式输出,行为零改动)
      if (params.background !== true) {
        return native.execute(
          _toolCallId,
          { command, timeout: typeof params.timeout === "number" ? params.timeout : undefined },
          signal,
          onUpdate,
          ctx,
        ) as unknown as Promise<{ content: unknown[] }>;
      }

      // 后台:spawn + 注册,立即返回
      // 返回信息带输出文件路径(对齐 cc run_in_background)——模型从启动时就知道
      // 去哪读输出,运行中可随时 read,不必等退出通知
      const { id, logPath } = backgroundShellRegistry.start(command, cwd, options?.onExit);
      return {
        content: [{
          type: "text" as const,
          text: `已后台启动: ${command}\n后台 ID: ${id}\n输出文件: ${logPath}\n命令退出后结果将自动注入会话。`,
        }],
      };
    },
  } as unknown as ToolDefinition;
}
