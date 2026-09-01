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
import { createPiSession, getPiSessionDir } from "../pi-session";
import { getBaseTools, getReadOnlyTools } from "../tool-registry";
import { createEnhancedEditTool } from "../enhanced-edit";
import { getActiveModel, getModelRuntime } from "../pi-init";
import { getStaticModelSpec, supportedThinkingLevelsOfSpec } from "../pi-init-static";
import { getTemplate } from "../agent-templates";
import { resolveThinkingLevel } from "../../../shared/thinking-levels";
import { PERMISSION_RULES_PROMPT } from "../prompt-sections";
import { Store } from "../store";
import { resolveHome } from "../../utils/paths";
import { mapWithConcurrencyLimit, type ParallelResult } from "./parallel";
import { ResultCollector } from "./collector";
import { finishDelegation } from "./registry";
import { wrapToolWithPermission } from "../permission/wrap-tool";
import { SAFE_TOOLS, isSafeBashCommand } from "../permission/permission-rules";
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
  /** Agent 模板名(如 builder/evaluator;查模板的 model/provider 作为默认) */
  agent?: string;
  /** 委派指定模型(优先于模板/子agent默认/全局) */
  model?: string;
  /** 委派指定供应商(与 model 搭配) */
  provider?: string;
  /** 父会话当前生效的思考等级(标准委派跟随主会话;模板委派仅作模板未配置时的回落) */
  parentThinkingLevel?: string;
  /** 主会话权限回调（跟随主会话权限模式：标准/完全访问 + 绝对禁区）；缺省不拦截 */
  canUseTool?: (toolName: string, input: Record<string, unknown>, options: any) => Promise<{ behavior: "allow" | "deny"; message?: string; updatedInput?: Record<string, unknown> }>;
}

/**
 * 子 Agent 思考等级：基础值（模板设置 > 父会话等级 > medium）再按子 Agent 模型能力自适应——
 * 与主会话同一套「同等级 → 向下 → 向上」规则（shared/thinking-levels.ts），
 * 避免子 Agent 落到 SDK 默认的"向上优先"造成不一致。
 */
function adaptSubagentThinkingLevel(base: string, model: Awaited<ReturnType<typeof getActiveModel>>): ThinkingLevel {
  const id = (model as any)?.id as string | undefined;
  if (!id) return base as ThinkingLevel;
  try {
    const supported = supportedThinkingLevelsOfSpec(getStaticModelSpec(id));
    if (supported) return resolveThinkingLevel(base, supported) as ThinkingLevel;
  } catch { /* 查不到能力表按原值 */ }
  return base as ThinkingLevel;
}

