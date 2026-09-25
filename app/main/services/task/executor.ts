/**
 * 子 Agent 执行器 — 后台异步执行
 *
 * tool.execute 创建委派记录后立即返回；本模块在后台执行子 Agent：
 * createPiSession(落盘到 subagents/ 子目录) → prompt → collector 收集 → 结构化输出，
 * 完成后 finishDelegation 唤醒 completion（agent-service 订阅注入主会话）。
 */

import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AgentSessionEvent } from "../pi-sdk";
import { createPiSession, disposePiSession, getPiSessionDir } from "../pi-session";
import { getBaseTools, getReadOnlyTools } from "../tool-registry";
import { createEnhancedEditTool } from "../enhanced-edit";
import { getActiveModel, getModelRuntime } from "../pi-init";
import { supportedThinkingLevelsOfSpec } from "../pi-init-static";
import { getTemplate } from "../agent-templates";
import { ensureDesignerTemplates } from "../designer-seed";
import { resolveThinkingLevel } from "../../../shared/thinking-levels";
import { PERMISSION_RULES_PROMPT } from "../prompt-sections";
import { Store } from "../store";
import { resolveHome } from "../../utils/paths";
import { mapWithConcurrencyLimit, type ParallelResult } from "./parallel";
import { ResultCollector, extractAssistantText } from "./collector";
import { judgeSubagentTerminal } from "./terminal";
import { subagentModelChoice, subagentThinkingLevel } from "./model-resolution";
import { finishDelegation } from "./registry";
import { wrapToolWithPermission } from "../permission/wrap-tool";
import { bridgeSessionEvents } from "../event-bridge";
import { broadcast } from "../ipc-broadcast";
import type {
  SingleResult,
  AgentProgress,
  TaskItem,
  DelegationRecord,
  YieldItem,
} from "./types";
import { MAX_OUTPUT_BYTES, MAX_OUTPUT_LINES } from "./types";

// ── 配置 ────────────────────────────────────────────

const DEFAULT_CONCURRENCY = 4;

// ── 输出截断 ────────────────────────────────────────

function truncateOutput(output: string): { text: string; truncated: boolean } {
  const lines = output.split("\n");
  const lineTruncated = lines.length > MAX_OUTPUT_LINES;
  const truncated = lineTruncated || output.length > MAX_OUTPUT_BYTES;
  const text = lineTruncated
    ? `${lines.slice(-MAX_OUTPUT_LINES).join("\n")}\n[输出已截断]`
    : output.slice(-MAX_OUTPUT_BYTES);
  return { text, truncated };
}

// ── 子 Agent 执行 ────────────────────────────────────

export interface SubagentOptions {
  cwd: string;
  agentDir: string;
  store: Store;
  /** 子会话落盘目录（subagents/ 子目录，避免与主会话平级出现在列表） */
  sessionDir: string;
  task: string;
  index: number;
  signal?: AbortSignal;
  readOnly?: boolean;
  outputSchema?: unknown;
  onProgress?: (progress: AgentProgress) => void;
  /** 任务标题(description 摘要,结果注入显示用) */
  title?: string;
  /** 委派任务简述(原始 description,进度广播带往前端) */
  description?: string;
  /** 委派任务详情(原始 prompt,进度广播带往前端) */
  prompt?: string;
  /** 关联的 task.json 任务 id(完成/中止自动回写) */
  taskId?: string;
  /** 委派 ID(实时流广播 agent:subagent-stream 标识,前端按 delegationId+index 过滤) */
  delegationId: string;
  /** 子会话 jsonl 路径记录(按 index 写入;前端查看 Agent 过程定位文件) */
  childSessionFiles: string[];
  /** 子会话 ID 记录（按 index 写入；后台进程所有权与父会话撤销能力使用）。 */
  childSessionIds: string[];
  /** Agent 模板名(如 builder/evaluator)——只取它的 prompt 作子 Agent 人格;模型与等级不来自模板 */
  agent?: string;
  /** 主会话当前生效的思考等级——**唯一来源**(子 Agent 不再有任何等级配置) */
  parentThinkingLevel?: string;
  /** 主会话当前模型 id——**唯一来源**(委派参数/模板/供应商都不再能指定子 Agent 模型) */
  parentModel?: string;
  /** 主会话当前模型所属供应商（与 parentModel 搭配） */
  parentProvider?: string;
  /** 主会话权限回调（跟随主会话权限模式：标准/完全访问 + 绝对禁区）；缺省不拦截 */
  canUseTool?: (toolName: string, input: Record<string, unknown>, options: any) => Promise<{ behavior: "allow" | "deny"; message?: string; updatedInput?: Record<string, unknown> }>;
}

