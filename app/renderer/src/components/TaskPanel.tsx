import { useState, useRef, useEffect, useCallback } from "react";
import { useTaskStore } from "../stores/task-store";
import { useProjectStatusStore } from "../stores/project-status-store";
import type { StageEntry } from "../stores/project-status-store";

interface TaskPanelProps {
  projectPath: string;
  onCollapse: () => void;
  onLeafClick: () => void;
}

const STATUS_ICON: Record<string, JSX.Element> = {
  done: <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0"><circle cx="6" cy="6" r="5" className="fill-success stroke-success" strokeWidth="1"/><path d="M3.5 6l2 2 3-4" className="stroke-inverse" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  running: <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0"><circle cx="6" cy="6" r="5" className="fill-warning stroke-warning" strokeWidth="1"/><circle cx="6" cy="6" r="2.5" className="fill-inverse animate-pulse"/></svg>,
  failed: <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0"><circle cx="6" cy="6" r="5" className="fill-danger stroke-danger" strokeWidth="1"/><path d="M4 4l4 4M8 4l-4 4" className="stroke-inverse" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  pending: <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0"><circle cx="6" cy="6" r="5" className="fill-none stroke-muted" strokeWidth="1"/></svg>,
};

// ── Fishbone Stepper (leaf vein style) ──────────────
//
//  Layout: center spine with branches alternating up/down.
//  Each branch: diagonal → horizontal → dot + label.
//
//  Tunable parameters (all in SVG px units):
//    H, w         — SVG viewBox 尺寸
//    spineY       — 脊柱线 y 坐标
//    branchY_up   — 上方分支 y 坐标
//    branchY_down — 下方分支 y 坐标
//    sx spacing   — 脊柱节点 x 间距 (12 + i * 42)
//    elbowX       — 拐点 x = sx + 偏移 (调整斜线陡峭度)
//    dotX         — 圆点 x = elbowX + 偏移 (调整横线长度)
//    r            — 圆点半径 (done/pending/current 三种)
//    spine stroke — 脊柱线颜色 + strokeWidth (line 39)
//    branch stroke— 分支线颜色 + strokeWidth (line 58)
//    text fontSize— 标签字号 (line 68)
//    text y offset— branchY - 5 / branchY + 14 (line 68, 标签与圆点间距)

