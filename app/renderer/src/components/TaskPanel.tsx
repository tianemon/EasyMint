import { useState, useRef, useEffect, useCallback } from "react";
import { useTaskStore } from "../stores/task-store";
import { useProjectStatusStore } from "../stores/project-status-store";
import type { StageEntry } from "../stores/project-status-store";
import { chatActions } from "../stores/chat-actions";
import { CONTINUE_NEXT_STEP } from "../../../shared/prompts";

interface TaskPanelProps {
  projectPath: string;
  onCollapse: () => void;
}

const STATUS_ICON: Record<string, JSX.Element> = {
  done: <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0"><circle cx="6" cy="6" r="5" fill="#22c55e" stroke="#22c55e" strokeWidth="1"/><path d="M3.5 6l2 2 3-4" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  running: <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0"><circle cx="6" cy="6" r="5" fill="#eab308" stroke="#eab308" strokeWidth="1"/><circle cx="6" cy="6" r="2.5" fill="#fff" className="animate-pulse"/></svg>,
  failed: <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0"><circle cx="6" cy="6" r="5" fill="#ef4444" stroke="#ef4444" strokeWidth="1"/><path d="M4 4l4 4M8 4l-4 4" stroke="#fff" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  pending: <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0"><circle cx="6" cy="6" r="5" fill="none" stroke="#94a3b8" strokeWidth="1"/></svg>,
};

// ── SVG Boomerang Chevron (Skeuomorphic) ─────────────
//
//  Shape: thick ">" — each stage has a top highlight, gradient fill,
//  drop shadow, and rounded tips for a tactile 3D feel.

const STAGE_H = 54;
const POINT = 14;
const NOTCH = 14;
const GAP = 5;
const EXP_W = 106;
const COL_W = 43;
const RADIUS = 4;
let _uid = 0;