/**
 * 把主会话的思考等级落到子 Agent 模型实际支持的档位——与主会话同一套
 * 「同等级 → 向下 → 向上」规则（shared/thinking-levels.ts），
 * 避免子 Agent 落到 SDK 默认的"向上优先"造成不一致。
 *
 * 等级从哪来见 subagentThinkingLevel：**只有主会话一个来源**。
 * 不要在这里加档位判断或子 Agent 默认档——那正是 2026-09-16 被收敛掉的东西。
 */
function adaptSubagentThinkingLevel(base: string, model: Awaited<ReturnType<typeof getActiveModel>>): ThinkingLevel {
  if (!model) return base as ThinkingLevel;
  // 用运行时 Model 的 thinkingLevelMap（用户声明优先）而非静态官方表近似匹配——
  // 否则用户在设置里覆盖的档位对子 Agent 不生效。
  // 不用 SDK 的 getSupportedThinkingLevels：pi-ai 是 ESM-only，主进程 CJS bundle require 不到它
  const supported = supportedThinkingLevelsOfSpec(model as unknown as Record<string, any>);
  return resolveThinkingLevel(base, supported) as ThinkingLevel;
}

/**
 * 解析子 Agent 模型：**主会话当前模型是唯一来源**。
 * 主会话尚未绑定（新建会话早期）或该模型在运行时查不到时，回落到全局默认
 * （兜底降级在 getActiveModel 内处理）。
 *
 * 唯一来源的守卫在 model-resolution.ts —— 要新增来源，先改那里的单测。
 */
async function resolveSubagentModel(opts: SubagentOptions): Promise<Awaited<ReturnType<typeof getActiveModel>>> {
  const choice = subagentModelChoice({
    parent: { provider: opts.parentProvider, model: opts.parentModel },
  });
  if (choice) {
    const runtime = await getModelRuntime(opts.store);
    const m = runtime.getModel(choice.provider, choice.model);
    if (m) {
      // 记一行来源：子 Agent「用哪个模型」以前只能靠反查会话 jsonl，排错成本高
      console.log(`[task] 子 Agent 模型来源=${choice.source} ${choice.provider}/${choice.model}`);
      return m;
    }
  }
  return getActiveModel(opts.store);
}

