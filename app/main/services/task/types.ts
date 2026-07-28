/**
 * 子 Agent 系统类型 — 从 omp 精简移植
 */

/** 子 Agent 执行结果 */
export interface SingleResult {
  index: number;
  id: string;
  agent: string;
  task: string;
  assignment?: string;
  exitCode: number;
  output: string;
  stderr: string;
  truncated: boolean;
  structuredOutput?: StructuredSubagentOutput;
  durationMs: number;
  error?: string;
  aborted?: boolean;
  // omp 移植的生产字段
  tokens: number;
  requests: number;
  contextTokens?: number;
  contextWindow?: number;
  resolvedModel?: string;
  retryFailure?: { attempt: number; errorMessage: string };
}

/** 结构化输出 */
export interface StructuredSubagentOutput {
  status: "valid" | "invalid" | "unavailable";
  data?: unknown;
  error?: string;
}

/** Agent 定义 */
export interface AgentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
  model?: string;
  source: "builtin" | "user";
}

/** 子 Agent 进度（简化版） */
export interface AgentProgress {
  index: number;
  id: string;
  agent: string;
  status: "pending" | "running" | "completed" | "failed" | "aborted";
  task: string;
  currentTool?: string;
  toolCount: number;
  durationMs: number;
  // omp 移植的生产字段
  requests: number;
  tokens: number;
  contextTokens?: number;
  contextWindow?: number;
  cost: number;
  resolvedModel?: string;
  retryState?: {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    errorMessage: string;
    startedAtMs: number;
  };
  retryFailure?: {
    attempt: number;
    errorMessage: string;
  };
}

/** 任务项 */
export interface TaskItem {
  name?: string;
  agent?: string;
  task: string;
  readOnly?: boolean;
  outputSchema?: unknown;
  isolated?: boolean;
}

/** yield 工具输出项 */
export interface YieldItem {
  data?: unknown;
  status?: "success" | "aborted";
  error?: string;
  type?: string | string[];
  useLastTurn?: boolean;
  schemaOverridden?: boolean;
}

/** 批量执行结果 */
export interface BatchResult {
  results: SingleResult[];
  totalDurationMs: number;
  aborted: boolean;
}

// ── 常量 ────────────────────────────────────────────

export const MAX_OUTPUT_BYTES = 500_000;
export const MAX_OUTPUT_LINES = 5000;
