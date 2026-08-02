/**
 * task 工具 — Mint 的子 Agent 执行引擎
 *
 * 对标 Claude Code 的 Task 工具。Mint 自主决定子 Agent 的任务描述和工具范围，
 * 不依赖预定义模板。agent-templates.ts 中的模板（如 builder）是可选捷径。
 */

import type { ToolDefinition } from "../pi-sdk";
import { getDefineToolFn } from "../pi-sdk";
import { Store } from "../store";
import { getTemplate } from "../agent-templates";
import { runSubagents } from "./executor";
import { createDelegation, resolveParentSessionId, getRunningSummary } from "./registry";
import { broadcast } from "../ipc-broadcast";
import type { TaskItem, BatchResult, AgentProgress } from "./types";

export interface TaskToolContext {
  cwd: string;
  agentDir: string;
  store: Store;
  /** 发起委派的主会话 ID（buildExtraTools 创建工具时绑定；steer 打断时按它 abort） */
  parentSessionId: string;
  /** 会话 chatId（进度广播按它过滤,前端只显示当前窗口的委派） */
  chatId?: string;
  /** 委派完成回调：结果注入主会话（agent-service 提供） */
  onComplete?: (parentSessionId: string, text: string) => void;
}

/** BatchResult → 注入主会话的文本 */
function formatDelegationResult(result: BatchResult): string {
  // 摘要段:每任务一行(● 标题 — 状态 · 耗时),前端按此渲染绿色结果气泡
  const summary: string[] = [];
  if (result.aborted) summary.push("(委派被中止)");
  for (const r of result.results) {
    const status = r.error ? "失败" : (r.aborted ? "中止" : "完成");
    const title = r.title || r.task.slice(0, 40);
    const dur = r.durationMs ? ` · ${Math.round(r.durationMs / 1000)}s` : "";
    summary.push(`● ${title} — ${status}${dur}`);
  }
  if (result.results.length > 1) {
    const ok = result.results.filter((r) => !r.error && !r.aborted).length;
    summary.unshift(`共 ${result.results.length} 个子任务: ${ok} 成功, ${result.results.length - ok} 失败`);
  }
  // 详细段:Mint 汇报用(前端只渲染 ● 摘要行)
  const detail: string[] = [];
  for (const r of result.results) {
    const title = r.title || r.task.slice(0, 40);
    if (r.error) detail.push(`${title}: 错误 ${r.error}`);
    if (r.output) detail.push(`${title}:\n${r.output.slice(0, 2000)}`);
    if (r.structuredOutput?.status === "valid" && r.structuredOutput.data) {
      detail.push(`结构化结果: ${JSON.stringify(r.structuredOutput.data)}`);
    }
  }
  const parts = [summary.join("\n")];
  if (detail.length > 0) parts.push("详细结果:", detail.join("\n---\n"));
  return parts.join("\n").trim() || "(无输出)";
}