/** 执行单个子 Agent（后台，不阻塞调用方） */
async function runSingleSubagent(opts: SubagentOptions): Promise<SingleResult> {
  const id = randomUUID();
  const startMs = Date.now();
  const agentLabel = opts.readOnly ? "reviewer" : "coder";

  const progress: AgentProgress = {
    index: opts.index,
    id,
    agent: agentLabel,
    status: "running",
    task: opts.task.slice(0, 100),
    description: opts.description,
    prompt: opts.prompt,
    taskId: opts.taskId,
    toolCount: 0,
    durationMs: 0,
    requests: 0,
    tokens: 0,
    cost: 0,
  };
  opts.onProgress?.(progress);

  const resolvedPath = path.resolve(resolveHome(opts.cwd));

  // designer 类模板：先把种子模板/品牌库播进项目。原先只有「主会话以 designer 启动」才播种，
  // 走 task 委派 mint-designer 的子 Agent 会去翻一个不存在的 .easymint/templates/（白耗回合）
  if (opts.agent && getTemplate(opts.agent)?.agentType === "designer") {
    ensureDesignerTemplates(resolvedPath);
  }

  const model = await resolveSubagentModel(opts);
  if (!model) {
    return {
      index: opts.index, id, agent: agentLabel, task: opts.task, taskId: opts.taskId,
      exitCode: 1, output: "", stderr: "未配置 AI 模型", truncated: false,
      durationMs: Date.now() - startMs, error: "未配置 AI 模型",
      tokens: 0, requests: 0,
    };
  }

  if ((model as any).contextWindow) {
    progress.contextWindow = (model as any).contextWindow;
  }
  progress.resolvedModel = (model as any).id;

  // 子 Agent 的思考等级 = 主会话当前等级（**唯一来源**），两个执行分支共用；
  // 再经 adaptSubagentThinkingLevel 按子 Agent 模型能力自适应（模型不支持的档会自动降）。
  // tpl 在这里取一次：模板只提供人格 prompt，不再提供任何运行配置。
  const tpl = opts.agent ? getTemplate(opts.agent) : undefined;
  const subagentThinkingBase = subagentThinkingLevel(opts.parentThinkingLevel);

  const tools = opts.readOnly
    ? await getReadOnlyTools(resolvedPath)
    : await (async () => {
        const base = await getBaseTools(resolvedPath);
        // 子 Agent 的 edit 也用增强版:执行后把 details.diff 注入返回文本(弹层/模型可见变更内容)
        const enhanced = await createEnhancedEditTool(resolvedPath);
        return base.map((t) => (t.name === "edit" ? enhanced : t));
      })();

  // 子 Agent 权限跟随主会话。旧调用方没有策略时全部失败关闭，不能让原生 Bash 裸跑。
  const extraTools = opts.canUseTool
    ? tools
    : tools.map((t) => wrapToolWithPermission(t as any, {
        canUseTool: (toolName: string) => Promise.resolve({
          behavior: "deny" as const,
          message: `子 Agent 缺少运行时权限策略，已拒绝执行 ${toolName}`,
        }),
      }));

  // 结构化输出收集器（yield 工具写入，执行结束后统一返回）
  const yieldItems: YieldItem[] = [];

  if (opts.outputSchema) {
    const yieldTool: any = {
      name: "yield",
      label: "返回结构化结果",
      description: "将工作结果以结构化 JSON 格式返回。在完成所有工作后调用此工具。"
        + " data 参数必须符合要求的 schema 格式。",
      parameters: {
        type: "object" as const,
        properties: {
          data: { type: "object" as const, description: "结构化输出数据" },
          type: { type: "string" as const, description: "可选的结果标签" },
        },
      },
      async execute(_t: any, params: any) {
        yieldItems.push({ data: params.data, type: params.type });
        return { content: [{ type: "text" as const, text: "ok" }] };
      },
    };
    extraTools.push(yieldTool as any);

    // 在 system prompt 末尾追加 yield 指令
    const schemaHint = typeof opts.outputSchema === "object"
      ? `\n\n完成工作后，必须调 yield 工具返回结果。data 对象需包含以下字段: ${JSON.stringify(opts.outputSchema)}`
      : "";
    const fullPrompt = opts.task + schemaHint + "\n\n" + PERMISSION_RULES_PROMPT;
    const session2 = await createPiSession({
      cwd: resolvedPath, agentDir: opts.agentDir, model,
      // 思考等级按模板归属解析（Mint/Mint-D 跟随主会话，其余默认 high），再按模型能力自适应
      thinkingLevel: adaptSubagentThinkingLevel(subagentThinkingBase, model),
      store: opts.store, systemPrompt: fullPrompt, extraTools,
      sessionDir: opts.sessionDir,
      // 跟随主会话权限（standard/full + 禁区）；pi-session 对 extraTools 统一包装
      canUseTool: opts.canUseTool as any,
    });
    // 记录子会话 jsonl 路径(前端查看 Agent 过程用)
    opts.childSessionFiles[opts.index] = session2.sessionFile ?? "";
    opts.childSessionIds[opts.index] = resolveAgentSessionId(session2);
    progress.sessionFile = opts.childSessionFiles[opts.index] || undefined;
    const result2 = await executeAndCollect(session2, opts.task, yieldItems, opts, progress, id, agentLabel, startMs, opts.outputSchema);
    return result2;
  }

  // 模板 prompt:委派指定 agent → 用模板 prompt 作为子 agent system prompt
  // （tpl 与思考等级基础值已在函数早期解析，两个分支共用）
  const tplPrompt = tpl?.prompt;
  const systemPrompt = (tplPrompt ? tplPrompt + "\n\n" : "") + opts.task + "\n\n在你完成所有工作后，请在最后一条消息中输出你的工作总结。\n\n" + PERMISSION_RULES_PROMPT;

  try {
    const session = await createPiSession({
      cwd: resolvedPath, agentDir: opts.agentDir, model,
      // 思考等级按模板归属解析，并按子 Agent 模型能力自适应
      thinkingLevel: adaptSubagentThinkingLevel(subagentThinkingBase, model),
      store: opts.store, systemPrompt, extraTools,
      sessionDir: opts.sessionDir,
      // 跟随主会话权限（standard/full + 禁区）；pi-session 对 extraTools 统一包装
      canUseTool: opts.canUseTool as any,
    });
    // 记录子会话 jsonl 路径(前端查看 Agent 过程用)
    opts.childSessionFiles[opts.index] = session.sessionFile ?? "";
    opts.childSessionIds[opts.index] = resolveAgentSessionId(session);
    progress.sessionFile = opts.childSessionFiles[opts.index] || undefined;
    const result = await executeAndCollect(session, opts.task, yieldItems, opts, progress, id, agentLabel, startMs);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`[task] runSingleSubagent catch idx=${opts.index}: ${msg.slice(0, 120)}`);
    progress.status = "failed";
    progress.durationMs = Date.now() - startMs;
    opts.onProgress?.(progress);
    return {
      index: opts.index, id, agent: agentLabel, task: opts.task, taskId: opts.taskId,
      exitCode: 1, output: "", stderr: msg, truncated: false,
      durationMs: progress.durationMs, error: msg,
      tokens: progress.tokens, requests: progress.requests,
    };
  }
}