/** 解析子 Agent 模型:委派指定 > AgentTemplate > 子agent默认(settings) > 全局(需求 2/3) */
async function resolveSubagentModel(opts: SubagentOptions): Promise<Awaited<ReturnType<typeof getActiveModel>>> {
  const runtime = await getModelRuntime(opts.store);
  const tryGet = (provider?: string, model?: string): Awaited<ReturnType<typeof getActiveModel>> => {
    if (!provider || !model) return null;
    return runtime.getModel(provider, model) ?? null;
  };
  // 1. 委派指定(provider + model)
  const m1 = tryGet(opts.provider, opts.model);
  if (m1) return m1;
  // 2. AgentTemplate(按 agent 名,模板的 provider/model)
  if (opts.agent) {
    const tpl = getTemplate(opts.agent);
    if (tpl) {
      const m2 = tryGet(tpl.provider, tpl.model);
      if (m2) return m2;
    }
  }
  // 3. 子 agent 默认模型(当前激活供应商配置的 subagentDefaultModel,task 委派用)
  const providers = opts.store.getSettings().apiProviders;
  const activeCfg = providers?.current ? providers.configs?.[providers.current] : undefined;
  if (activeCfg?.presetId && activeCfg.subagentDefaultModel) {
    const m3 = tryGet(activeCfg.presetId, activeCfg.subagentDefaultModel);
    if (m3) return m3;
  }
  // 4. 全局默认(当前激活供应商的 model,默认/兜底降级在 getActiveModel 内处理)
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

  const tools = opts.readOnly
    ? await getReadOnlyTools(resolvedPath)
    : await (async () => {
        const base = await getBaseTools(resolvedPath);
        // 子 Agent 的 edit 也用增强版:执行后把 details.diff 注入返回文本(弹层/模型可见变更内容)
        const enhanced = await createEnhancedEditTool(resolvedPath);
        return base.map((t) => (t.name === "edit" ? enhanced : t));
      })();

  // 子 Agent 权限：跟随主会话（DelegationRuntime.canUseTool 传入，绑定主会话模式 standard/full
  // + 绝对禁区）；未传入（旧调用方）则不包装。原写死的 subCanUseTool（只读放行/写一律拒）退役——
  // 它导致标准模式下子 Agent 连工作空间内写入都被拒，与主会话行为不一致。
  const extraTools = opts.canUseTool
    ? tools
    : tools.map((t) => wrapToolWithPermission(t as any, {
        canUseTool: (toolName: string, input: Record<string, unknown>) => {
          if (SAFE_TOOLS.some((s) => s.toLowerCase() === toolName.toLowerCase())) {
            return Promise.resolve({ behavior: "allow" as const, updatedInput: input });
          }
          if (toolName.toLowerCase() === "bash") {
            const command = typeof input.command === "string" ? input.command : "";
            if (isSafeBashCommand(command)) {
              return Promise.resolve({ behavior: "allow" as const, updatedInput: input });
            }
          }
          return Promise.resolve({ behavior: "deny" as const, message: `子 Agent 未授权执行 ${toolName}` });
        },
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
      // 标准委派跟随主会话思考等级（父会话未选过则 medium），并按子 Agent 模型能力自适应
      thinkingLevel: adaptSubagentThinkingLevel(opts.parentThinkingLevel ?? "medium", model),
      store: opts.store, systemPrompt: fullPrompt, extraTools,
      sessionDir: opts.sessionDir,
      // 跟随主会话权限（standard/full + 禁区）；pi-session 对 extraTools 统一包装
      canUseTool: opts.canUseTool as any,
    });
    // 记录子会话 jsonl 路径(前端查看 Agent 过程用)
    opts.childSessionFiles[opts.index] = session2.sessionFile ?? "";
    progress.sessionFile = opts.childSessionFiles[opts.index] || undefined;
    const result2 = await executeAndCollect(session2, opts.task, yieldItems, opts, progress, id, agentLabel, startMs, opts.outputSchema);
    return result2;
  }

  // 解析模板 prompt/thinkingLevel:委派指定 agent → 用模板 prompt 作为子 agent system prompt
  const tpl = opts.agent ? getTemplate(opts.agent) : undefined;
  const tplPrompt = tpl?.prompt;
  const tplThinkingLevel = tpl?.thinkingLevel;
  const systemPrompt = (tplPrompt ? tplPrompt + "\n\n" : "") + opts.task + "\n\n在你完成所有工作后，请在最后一条消息中输出你的工作总结。\n\n" + PERMISSION_RULES_PROMPT;

  try {
    const session = await createPiSession({
      cwd: resolvedPath, agentDir: opts.agentDir, model,
      // 模板委派以模板设置为主；模板未配置时跟随主会话，再按子 Agent 模型能力自适应
      thinkingLevel: adaptSubagentThinkingLevel((tplThinkingLevel as any) ?? opts.parentThinkingLevel ?? "medium", model),
      store: opts.store, systemPrompt, extraTools,
      sessionDir: opts.sessionDir,
      // 跟随主会话权限（standard/full + 禁区）；pi-session 对 extraTools 统一包装
      canUseTool: opts.canUseTool as any,
    });
    // 记录子会话 jsonl 路径(前端查看 Agent 过程用)
    opts.childSessionFiles[opts.index] = session.sessionFile ?? "";
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
  }

  const rawOutput = collector.getText();
  const { text, truncated } = truncateOutput(rawOutput);

  // 结构化输出验证（yield 组装）
  let structuredOutput: SingleResult["structuredOutput"] = undefined;
  if (outputSchema && yieldItems.length > 0) {
    structuredOutput = collector.buildStructuredOutput(yieldItems, outputSchema);
  }

  const aborted = opts.signal?.aborted ?? false;
  progress.status = aborted ? "aborted" : "completed";
  progress.durationMs = Date.now() - startMs;
  opts.onProgress?.(progress);

  return {
    index: progress.index, id, agent: agentLabel, task, title: opts.title, taskId: opts.taskId,
    exitCode: aborted ? 1 : 0, output: text, stderr: "", truncated,
    durationMs: progress.durationMs,
    structuredOutput,
    aborted,
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
  /** 主会话当前生效的思考等级（标准委派跟随；模板委派作回落） */
  parentThinkingLevel?: string;
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
      agent: task.agent,
      model: task.model,
      provider: task.provider,
      parentThinkingLevel: runtime.parentThinkingLevel,
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
