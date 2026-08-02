/**
 * 子 Agent 执行器 — 后台异步执行
 *
 * tool.execute 创建委派记录后立即返回；本模块在后台执行子 Agent：
 * createPiSession(落盘到 subagents/ 子目录) → prompt → collector 收集 → 结构化输出，
 * 完成后 finishDelegation 唤醒 completion（agent-service 订阅注入主会话）。
 */

import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentSessionEvent } from "../pi-sdk";
import { createPiSession, getPiSessionDir } from "../pi-session";
import { getBaseTools, getReadOnlyTools } from "../tool-registry";
import { getActiveModel } from "../pi-init";
import { Store } from "../store";
import { resolveHome } from "../../utils/paths";
import { mapWithConcurrencyLimit } from "./parallel";
import { ResultCollector } from "./collector";
import { finishDelegation } from "./registry";
import { wrapToolWithPermission } from "../permission/wrap-tool";
import { SAFE_TOOLS, isSafeBashCommand } from "../permission/permission-rules";
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
    toolCount: 0,
    durationMs: 0,
    requests: 0,
    tokens: 0,
    cost: 0,
  };
  opts.onProgress?.(progress);

  const resolvedPath = path.resolve(resolveHome(opts.cwd));

  const model = await getActiveModel(opts.store);
  if (!model) {
    return {
      index: opts.index, id, agent: agentLabel, task: opts.task,
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
    : await getBaseTools(resolvedPath);

  // 子 Agent 权限包装：只读操作自动放行，写操作需白名单
  const subCanUseTool = (toolName: string, input: Record<string, unknown>) => {
    if (SAFE_TOOLS.includes(toolName)) return { behavior: "allow" as const, updatedInput: input };
    if (toolName === "Bash") {
      const command = typeof input.command === "string" ? input.command : "";
      if (isSafeBashCommand(command)) return { behavior: "allow" as const, updatedInput: input };
    }
    return { behavior: "deny" as const, message: `子 Agent 未授权执行 ${toolName}` };
  };
  const wrappedTools = tools.map((t) =>
    wrapToolWithPermission(t as any, { canUseTool: subCanUseTool as any }),
  );

  // 结构化输出：创建 yield 工具 + schema 提示
  const yieldItems: YieldItem[] = [];
  const extraTools = [...wrappedTools];

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
    const fullPrompt = opts.task + schemaHint;
    const session2 = await createPiSession({
      cwd: resolvedPath, agentDir: opts.agentDir, model, thinkingLevel: "medium",
      store: opts.store, systemPrompt: fullPrompt, extraTools,
      sessionDir: opts.sessionDir,
      canUseTool: undefined,
    });
    const result2 = await executeAndCollect(session2, opts.task, yieldItems, opts, progress, id, agentLabel, startMs, opts.outputSchema);
    return result2;
  }

  const systemPrompt = opts.task + "\n\n在你完成所有工作后，请在最后一条消息中输出你的工作总结。";

  try {
    const session = await createPiSession({
      cwd: resolvedPath, agentDir: opts.agentDir, model, thinkingLevel: "medium",
      store: opts.store, systemPrompt, extraTools,
      sessionDir: opts.sessionDir,
      canUseTool: undefined,
    });
    const result = await executeAndCollect(session, opts.task, yieldItems, opts, progress, id, agentLabel, startMs);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    progress.status = "failed";
    progress.durationMs = Date.now() - startMs;
    opts.onProgress?.(progress);
    return {
      index: opts.index, id, agent: agentLabel, task: opts.task,
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
  opts: { signal?: AbortSignal; onProgress?: (p: AgentProgress) => void },
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

  const unsub = session.subscribe((event: AgentSessionEvent) => {
    if (opts.signal?.aborted) { session.abort().catch(() => {}); return; }

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
  } finally {
    unsub();
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
    index: progress.index, id, agent: agentLabel, task,
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
  const sessionDir = path.join(getPiSessionDir(path.resolve(runtime.cwd)), "subagents");

  const runOpts = record.tasks.map((task: TaskItem, index) => ({
    subagentOpts: {
      cwd: runtime.cwd,
      agentDir: runtime.agentDir,
      store: runtime.store,
      sessionDir,
      task: task.task,
      index,
      signal: record.abortController.signal,
      readOnly: task.readOnly,
      outputSchema: task.outputSchema,
      onProgress: runtime.onProgress,
    },
  }));

  const parallelResult = await mapWithConcurrencyLimit(
    runOpts,
    concurrency,
    async (o) => runSingleSubagent(o.subagentOpts),
    record.abortController.signal,
  );

  const results = parallelResult.results.filter((r): r is SingleResult => r !== undefined);

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