export async function createTaskTool(ctx: TaskToolContext): Promise<ToolDefinition> {
  const defineTool = await getDefineToolFn();

  return defineTool({
    name: "task",
    label: "委派子 Agent",
    description:
      "创建一个独立的子 Agent 来完成指定任务。子 Agent 拥有独立的会话上下文和工具集，"
      + "执行完毕后返回结果。"
      + "使用场景：① 实现功能模块 ② 修复 bug ③ 重构代码 ④ 验收变更 ⑤ 研究技术方案。"
      + "支持同时委派多个子 Agent 并行执行（tasks 数组）。"
      + "如需使用预设模板（如 builder），将 agent 参数设为模板名。",
    parameters: {
      type: "object" as const,
      properties: {
        agent: {
          type: "string" as const,
          description: "可选的 Agent 模板名（如 builder、evaluator），省略则 Mint 自己描述任务",
        },
        description: {
          type: "string" as const,
          description: "任务简述（单任务模式），如「实现用户注册功能」",
        },
        prompt: {
          type: "string" as const,
          description: "详细任务指令（单任务模式），相当于子 Agent 的 system prompt 追加内容",
        },
        outputSchema: {
          type: "object" as const,
          description: "子 Agent 结构化输出格式，如 { files_changed: [\"string\"], test_results: \"string\" }。子 Agent 必须调 yield 工具按此格式返回结果",
        },
        tasks: {
          type: "array" as const,
          items: {
            type: "object" as const,
            properties: {
              description: { type: "string" as const },
              prompt: { type: "string" as const },
              agent: { type: "string" as const },
              outputSchema: { type: "object" as const },
            },
            required: ["description"],
          },
          description: "批量任务列表（批量模式），每个任务可指定不同的 Agent 模板和详细指令",
        },
        readOnly: {
          type: "boolean" as const,
          description: "是否为只读模式（用于验收/审查场景），默认 false",
        },
        concurrency: {
          type: "number" as const,
          description: "批量模式的并发数，默认 4",
        },
      },
    },
    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      _onUpdate: any,
      _ctx: any,
    ) {
      const readOnly = params.readOnly === true;
      const tasks: TaskItem[] = [];

      if (Array.isArray(params.tasks) && params.tasks.length > 0) {
        for (const t of params.tasks as Array<Record<string, unknown>>) {
          const agentName = (t.agent as string) || params.agent as string || undefined;
          const prompt = buildPrompt(
            (t.description as string) || "",
            (t.prompt as string) || "",
            agentName,
          );
          tasks.push({
            agent: agentName,
            task: prompt,
            title: (t.description as string) || undefined,
            readOnly,
            outputSchema: (t.outputSchema as unknown) || undefined,
          });
        }
      } else {
        const desc = (params.description as string) || (params.prompt as string) || "";
        if (!desc) {
          return { content: [{ type: "text" as const, text: "请提供 description 或 prompt 描述子 Agent 的任务" }] };
        }
        tasks.push({
          agent: params.agent as string | undefined,
          task: buildPrompt(desc, (params.prompt as string) || "", params.agent as string | undefined),
          title: desc,
          readOnly,
          outputSchema: (params.outputSchema as unknown) || undefined,
        });
      }

      // 异步委派（对齐 cc 实测行为）：execute 立即返回,子 Agent 后台执行,
      // 完成结果经 onComplete 回调注入主会话(agent-service → injectSystemMessage)
      // 新会话工具绑定的可能是临时 UUID——解析为 Pi 真实 ID,子会话目录按真实 ID 分级;
      // rawParentSessionId 保留原始 ID(steer/abort 双匹配)
      const record = createDelegation(
        resolveParentSessionId(ctx.parentSessionId),
        tasks,
        ctx.parentSessionId,
      );

      // 用户点打断（Pi abort 当前回合）→ 中止子 Agent 委派 → completion resolve(aborted)
      if (signal && !signal.aborted) {
        signal.addEventListener("abort", () => record.abort(), { once: true });
      }

      // 进度广播：executor 每 200ms 节流回调 → 前端委派进度卡片实时更新
      const broadcastProgress = (progress: AgentProgress): void => {
        broadcast("agent:delegation-progress", {
          chatId: ctx.chatId,
          delegationId: record.delegationId,
          progress,
        });
      };

      runSubagents(record, {
        cwd: ctx.cwd,
        agentDir: ctx.agentDir,
        store: ctx.store,
        concurrency: (params.concurrency as number) || undefined,
        onProgress: broadcastProgress,
      }).catch(() => {});

      // 完成回调：结果注入主会话(不阻塞本工具)
      record.completion.then((result) => {
        ctx.onComplete?.(record.parentSessionId, formatDelegationResult(result));
      }).catch(() => {});

      // 委派计数广播(ProcessBar 显示 agent·N)——创建和结束时各广播一次
      const broadcastCount = (): void => {
        broadcast("agent:delegation-count", getRunningSummary());
      };
      broadcastCount();
      record.completion.then(broadcastCount).catch(() => {});

      const n = tasks.length;
      return {
        content: [{ type: "text" as const, text: `已启动 ${n} 个子 Agent 执行，完成后结果将注入会话。` }],
      };
    },
  } as any) as ToolDefinition;
}

function buildPrompt(description: string, prompt: string, agentName: string | undefined): string {
  const parts: string[] = [];
  if (agentName) {
    const tpl = getTemplate(agentName);
    if (tpl) {
      parts.push(tpl.prompt);
      parts.push("");
    }
  }
  parts.push(`## 任务: ${description}`);
  if (prompt) {
    parts.push("");
    parts.push(prompt);
  }
  return parts.join("\n");
}
