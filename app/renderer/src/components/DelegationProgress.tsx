/** 委派任务 UI 态（与 AgentProgress 对应,裁剪为渲染所需字段） */
export interface DelegationTaskUi {
  index: number;
  agent: string;
  task: string;
  status: "pending" | "running" | "completed" | "failed" | "aborted";
}

export interface DelegationUiState {
  delegationId: string;
  chatId?: string;
  tasks: DelegationTaskUi[];
  /** 全部任务进入终态 */
  finished: boolean;
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

/** 子 Agent 委派进度卡片：标题行 + 每任务一行（仅状态图标 + 任务标题,对齐 cc TUI） */
export function DelegationProgress({ delegation }: { delegation: DelegationUiState }): JSX.Element | null {
  if (delegation.tasks.length === 0) return null;

  const done = delegation.tasks.filter((t) => t.status === "completed").length;
  const failed = delegation.tasks.filter((t) => t.status === "failed" || t.status === "aborted").length;
  const running = delegation.tasks.filter((t) => t.status === "running").length;

  return (
    <div className="max-w-[75%] my-1 rounded-[10px] border border-border bg-surface-elevated overflow-hidden text-xs">
      {/* 标题行 */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-accent-bg">
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
      </div>
      {/* 任务列表（仅标题） */}
      <div className="divide-y divide-border/60">
        {delegation.tasks.map((t) => (
          <div key={t.index} className="flex items-center gap-2 px-3 py-1.5">
            <StatusIcon status={t.status} />
            <span className={`truncate flex-1 ${t.status === "completed" ? "text-text-secondary" : "text-text-primary"}`}>
              {t.task.slice(0, 60)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
