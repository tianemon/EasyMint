/** 历史委派摘要（从磁盘读取,持久展示） */
export interface DelegationHistoryItem {
  id: string;
  summary: string;
  timestamp: number;
}

/** 委派任务 UI 态（与 AgentProgress 对应,裁剪为渲染所需字段） */
export interface DelegationTaskUi {
  index: number;
  agent: string;
  task: string;
  status: "pending" | "running" | "completed" | "failed" | "aborted";
  currentTool?: string;
  toolCount: number;
  durationMs: number;
}

export interface DelegationUiState {
  delegationId: string;
  chatId?: string;
  tasks: DelegationTaskUi[];
  /** 全部任务进入终态 */
  finished: boolean;
}

const TERMINAL: ReadonlySet<string> = new Set(["completed", "failed", "aborted"]);

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

/** 状态图标（内联 SVG,stroke 风格对齐项目规范） */
function StatusIcon({ status }: { status: DelegationTaskUi["status"] }): JSX.Element {
  switch (status) {
    case "running":
      return (
        <svg className="animate-spin text-accent shrink-0" width="13" height="13" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
          <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "completed":
      return (
        <svg className="text-success shrink-0" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M5 8l2 2 4-4" />
        </svg>
      );
    case "failed":
      return (
        <svg className="text-danger shrink-0" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M6 6l4 4M10 6l-4 4" />
        </svg>
      );
    default:
      return (
        <svg className="text-text-secondary/60 shrink-0" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="8" cy="8" r="6.5" />
        </svg>
      );
  }
}

const STATUS_LABEL: Record<string, string> = {
  pending: "等待中",
  running: "执行中",
  completed: "完成",
  failed: "失败",
  aborted: "已中止",
};

/** 历史委派摘要卡片（持久展示,会话页加载时从磁盘读取） */
export function DelegationHistory({ items }: { items: DelegationHistoryItem[] }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div className="mx-auto max-w-[75%] my-2 rounded-[10px] border border-border bg-surface-elevated overflow-hidden text-xs">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-accent-bg">
        <svg className="text-text-secondary shrink-0" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 2h7l4 4v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" /><path d="M10 2v4h4" />
        </svg>
        <span className="font-medium text-text-primary">委派记录（{items.length}）</span>
      </div>
      <div className="divide-y divide-border/60">
        {items.map((item) => (
          <div key={item.id} className="px-3 py-2">
            <div className="text-text-primary leading-relaxed whitespace-pre-wrap">{item.summary}</div>
            <div className="mt-1 text-[10px] text-text-secondary/70">
              {new Date(item.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 子 Agent 委派进度卡片：标题行 + 每个任务一行（对齐 cc TUI 的任务进度列表） */
export function DelegationProgress({ delegation }: { delegation: DelegationUiState }): JSX.Element | null {
  if (delegation.tasks.length === 0) return null;

  const done = delegation.tasks.filter((t) => t.status === "completed").length;
  const failed = delegation.tasks.filter((t) => t.status === "failed" || t.status === "aborted").length;
  const running = delegation.tasks.filter((t) => t.status === "running").length;
  const elapsed = Math.max(0, ...delegation.tasks.map((t) => t.durationMs));

  return (
    <div className="mx-auto max-w-[75%] my-2 rounded-[10px] border border-border bg-surface-elevated overflow-hidden text-xs">
      {/* 标题行 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-accent-bg">
        {delegation.finished ? (
          <>
            <svg className="text-success shrink-0" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6.5" /><path d="M5 8l2 2 4-4" /></svg>
            <span className="font-medium text-text-primary">委派完成：{done} 成功{failed > 0 ? `, ${failed} 失败` : ""}{running > 0 ? `, ${running} 中止` : ""}</span>
          </>
        ) : (
          <>
            <svg className="animate-spin text-accent shrink-0" width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" /><path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <span className="font-medium text-text-primary">调度 Agent 执行中</span>
          </>
        )}
        <span className="ml-auto text-text-secondary tabular-nums">{formatDuration(elapsed)}</span>
      </div>
      {/* 任务列表 */}
      <div className="divide-y divide-border/60">
        {delegation.tasks.map((t) => (
          <div key={t.index} className="flex items-center gap-2 px-3 py-1.5">
            <StatusIcon status={t.status} />
            <span className={`truncate flex-1 ${t.status === "completed" ? "text-text-secondary" : "text-text-primary"}`}>
              {t.task.slice(0, 60)}
            </span>
            {t.status === "running" && t.currentTool && (
              <span className="text-text-secondary shrink-0">当前: {t.currentTool} ({t.toolCount} 次)</span>
            )}
            {TERMINAL.has(t.status) && (
              <span className="text-text-secondary/70 shrink-0">{STATUS_LABEL[t.status]}</span>
            )}
            <span className="text-text-secondary/60 tabular-nums shrink-0">{formatDuration(t.durationMs)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
