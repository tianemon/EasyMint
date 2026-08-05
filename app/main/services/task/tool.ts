/**
 * task 工具 — Mint 的子 Agent 执行引擎
 *
 * 对标 Claude Code 的 Task 工具。Mint 自主决定子 Agent 的任务描述和工具范围，
 * 不依赖预定义模板。agent-templates.ts 中的模板（如 builder）是可选捷径。
 */

import type { ToolDefinition } from "../pi-sdk";
import { getDefineToolFn } from "../pi-sdk";
import { Store } from "../store";
import { getTemplate, listTemplates } from "../agent-templates";
import { runSubagents } from "./executor";
import { createDelegation, resolveParentSessionId, getRunningSummary, setTaskStatus } from "./registry";
import { writeTaskStatus } from "./task-file";
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
  /** 单任务被用户停止回调：立即注入中止通知（不等整个委派完成）。
      triggerTurn: 单任务委派被停止时 true(无后续,开回合让 Mint 回应);批量中停止单个 false */
  onTaskAborted?: (parentSessionId: string, text: string, triggerTurn?: boolean) => void;
  /** 单任务提前完成回调：委派还有任务在跑时立即注入完成通知(对齐 cc 逐个通知) */
  onTaskCompleted?: (parentSessionId: string, text: string) => void;
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
    summary.push(`⏺ ${title} — ${status}${dur}`);
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

  // 动态生成 agent 参数描述:列出所有可用模板(名称+职责+模型),Mint 可见可选
  const templates = listTemplates();
  const agentDesc = templates.length > 0
    ? "可选 Agent 模板:\n" + templates.map((t) => {
        const modelInfo = t.model ? `(${t.model})` : t.provider ? `(供应商:${t.provider})` : "";
        return `  - ${t.id}: ${t.name}——${t.description}${modelInfo ? " " + modelInfo : ""}`.trim();
      }).join("\n")
        + "\n选择适合任务的模板;省略则不指定模板,创建标准子 Agent(无模板人设)。"
    : "可选模板名: builder(编码)、evaluator(验收)。";

  return defineTool({
    name: "task",
    label: "委派子 Agent",
    description:
      "创建一个独立的子 Agent 来完成指定任务。子 Agent 拥有独立的会话上下文和工具集，"
      + "执行完毕后返回结果。"
      + "使用场景：① 实现功能模块 ② 修复 bug ③ 重构代码 ④ 验收变更 ⑤ 研究技术方案。"
      + "支持同时委派多个子 Agent 并行执行（tasks 数组）。"
      + agentDesc,
    promptSnippet: "委派子 Agent 执行任务（默认无模板白板，可指定 builder/evaluator 等模板）",
    promptGuidelines: [
      "需要子 Agent 干活（写代码/验收/查资料/研究）时用 task 委派，不要自己动手（决策树 ① 的极简情况除外）",
      "通用任务（查资料、读代码、分析）省略 agent 参数，用默认白板子 Agent；特定角色（写代码→builder、验收→evaluator、UI 设计→mint-designer 等）才指定 agent",
      "开发类任务用 taskId 关联 task.json 任务，完成/失败自动回写状态，不要手动标记",
    ],
    parameters: {
      type: "object" as const,
      properties: {
        agent: {
          type: "string" as const,
          description: "可选的 Agent 模板名(如 builder、evaluator),省略则创建标准子 Agent(无模板人设)",
        },
        model: {
          type: "string" as const,
          description: "可选的模型 id(如 deepseek-v4-flash),委派子 Agent 用此模型(优先于模板/默认)",
        },
        provider: {
          type: "string" as const,
          description: "可选的供应商 piId(如 deepseek),与 model 搭配指定",
        },
        description: {
          type: "string" as const,
          description: "任务简述（单任务模式），如「实现用户注册功能」",
        },
        prompt: {
          type: "string" as const,
          description: "详细任务指令（单任务模式），相当于子 Agent 的 system prompt 追加内容",
        },
        taskId: {
          type: "string" as const,
          description: "关联的 task.json 任务 id——委派完成/中止时自动回写该任务状态(done/failed),任务面板实时同步",
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
              model: { type: "string" as const, description: "可选模型 id" },
              provider: { type: "string" as const, description: "可选供应商 piId" },
              taskId: { type: "string" as const, description: "关联的 task.json 任务 id(完成/中止自动回写状态)" },
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
      // agent 模板名;兼容旧提示词的 subagent_type 别名(双保险)
      const agentName = (params.agent as string) || (params.subagent_type as string) || undefined;
      const tasks: TaskItem[] = [];

      if (Array.isArray(params.tasks) && params.tasks.length > 0) {
        for (const t of params.tasks as Array<Record<string, unknown>>) {
          const taskAgent = (t.agent as string) || agentName;
          const prompt = buildPrompt(
            (t.description as string) || "",
            (t.prompt as string) || "",
            taskAgent,
          );
          tasks.push({
            agent: taskAgent,
            task: prompt,
            title: (t.description as string) || undefined,
            description: (t.description as string) || undefined,
            prompt: (t.prompt as string) || undefined,
            taskId: (t.taskId as string) || undefined,
            readOnly,
            outputSchema: (t.outputSchema as unknown) || undefined,
            model: (t.model as string) || undefined,
            provider: (t.provider as string) || undefined,
          });
        }
      } else {
        const desc = (params.description as string) || (params.prompt as string) || "";
        if (!desc) {
          return { content: [{ type: "text" as const, text: "请提供 description 或 prompt 描述子 Agent 的任务" }] };
        }
        tasks.push({
          agent: agentName,
          task: buildPrompt(desc, (params.prompt as string) || "", agentName),
          title: desc,
          description: desc,
          prompt: (params.prompt as string) || undefined,
          taskId: (params.taskId as string) || undefined,
          readOnly,
          outputSchema: (params.outputSchema as unknown) || undefined,
          model: (params.model as string) || undefined,
          provider: (params.provider as string) || undefined,
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

      // 委派创建即广播任务清单(全部任务,含并发排队中未启动的):
      // 前端进度卡片按此初始化全部行(pending),后续 progress 按 index 更新状态——
      // 否则并发受限(默认 4)时初始只显示前 N 个,排队的任务要等启动才出现
      broadcast("agent:delegation-init", {
        chatId: ctx.chatId,
        delegationId: record.delegationId,
        tasks: record.tasks.map((t, i) => ({
          index: i,
          agent: t.agent || "coder",
          status: "pending" as const,
          task: t.task,
          title: t.title || (t.task.split("\n")[0] ?? "").replace(/^##\s*任务[:：]\s*/, "").slice(0, 60),
          description: t.description,
          prompt: t.prompt,
        })),
      });

      // 用户点打断（Pi abort 当前回合）→ 中止子 Agent 委派 → completion resolve(aborted)
      if (signal && !signal.aborted) {
        signal.addEventListener("abort", () => record.abort(), { once: true });
      }

      // 终态通知去重:节流定时器二次触发时 progress 已是终态,防重复注入
      const notifiedTerminal = new Set<string>();

      // 进度广播：executor 每 200ms 节流回调 → 前端委派进度卡片实时更新
      const broadcastProgress = (progress: AgentProgress): void => {
        // 回写任务状态(AgentBar 列表按 running 过滤——停止后立即消失)
        setTaskStatus(record.delegationId, progress.index, progress.status);
        // 逐任务即时回写 task.json:任务一进入终态立即 done/failed,
        // 不等委派整体收尾(TaskPanel 单行即时变绿)
        if (progress.taskId && progress.status !== "running" && progress.status !== "pending") {
          const ok = progress.status === "completed" && !progress.retryFailure;
          writeTaskStatus(ctx.cwd, progress.taskId, ok ? "done" : "failed");
        }
        // 任务离开 running(完成/中止/失败)→ 同步刷新 AgentBar 运行中列表
        if (progress.status !== "running") broadcastCount();
        // 单任务被用户停止(非整体中止)→ 立即注入中止通知,不等委派收尾
        if (progress.status === "aborted" && !record.abortController.signal.aborted) {
          const key = `${progress.index}-aborted`;
          if (!notifiedTerminal.has(key)) {
            notifiedTerminal.add(key);
            const title = record.tasks[progress.index]?.title || progress.task.slice(0, 40);
            const dur = Math.max(0, Math.round(progress.durationMs / 1000));
            // 单任务委派被停止:无后续通知,开回合让 Mint 回应;批量中停止单个不开回合
            ctx.onTaskAborted?.(record.parentSessionId, `⏺ ${title} — 中止${dur > 0 ? ` · ${dur}s` : ""}`, record.tasks.length === 1);
          }
        }
        // 单任务提前完成(委派还有任务在跑)→ 立即注入完成通知,Mint 判断继续等待
        if (progress.status === "completed" && !record.abortController.signal.aborted) {
          const stillRunning = record.taskStatuses.some((s) => s === "running" || s === "pending");
          if (stillRunning) {
            const key = `${progress.index}-completed`;
            if (!notifiedTerminal.has(key)) {
              notifiedTerminal.add(key);
              const title = record.tasks[progress.index]?.title || progress.task.slice(0, 40);
              const dur = Math.max(0, Math.round(progress.durationMs / 1000));
              ctx.onTaskCompleted?.(record.parentSessionId, `⏺ ${title} — 完成${dur > 0 ? ` · ${dur}s` : ""}`);
            }
          }
        }
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
        // 单任务委派被用户停止:即时中止通知已发,汇总无增量信息,跳过(避免重复)
        const singleTaskAborted = record.tasks.length === 1
          && result.results[0]?.aborted
          && !record.abortController.signal.aborted; // 整体中止无即时通知,汇总必须发
        if (!singleTaskAborted) {
          ctx.onComplete?.(record.parentSessionId, formatDelegationResult(result));
        }
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

/** Mint 建模板工具:一句话创建 Agent 模板(阶段D)。
    注入到主会话工具集,Mint 可用它动态创建子 Agent 模板 */
export async function createAgentTemplateTool(): Promise<ToolDefinition> {
  const defineTool = await getDefineToolFn();
  return defineTool({
    name: "create_agent_template",
    label: "创建 Agent 模板",
    description:
      "创建自定义的子 Agent 模板,指定名称/职责/人格 prompt/供应商+模型/思考级别。"
      + "创建后 Mint 可用 task 工具的 agent 参数选择该模板进行委派。"
      + "示例:\"Mint-D\"用于设计,\"测试员\"跑测试,\"审查员\"只读代码审查。",
    promptSnippet: "创建可复用的子 Agent 模板（名字+职责+人设，供 task 委派选用）",
    promptGuidelines: [
      "需要反复委派同一类任务（写测试、UI 设计、代码审查等）时，先建模板再委派",
      "模板的 prompt 是子 Agent 的系统提示词，定义它的行为方式与专业领域",
    ],
    parameters: {
      type: "object" as const,
      properties: {
        name: { type: "string" as const, description: "模板显示名(如 测试员、代码审查员)" },
        description: { type: "string" as const, description: "一句话描述(如 专门写测试用)" },
        prompt: { type: "string" as const, description: "人格/职责 prompt(注入子 Agent system prompt,定义它的行为方式)" },
        provider: { type: "string" as const, description: "可选供应商 piId(如 deepseek),省略则用全局默认" },
        model: { type: "string" as const, description: "可选模型 id(如 deepseek-v4-flash),与 provider 搭配" },
        thinkingLevel: { type: "string" as const, description: "可选思考级别(off/minimal/low/medium/high/xhigh/max),默认 medium" },
      },
      required: ["name", "description", "prompt"],
    },
    async execute(_tid: string, params: Record<string, unknown>) {
      const { createTemplate } = await import("../agent-templates");
      try {
        const tpl = createTemplate({
          name: String(params.name || ""),
          description: String(params.description || ""),
          prompt: String(params.prompt || ""),
          model: params.model ? String(params.model) : undefined,
          provider: params.provider ? String(params.provider) : undefined,
          agentType: "custom",
          thinkingLevel: params.thinkingLevel ? String(params.thinkingLevel) : undefined,
        });
        return { content: [{ type: "text" as const, text: `Agent 模板已创建: ${tpl.id}\\n名称: ${tpl.name}\\n可通过 task 工具 agent="${tpl.id}" 选用。` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `创建失败: ${(e as Error).message}` }] };
      }
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