function Fishbone({ timeline, hovered, onHover }: { timeline: StageEntry[]; hovered: string | null; onHover: (s: string) => void }): JSX.Element {
  // ── SVG 画布 ──
  const H = 90;            // 画布高度
  const spineY = 45;       // 脊柱线 y 位置
  const w = 300;           // 画布宽度
  const branchY_up = 15;   // 上分支 y 位置
  const branchY_down = 75; // 下分支 y 位置

  const hasCurrent = timeline.some((e) => e.status === "current");

  return (
    <svg viewBox={`0 0 ${w} ${H}`} className="block w-full" height={H}
      onMouseLeave={() => onHover("")}>
      {/* ── 脊柱横线 ── */}
      <polyline
        points={timeline.map((_, i) => `${12 + i * 56},${spineY}`).join(" ")}
        fill="none"
        stroke={hasCurrent ? "var(--color-accent-light)" : "var(--color-dot-gray)"}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* ── 分支 + 圆点 + 标签 ── */}
      {timeline.map((entry, i) => {
        const sx = 20 + i * 40;       // 脊柱节点 x
        const branchY = i % 2 === 0 ? branchY_up : branchY_down;
        const elbowX = sx + 22;       // 拐点 x（斜线 → 横线的转折点）
        const dotX = elbowX + 30;     // 圆点 x（横线末端）

        // 状态判断
        const isCurrent = hovered ? entry.stage === hovered
          : entry.status === "current" || (!hasCurrent && i === 0);
        const isDone = entry.status === "done";

        // ── 圆点样式 ──
        const r = isCurrent ? 5 : isDone ? 4 : 4;
        const fill = isDone ? "var(--color-success)" : isCurrent ? "var(--color-accent)" : "none";
        const stroke = isDone ? "var(--color-success)" : isCurrent ? "var(--color-accent)" : "var(--color-border-strong)";
        const lc = isDone || isCurrent ? "var(--color-accent-light)" : "var(--color-dot-gray)";

        return (
          <g key={entry.stage} onMouseEnter={() => onHover(entry.stage)} className="cursor-pointer">
            {/* ── 分支折线：脊柱 → 拐点 → 圆点 ── */}
            <polyline
              points={`${sx},${spineY} ${elbowX},${branchY} ${dotX},${branchY}`}
              fill="none"
              stroke={lc}
              strokeWidth="1.5"         // 分支线粗细
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* ── 圆点 ── */}
            {isDone ? (
              <>
                <circle cx={dotX} cy={branchY} r={r} fill={fill} stroke={stroke} strokeWidth="1.5" />
                <path d={`M${dotX - 3},${branchY} L${dotX - 1},${branchY + 2.5} L${dotX + 3},${branchY - 2.5}`} className="stroke-inverse" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </>
            ) : (
              <circle cx={dotX} cy={branchY} r={r} fill={fill} stroke={stroke} strokeWidth="1.5" className={isCurrent ? "animate-pulse" : ""} />
            )}
            {/* ── 标签（仅当前阶段显示） ── */}
            {isCurrent && (
              <text
                x={dotX}
                y={branchY < spineY ? branchY - 7 : branchY + 16}  // 上方-5 / 下方+14
                textAnchor="middle"
                fill="var(--color-accent)"
                fontSize="12"             // 标签字号
                fontWeight="600"
                fontFamily="system-ui, sans-serif"
              >
                {entry.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Task Row (hover to expand) ──────────────────────

function TaskRow({ task }: { task: { id: string; title: string; description?: string; status: string; completedAt?: number } }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const hasDesc = !!task.description;

  return (
    <div
      className={`border-b border-border last:border-0 transition-colors ${task.status === "running" ? "bg-surface-alt" : "hover:bg-surface-hover"}`}
      onMouseEnter={() => hasDesc && setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div className="flex items-center gap-2 px-3 py-1.5">
        {STATUS_ICON[task.status]}
        <span className={`text-[11px] truncate flex-1 ${task.status === "done" ? "text-text-secondary": task.status === "running" ? "text-text-primary font-medium" : "text-text-secondary"}`}>
          {task.title}
        </span>
      </div>
      {expanded && hasDesc && (
        <div className="px-3 pb-2 pl-8">
          <p className="text-[10px] text-text-secondary leading-relaxed">{task.description}</p>
        </div>
      )}
    </div>
  );
}

// ── Main Panel ──────────────────────────────────────

export function TaskPanel({ projectPath, onCollapse, onLeafClick }: TaskPanelProps): JSX.Element {
  const { tasks } = useTaskStore();
  const { timeline, doneCount, taskCount } = useProjectStatusStore();
  const [hovered, setHovered] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [userScrolled, setUserScrolled] = useState(false);

  // Sort: running → pending → done (newest first), then reverse → oldest at top
  const sortedTasks = [...tasks].sort((a, b) => {
    if (a.status === "running") return -1;
    if (b.status === "running") return 1;
    if (a.status === "pending") return -1;
    if (b.status === "pending") return 1;
    if (a.status === "done" && b.status === "done") return (b.completedAt || 0) - (a.completedAt || 0);
    return 0;
  }).reverse();

  const runningIdx = sortedTasks.findIndex((t) => t.status === "running");

  const centerRunning = useCallback(() => {
    if (runningIdx < 0 || !listRef.current) return;
    const el = listRef.current;
    if (runningIdx >= el.children.length) return;
    const row = el.children[runningIdx] as HTMLElement;
    el.scrollTo({ top: row.offsetTop - el.clientHeight / 2 + row.clientHeight / 2, behavior: "smooth" });
  }, [runningIdx]);

  useEffect(() => {
    if (!userScrolled) centerRunning();
  }, [runningIdx, userScrolled, centerRunning]);

  const handleScroll = useCallback(() => {
    setUserScrolled(true);
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => {
      setUserScrolled(false);
      centerRunning();
    }, 5000);
  }, [centerRunning]);

  const handleLeafClick = () => onLeafClick();

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2 h-9 px-3 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold tracking-[0.04em] uppercase text-text-secondary">项目进度</span>
        <div className="flex-1" />
        <button className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors text-xs"
          onClick={onCollapse} title="收起面板">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
            <path d="M4.5 3l3 3-3 3" />
          </svg>
        </button>
      </div>

      {/* Fishbone stepper */}
      <div className="shrink-0 px-3 pt-2" onMouseLeave={() => setHovered(null)}>
        <div className="rounded-xl bg-surface-alt border border-border overflow-hidden">
          <Fishbone timeline={timeline} hovered={hovered} onHover={setHovered} />
        </div>
      </div>

      {/* Task list — mint container always visible, fixed area */}
      <div className="flex-1 min-h-0 flex flex-col px-3 py-1.5">
        <div ref={listRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto rounded-xl bg-surface-alt border border-border">
          <div className="flex items-center justify-between px-3 pt-2 pb-1">
            <span className="text-[10px] text-text-secondary">开发任务</span>
            {taskCount > 0 && <span className="text-[10px] text-text-secondary">{doneCount}/{taskCount} 完成</span>}
          </div>
          {tasks.length > 0 ? (
            sortedTasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))
          ) : (
            <div className="flex items-center justify-center flex-1 py-8 text-[10px] text-text-secondary">暂无任务</div>
          )}
        </div>
      </div>

      {/* Leaf button */}
      <div className="shrink-0 px-3 pb-2 flex flex-col items-center">
        <button onClick={handleLeafClick}
          className="w-full h-12 rounded-xl bg-surface-alt hover:bg-surface-hover border border-border flex items-center justify-center transition-colors group">
          <span className="text-accent text-2xl select-none group-hover:scale-105 transition-transform" style={{ fontFamily: "'Snell Roundhand', 'Apple Chancery', 'Brush Script MT', 'Segoe Script', cursive" }}>Mint</span>
        </button>
        <p className="text-[10px] text-text-secondary mt-1.5 opacity-60">如果你不知道要做什么，就点一下</p>
      </div>
    </div>
  );
}
