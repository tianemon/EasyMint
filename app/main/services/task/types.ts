/**
 * 子 Agent 系统类型 — 从 omp 精简移植
 */

/** 子 Agent 执行结果 */
export interface SingleResult {
  index: number;
  id: string;
  agent: string;
  task: string;
  /** 任务标题(description 摘要,UI 显示用) */
  title?: string;
  /** 关联的 task.json 任务 id(完成/中止自动回写状态) */
  taskId?: string;
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
  /** 委派任务简述(原始 description,前端折叠行显示用) */
  description?: string;
  /** 委派任务详情(原始 prompt,前端展开显示用) */
  prompt?: string;
  /** 关联的 task.json 任务 id(TaskPanel 实时执行视图用) */
  taskId?: string;
  currentTool?: string;
  toolCount: number;
  durationMs: number;
  /** 子会话 jsonl 文件路径(前端查看 Agent 过程用;createPiSession 后回填) */
  sessionFile?: string;
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
  /** 任务标题(description 摘要,UI 显示用;缺省取 task 前 40 字) */
  title?: string;
  /** 委派任务简述(原始 description 参数,前端折叠行显示用) */
  description?: string;
  /** 委派任务详情(原始 prompt 参数,前端展开显示用) */
  prompt?: string;
  /** 关联的 task.json 任务 id:委派完成/中止时自动回写状态(done/failed) */
  taskId?: string;
  readOnly?: boolean;
  outputSchema?: unknown;
  isolated?: boolean;
  /** 委派指定模型(可选;优先于模板/子agent默认/全局) */
  model?: string;
  /** 委派指定供应商(可选;与 model 搭配指定) */
  provider?: string;
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

/** 委派状态 */
export type DelegationStatus = "running" | "completed" | "failed" | "aborted";

/** 委派记录（异步执行的核心：execute 立即返回，后台执行完成后 resolve completion） */
export interface DelegationRecord {
  delegationId: string;
  /** 主会话 ID（发起委派的 Mint 会话；新建会话时可能是临时 ID,createPiSession 后回填真实 ID） */
  parentSessionId: string;
  /** 创建时的原始 ID（新建会话 = EM 临时 UUID；steer/abort 双匹配用） */
  tempParentSessionId?: string;
  /** 子会话 ID 列表（批量时多个） */
  childSessionIds: string[];
  /** 子会话 jsonl 文件路径列表(按 index 对齐;前端查看 Agent 过程用) */
  childSessionFiles: string[];
  status: DelegationStatus;
  tasks: TaskItem[];
  startedAt: number;
  completedAt?: number;
  result?: BatchResult;
  error?: string;
  /** 完成时 resolve；agent-service 订阅它向主会话注入结果 */
  completion: Promise<BatchResult>;
  resolveCompletion: (result: BatchResult) => void;
  /** 统一中止所有子会话（用户 steer 时调用） */
  abort: () => void;
  abortController: AbortController;
  /** 每个任务的独立中止控制器(ProcessBar 单任务停止用) */
  taskAbortControllers: AbortController[];
  /** 每任务状态(executor 进度回写;AgentBar 列表按此过滤运行中的任务) */
  taskStatuses: TaskStatus[];
}

/** 单个子 Agent 任务的实时状态 */
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "aborted";

// ── 常量 ────────────────────────────────────────────

export const MAX_OUTPUT_BYTES = 500_000;
export const MAX_OUTPUT_LINES = 5000;
