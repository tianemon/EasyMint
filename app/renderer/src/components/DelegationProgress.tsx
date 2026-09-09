import { useEffect, useState } from "react";

/** 委派任务 UI 态（与 AgentProgress 对应,裁剪为渲染所需字段） */
export interface DelegationTaskUi {
  index: number;
  agent: string;
  /** 完整任务内容(模板prompt + ## 任务: desc + 详细指令) */
  task: string;
  /** 任务简述(原始 description,折叠行显示) */
  title?: string;
  /** 任务详情(原始 prompt,展开显示) */
  detail?: string;
  status: "pending" | "running" | "completed" | "failed" | "aborted";
}

export interface DelegationUiState {
  delegationId: string;
  chatId?: string;
  /** 触发委派的消息 id（跨批次合并卡以各委派中最新的 triggerMsgId 为锚点,挂在其消息下方） */
  triggerMsgId?: number;
  tasks: DelegationTaskUi[];
  /** 全部任务进入终态 */
  finished: boolean;
  /** 委派开始时间戳(首次进度事件到达时记录,卡片计时用) */
  startedAt: number;
}

/** 耗时格式化:超过 60s 显示「X分Y秒」,否则「Xs」 */
function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}分${s}秒` : `${m}分`;
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
    // 中止：双竖线（停止符）——不能用 failed 的红叉（主动停止 ≠ 执行报错），
    // 也不能落到 default 的灰色空心圈（会与 pending 混淆，看起来像没跑过）
    case "aborted":
      return (
        <svg className="text-text-secondary shrink-0" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M6.5 6v4M9.5 6v4" />
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

/** 子 Agent 委派进度卡片：标题行 + 每任务一行（仅状态图标 + 任务标题,对齐 cc TUI）
 *  接收全部活动委派(跨批次合并)——任务行聚合成一张卡,由调用方负责把卡挂在最新 triggerMsgId 下 */
export function DelegationProgress({ delegations }: { delegations: DelegationUiState[] }): JSX.Element | null {
  const tasks = delegations.flatMap((d) => d.tasks);
  if (tasks.length === 0) return null;

  // 全批完成 = 所有委派都结束(任一委派仍在跑 → 整卡保持「执行中」)
  const finished = delegations.every((d) => d.finished);
  const done = tasks.filter((t) => t.status === "completed").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  // 中止与失败分开计数：主动停止 ≠ 执行报错。逐委派汇总——中止 = 明确 aborted + 该委派
  // 结束时仍未跑完的 running 残留（被 stop_agent 中断时任务来不及回写 aborted 就会停在这个状态）
  const aborted = delegations.reduce((sum, d) => sum
    + d.tasks.filter((t) => t.status === "aborted").length
    + (d.finished ? d.tasks.filter((t) => t.status === "running").length : 0), 0);

  // 计时:每秒刷新已耗时(执行中实时走动,完成后定格总耗时)
  // 批计时起点 = 最早委派的 startedAt(新委派并入不重置起点);旧数据/HMR 残留缺字段兜底当前时间
  const startedAt = Math.min(...delegations.map((d) => d.startedAt || Date.now()));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // 全批完成 → 定格总耗时(now 不再更新);执行中每秒走动
    if (finished) {
      setNow(Date.now());
      return;
    }
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt, finished]);

  return (
    <div className="w-[420px] my-2 rounded-[var(--radius-lg)] border border-border bg-surface-elevated overflow-hidden text-xs">
      {/* 标题行 */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-accent-bg">
        {finished ? (
          <>
            <svg className="text-success shrink-0" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6.5" /><path d="M5 8l2 2 4-4" /></svg>
            <span className="font-medium text-text-primary">委派完成：{done} 成功{failed > 0 ? `, ${failed} 失败` : ""}{aborted > 0 ? `, ${aborted} 中止` : ""}</span>
            <span className="ml-auto flex items-center gap-1 text-text-secondary tabular-nums">
              <svg className="shrink-0" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="8" cy="8" r="6.5" /><path d="M8 4.5V8l2.5 1.5" /></svg>
              {formatElapsed(now - startedAt)}
            </span>
          </>
        ) : (
          <>
            <svg className="animate-spin text-accent shrink-0" width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" /><path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <span className="font-medium text-text-primary">派遣 Agent 执行中</span>
            <span className="ml-auto flex items-center gap-1 text-accent tabular-nums">
              <svg className="shrink-0" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="8" cy="8" r="6.5" /><path d="M8 4.5V8l2.5 1.5" /></svg>
              {formatElapsed(now - startedAt)}
            </span>
          </>
        )}
      </div>
      {/* 任务列表(默认截断,点击展开完整内容) */}
      <div className="py-1">
        {/* key 含 delegationId:不同委派的 index 均为 0/1/2,跨批次合并到同一张卡后必须唯一 */}
        {delegations.map((d) => d.tasks.map((t) => (
          <TitleRow key={`${d.delegationId}-${t.index}`} task={t} />
        )))}
      </div>
    </div>
  );
}

/** 任务标题行：默认显示任务简述(description),点击展开显示详情(prompt) */
function TitleRow({ task }: { task: DelegationTaskUi }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  // 折叠显示简述:description 优先,缺失回退 task 首行
  const title = task.title || (task.task.split("\n")[0] ?? "").replace(/^##\s*任务[:：]\s*/, "").slice(0, 60) || task.task.slice(0, 60);
  // 展开显示详情:prompt 优先,缺失回退完整 task
  const detail = task.detail || task.task;
  return (
    <div className="group rounded-[var(--radius-lg)] transition-colors">
      <div
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        
      >
        <StatusIcon status={task.status} />
        <span className={`flex-1 min-w-0 truncate font-medium ${task.status === "completed" ? "text-text-secondary" : "text-text-primary"}`}>
          {title}
        </span>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          className={`w-3 h-3 shrink-0 text-text-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}>
          <path d="M4 6l4 4 4-4" />
        </svg>
      </div>
      {expanded && (
        <div className="px-3 pb-2 pl-8">
          <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap break-words">{detail}</p>
        </div>
      )}
    </div>
  );
}