function StageChevron({ entry, isFirst, isLast, expanded, onHover }: { entry: StageEntry; isFirst: boolean; isLast: boolean; expanded: boolean; onHover: () => void }): JSX.Element {
  const midY = STAGE_H / 2;
  const w = expanded ? EXP_W : COL_W;
  const uid = ++_uid;

  const isDone = entry.status === "done";
  const isCurrent = entry.status === "current";

  const base = isDone ? "#22c55e" : isCurrent ? "#16a34a" : "#9ca3af";
  // Current stage uses the same mint green as the leaf button
  const topFill = isDone ? "#f0fdf4" : isCurrent ? "#e8f5ec" : "#f9fafb";
  const botFill = isDone ? "#dcfce7" : isCurrent ? "#d4edda" : "#f3f4f6";
  const shadowColor = isDone ? "rgba(34,197,94,0.12)" : isCurrent ? "rgba(22,163,74,0.12)" : "rgba(0,0,0,0.04)";

  const d = isFirst && isLast
    ? `M 0,0 L ${w},0 L ${w},${STAGE_H} L 0,${STAGE_H} Z`
    : isFirst
    ? `M 0,0 L ${w - POINT},0 L ${w},${midY} L ${w - POINT},${STAGE_H} L 0,${STAGE_H} Z`
    : isLast
    ? `M 0,0 L ${NOTCH},${midY} L 0,${STAGE_H} L ${w},${STAGE_H} L ${w},0 Z`
    : `M 0,0 L ${NOTCH},${midY} L 0,${STAGE_H} L ${w - POINT},${STAGE_H} L ${w},${midY} L ${w - POINT},0 Z`;

  const hl = isFirst && isLast
    ? `M ${RADIUS},1 L ${w - RADIUS},1`
    : isFirst
    ? `M ${RADIUS},1 L ${w - POINT - RADIUS},1`
    : isLast
    ? `M ${RADIUS},1 L ${w - RADIUS},1`
    : `M ${RADIUS},1 L ${w - POINT - RADIUS},1`;

  const overlap = isFirst ? 0 : -(POINT - GAP);

  return (
    <div style={{ width: w, marginLeft: overlap, flexShrink: 0 }} onMouseEnter={onHover}
      className={expanded ? "z-10" : "z-0"}>
      <svg viewBox={`0 0 ${w} ${STAGE_H}`} width={w} height={STAGE_H} className="block cursor-pointer">
        <defs>
          <linearGradient id={`g-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={topFill} />
            <stop offset="100%" stopColor={botFill} />
          </linearGradient>
          <filter id={`s-${uid}`}>
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor={shadowColor} />
          </filter>
        </defs>
        <path d={d} fill="rgba(0,0,0,0.04)" transform="translate(0,1.5)" />
        <path d={d} fill={`url(#g-${uid})`}
          strokeLinejoin="round" filter={`url(#s-${uid})`} />
        <path d={hl} stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" fill="none"
          strokeLinecap="round" />
        {isDone ? (
          <g transform={`translate(${w / 2 - 6}, ${midY - 6})`}>
            <circle cx="6" cy="6" r="6" fill={base} />
            <path d="M3 6l2.5 2.5L9.5 3.5" stroke="#fff" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ) : isCurrent ? (
          <circle cx={w / 2} cy={midY} r="3.5" fill={base} className="animate-pulse" />
        ) : (
          <circle cx={w / 2} cy={midY} r="2.5" fill="none" stroke={base} strokeWidth="1" />
        )}
        {expanded && (
          <text x={w / 2} y={midY + 15} textAnchor="middle" fill={base} fontSize="10" fontWeight="600" fontFamily="system-ui, sans-serif">
            {entry.label}
          </text>
        )}
      </svg>
    </div>
  );
}

export function TaskPanel({ projectPath, onCollapse }: TaskPanelProps): JSX.Element {
  const { tasks } = useTaskStore();
  const { timeline, doneCount, taskCount, stage } = useProjectStatusStore();
  const [hovered, setHovered] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [userScrolled, setUserScrolled] = useState(false);

  const sortedTasks = [...tasks].sort((a, b) => {
    if (a.status === "running") return -1;
    if (b.status === "running") return 1;
    if (a.status === "pending") return -1;
    if (b.status === "pending") return 1;
    if (a.status === "done" && b.status === "done") return (a.completedAt || 0) - (b.completedAt || 0);
    return 0;
  });
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

  const handleLeafClick = () => chatActions.send(CONTINUE_NEXT_STEP);

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2 h-9 px-3 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold tracking-[0.04em] uppercase text-text-secondary">项目进度</span>
        <div className="flex-1" />
        {taskCount > 0 && <span className="text-[10px] text-text-secondary">{doneCount}/{taskCount} 任务</span>}
        <button className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors text-xs"
          onClick={onCollapse} title="收起面板">▶</button>
      </div>

      {/* SVG Boomerang stepper */}
      <div className="flex items-center border-b border-border/50 bg-surface-alt shrink-0" onMouseLeave={() => setHovered(null)}>
        {timeline.map((entry, i) => (
          <StageChevron key={entry.stage} entry={entry} isFirst={i === 0} isLast={i === timeline.length - 1}
            expanded={hovered ? entry.stage === hovered : entry.status === "current"}
            onHover={() => setHovered(entry.stage)} />
        ))}
      </div>

      {/* Task list */}
      {tasks.length > 0 && (
        <div ref={listRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-0.5">
          <div className="text-[10px] text-text-secondary pb-1.5 pl-1">开发任务</div>
          {sortedTasks.map((task) => (
            <div key={task.id}
              className={`flex items-center gap-2 pl-1 py-1 rounded transition-colors ${task.status === "running" ? "bg-accent/5 ring-1 ring-accent/20" : "hover:bg-surface-hover"}`}>
              {STATUS_ICON[task.status]}
              <span className={`text-[11px] truncate flex-1 ${task.status === "done" ? "text-text-secondary line-through decoration-green-400/40" : task.status === "running" ? "text-text-primary font-medium" : "text-text-secondary"}`}>
                {task.title}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Leaf button */}
      <div className="shrink-0 px-3 pb-3 pt-1.5 flex flex-col items-center">
        <button onClick={handleLeafClick}
          className="w-full h-12 rounded-xl bg-[#16a34a]/10 hover:bg-[#16a34a]/20 border border-[#16a34a]/30 flex items-center justify-center transition-colors group">
          <svg viewBox="0 0 28 28" fill="none" className="w-7 h-7 text-[#16a34a] group-hover:scale-110 transition-transform">
            <path d="M14 2C14 2 8 8 8 14a6 6 0 0012 0C20 8 14 2 14 2z" fill="currentColor" opacity="0.3"/>
            <path d="M14 3C14 3 9 8.5 9 13.5a5 5 0 0010 0C19 8.5 14 3 14 3z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M14 9v10M14 9C12 9 9 11 9 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <path d="M14 19c2 0 5-2 5-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </button>
        <p className="text-[10px] text-text-secondary mt-1.5 opacity-60">如果你不知道要做什么，就点一下</p>
      </div>
    </div>
  );
}