/** 执行 session.prompt() + ResultCollector 收集 + 结构化验证 */
async function executeAndCollect(
  session: Awaited<ReturnType<typeof createPiSession>>,
  task: string,
  yieldItems: YieldItem[],
  opts: SubagentOptions,
  progress: AgentProgress,
  id: string,
  agentLabel: string,
  startMs: number,
  outputSchema?: unknown,
): Promise<SingleResult> {
  const collector = new ResultCollector();
  const scheduleProgress = (() => {
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (flush: boolean) => {
      if (flush) {
        if (timer) { clearTimeout(timer); timer = null; }
        pending = false;
        opts.onProgress?.(progress);
        return;
      }
      if (!pending) {
        pending = true;
        timer = setTimeout(() => { pending = false; timer = null; opts.onProgress?.(progress); }, 200);
      }
    };
  })();

  let activeModel = progress.resolvedModel;

  // ── 终态信号：最后一条 assistant 的结束原因 / 是否带终局文本 ──
  // 用于判定「真完成 / 静默失败」——截断(max_tokens)与错误回合不会抛错，
  // 只能从这里读到（机制说明见 task/terminal.ts 顶部注释）
  let lastStopReason: string | undefined;
  let lastErrorMessage: string | undefined;
  let lastHasText = false;
  const noteTerminal = (msg: {
    stopReason?: string;
    errorMessage?: string;
    content?: Array<{ type?: string; text?: string }>;
  }): void => {
    lastStopReason = msg.stopReason;
    lastErrorMessage = msg.errorMessage;
    lastHasText = extractAssistantText(msg).trim().length > 0;
  };

  // 中止传播：signal abort 时立即中止子会话（不能只依赖事件回调——
  // 子 Agent 等待模型输出时无事件到达，回调永远不会执行）
  const onAbort = () => {
    console.log(`[task] subagent abort triggered idx=${progress.index}`);
    session.abort().catch(() => {});
  };
  if (opts.signal) {
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }

  const unsub = session.subscribe((event: AgentSessionEvent) => {
    if (opts.signal?.aborted) { session.abort().catch(() => {}); return; }

    // ── 实时流转发:子 Agent 过程在前端弹层实时展示 ──
    // 用 bridgeSessionEvents 转成 EM 统一格式(与主会话事件同构),前端复用 piEventToEntries。
    // 只转发携带内容的 message 帧即可;getSession/setPendingResult 子会话用不上,占位。
    try {
      bridgeSessionEvents(event, {
        onEvent: (ev) => {
          broadcast("agent:subagent-stream", {
            delegationId: opts.delegationId,
            index: progress.index,
            sessionFile: opts.childSessionFiles[progress.index] ?? "",
            ev,
          });
        },
        getSession: () => null,
        setPendingResult: () => {},
      });
    } catch { /* 转发失败不影响子 Agent 执行 */ }

    // ── 终态信号（放在最前，避免被下方任何早退分支跳过）──
    // agent_end 携带本轮全部消息，是最后一条 assistant 的权威来源；message_end 至少兜住
    if (event.type === "agent_end" && Array.isArray((event as { messages?: unknown[] }).messages)) {
      const msgs = (event as { messages: Array<{ role?: string }> }).messages;
      const last = [...msgs].reverse().find((m) => m?.role === "assistant");
      if (last) noteTerminal(last as Parameters<typeof noteTerminal>[0]);
    }

    if (event.type === "tool_execution_start") {
      progress.currentTool = event.toolName;
      progress.toolCount++;
      scheduleProgress(false);
      return;
    }

    // ── Token 追踪 ──
    if (event.type === "message_end") {
      const msg = event.message as { role?: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } };
      if (msg.role === "assistant") {
        noteTerminal(msg as Parameters<typeof noteTerminal>[0]);
        progress.requests++;
        if (msg.usage) {
          progress.tokens += (msg.usage.totalTokens ?? 0) || (msg.usage.inputTokens ?? 0) + (msg.usage.outputTokens ?? 0);
          if (msg.usage.totalTokens && msg.usage.totalTokens > 0) {
            progress.contextTokens = msg.usage.totalTokens;
          }
        }
      }
    }

    // ── Retry 追踪 ──
    if (event.type === "auto_retry_start") {
      progress.retryState = {
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
        errorMessage: event.errorMessage,
        startedAtMs: Date.now(),
      };
      progress.retryFailure = undefined;
      scheduleProgress(false);
      return;
    }
    if (event.type === "auto_retry_end") {
      const attempt = progress.retryState?.attempt ?? event.attempt;
      progress.retryState = undefined;
      if (!event.success) {
        progress.retryFailure = { attempt, errorMessage: event.finalError ?? "重试失败" };
      }
      scheduleProgress(false);
      return;
    }

    // ── Model 追踪 ──
    const nextModel = (session as any).model ? (session as any).model.id ?? undefined : undefined;
    if (nextModel && nextModel !== activeModel) {
      activeModel = nextModel;
      progress.resolvedModel = nextModel;
      scheduleProgress(false);
    }

    // ── 消息收集（按消息 id 替换，杜绝累积快照拼接重复）──
    collector.onEvent(event);
  });

  try {
    await session.prompt(task);
    console.log(`[task] subagent prompt resolved idx=${progress.index} aborted=${opts.signal?.aborted ?? false}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`[task] subagent prompt threw idx=${progress.index}: ${msg.slice(0, 120)}`);
    throw e;
  } finally {
    unsub();
    opts.signal?.removeEventListener("abort", onAbort);
    await disposePiSession(session);
  }

  const rawOutput = collector.getText();
  const { text, truncated } = truncateOutput(rawOutput);

  // 结构化输出验证（yield 组装）
  let structuredOutput: SingleResult["structuredOutput"] = undefined;
  if (outputSchema && yieldItems.length > 0) {
    structuredOutput = collector.buildStructuredOutput(yieldItems, outputSchema);
  }

  const aborted = opts.signal?.aborted ?? false;
  // 终态判定：截断 / 报错 / 无终局总结都不能报「完成」（判据与实测分布见 task/terminal.ts）
  const verdict = judgeSubagentTerminal({
    aborted,
    lastStopReason,
    lastErrorMessage,
    hasFinalText: lastHasText,
    outputSchemaRequested: !!outputSchema,
    yieldCount: yieldItems.length,
  });
  const status: AgentProgress["status"] = aborted || lastStopReason === "aborted"
    ? "aborted"
    : verdict.error ? "failed" : "completed";
  progress.status = status;
  progress.durationMs = Date.now() - startMs;
  opts.onProgress?.(progress);

  return {
    index: progress.index, id, agent: agentLabel, task, title: opts.title, taskId: opts.taskId,
    exitCode: status === "completed" ? 0 : 1,
    // 硬失败且无终局文本时，收集到的只是被截断前的闲聊（如开场白）——原样输出会被
    // 上层当成"结果"读，故清空，只留 error 说明
    output: verdict.error && !lastHasText && !aborted ? "" : text,
    stderr: verdict.error ?? "", truncated,
    durationMs: progress.durationMs,
    structuredOutput,
    aborted,
    error: verdict.error,
    warning: verdict.warning,
    tokens: progress.tokens,
    requests: progress.requests,
    contextTokens: progress.contextTokens,
    contextWindow: progress.contextWindow,
    resolvedModel: progress.resolvedModel,
    retryFailure: progress.retryFailure,
  };
}

// ── 公开 API ─────────────────────────────────────────

export interface DelegationRuntime {
  cwd: string;
  agentDir: string;
  store: Store;
  concurrency?: number;
  /** 主会话当前生效的思考等级（子 Agent 兜底：模板未配时才跟随） */
  parentThinkingLevel?: string;
  /** 主会话当前模型（子 Agent 兜底：委派/模板/子agent默认都没配时才跟随） */
  parentModel?: string;
  /** 主会话当前模型所属供应商 */
  parentProvider?: string;
  /** 主会话权限回调（子 Agent 跟随主会话权限模式 + 绝对禁区）；缺省走旧只读包装 */
  canUseTool?: (toolName: string, input: Record<string, unknown>, options: any) => Promise<{ behavior: "allow" | "deny"; message?: string; updatedInput?: Record<string, unknown> }>;
  onProgress?: (progress: AgentProgress) => void;
}

/**
 * 后台执行委派：并行运行所有子 Agent，完成后 finishDelegation。
 * 不阻塞调用方（tool.execute 启动后立即返回）。
 */
export async function runSubagents(
  record: DelegationRecord,
  runtime: DelegationRuntime,
): Promise<void> {
  const startMs = Date.now();
  const concurrency = runtime.concurrency ?? DEFAULT_CONCURRENCY;
  // 目录分级（对齐 cc/omp）：<项目会话目录>/<主会话ID>/subagents/ —— 子会话归属清晰
  const sessionDir = path.join(
    getPiSessionDir(path.resolve(runtime.cwd)),
    record.parentSessionId,
    "subagents",
  );

  const runOpts = record.tasks.map((task: TaskItem, index) => ({
    subagentOpts: {
      cwd: runtime.cwd,
      agentDir: runtime.agentDir,
      store: runtime.store,
      sessionDir,
      task: task.task,
      title: task.title,
      description: task.description,
      prompt: task.prompt,
      taskId: task.taskId,
      index,
      // 单任务独立中止控制器(ProcessBar 单独停止);整体 abort 时 record.abort 会 abort 全部
      signal: record.taskAbortControllers[index]?.signal ?? record.abortController.signal,
      readOnly: task.readOnly,
      outputSchema: task.outputSchema,
      onProgress: runtime.onProgress,
      delegationId: record.delegationId,
      childSessionFiles: record.childSessionFiles,
      childSessionIds: record.childSessionIds,
      agent: task.agent,
      model: task.model,
      provider: task.provider,
      parentThinkingLevel: runtime.parentThinkingLevel,
      parentModel: runtime.parentModel,
      parentProvider: runtime.parentProvider,
      canUseTool: runtime.canUseTool,
    },
  }));

  let parallelResult: ParallelResult<SingleResult>;
  try {
    parallelResult = await mapWithConcurrencyLimit(
      runOpts,
      concurrency,
      async (o) => runSingleSubagent(o.subagentOpts),
      record.abortController.signal,
    );
  } catch (e) {
    // 单个子 Agent 抛异常(网络/会话创建失败等)会传播到这里——
    // 必须收尾委派,否则 completion 永不 resolve、统一通知丢失、卡片永久 running
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[task] runSubagents threw: ${msg.slice(0, 200)}`);
    finishDelegation(record, "failed", {
      result: {
        results: [{
          index: 0, id: "", agent: "delegation", task: "委派执行异常",
          exitCode: 1, output: "", stderr: msg, truncated: false,
          durationMs: Date.now() - startMs, error: msg,
          tokens: 0, requests: 0,
        }],
        totalDurationMs: Date.now() - startMs,
        aborted: false,
      },
    });
    return;
  }

  const results = parallelResult.results.filter((r): r is SingleResult => r !== undefined);

  // (task.json 回写已下沉到单任务终态——见 tool.ts broadcastProgress,
  // 逐任务即时 done/failed,不再等委派整体收尾)

  if (record.abortController.signal.aborted) {
    finishDelegation(record, "aborted", {
      result: {
        results,
        totalDurationMs: Date.now() - startMs,
        aborted: true,
      },
    });
    return;
  }

  finishDelegation(record, "completed", {
    result: {
      results,
      totalDurationMs: Date.now() - startMs,
      aborted: false,
    },
  });
}

function resolveAgentSessionId(session: unknown): string {
  const candidate = session as { sessionId?: string; sessionManager?: { getSessionId?: () => string } };
  try {
    return candidate.sessionId ?? candidate.sessionManager?.getSessionId?.() ?? "";
  } catch {
    return candidate.sessionId ?? "";
  }
}
