import { useState, useRef, useEffect } from "react";
import { useTaskStore } from "../stores/task-store";
import { chatActions } from "../stores/chat-actions";

interface TaskPanelProps {
  projectPath: string;
  onCollapse: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "待执行",
  running: "运行中",
  done: "已完成",
  failed: "失败",
};

/** Scale: 0 = densest, 4 = loosest */
const DENSITY_GAPS = ["gap-1", "gap-2", "gap-3", "gap-4", "gap-5"];

type FlowState = "disabled" | "ready" | "running" | "done";

function FlowStep({ label, state, onClick }: { label: string; state: FlowState; onClick?: () => void }): JSX.Element {
  const colors: Record<FlowState, string> = {
    disabled: "bg-surface border border-border text-text-secondary opacity-50 cursor-not-allowed",
    ready: "bg-red-500/10 border border-red-400/40 text-red-500 hover:bg-red-500/20 cursor-pointer",
    running: "bg-amber-400/10 border border-amber-400/40 text-amber-500 cursor-default",
    done: "bg-green-100 border border-green-300/50 text-green-600 cursor-default",
  };
  const dots: Record<FlowState, string> = {
    disabled: "bg-border",
    ready: "bg-red-500 animate-pulse",
    running: "bg-amber-400 animate-pulse",
    done: "bg-green-500",
  };
  return (
    <button
      disabled={state !== "ready"}
      onClick={onClick}
      className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors shrink-0 ${colors[state]}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dots[state]}`} />
      {label}
    </button>
  );
}

function FlowArrow({ done }: { done: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
      className={`w-3 h-3 shrink-0 ${done ? "text-green-400" : "text-border"}`}
    >
      <path d="M3 6h5M7 3l3 3-3 3" />
    </svg>
  );
}

export function TaskPanel({ projectPath, onCollapse }: TaskPanelProps): JSX.Element {
  const { tasks } = useTaskStore();
  const [density, setDensity] = useState(2);
  const panelRef = useRef<HTMLDivElement>(null);

  // Flow phase tracking (module-level, survives remounts)
  const tasksAllocated = tasks.length > 0;

  const handleInitEnv = () => {
    chatActions.send("帮我初始化开发环境");
  };

  const handleAllocateTasks = async () => {
    try {
      const instruction = await window.electronAPI.systemPrompt.getTaskInstruction();
      if (instruction) chatActions.send(instruction);
    } catch { /* ignore */ }
  };

  // Cmd/Ctrl + scroll or pinch gesture → adjust density
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // metaKey = Cmd (Mac), ctrlKey = Ctrl+scroll (Win) or pinch (Mac)
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -1 : 1;
      setDensity((prev) => Math.max(0, Math.min(4, prev + delta)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Sort: completed tasks by completedAt (oldest first), then pending by creation order
  const sortedTasks = [...tasks].sort((a, b) => {
    const aDone = a.status === "done";
    const bDone = b.status === "done";
    if (aDone && bDone) return (a.completedAt || 0) - (b.completedAt || 0);
    if (aDone) return -1;
    if (bDone) return 1;
    return a.createdAt - b.createdAt;
  });

  return (
    <div ref={panelRef} className="h-full flex flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold tracking-[0.04em] uppercase text-text-secondary">任务时间轴</span>
        <span className="text-2xs text-text-secondary">{tasks.length} 个</span>
        <div className="flex-1" />
        {/* Density control */}
        <div className="flex items-center gap-0.5">
          <button
            className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${
              density === 0 ? "text-border cursor-not-allowed" : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
            }`}
            onClick={() => setDensity(Math.max(0, density - 1))}
            disabled={density === 0}
            title="压缩间距 · 双指捏合 或 Cmd/Ctrl+滚轮"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <path d="M5 8H1M3 6l2 2-2 2M11 8h6M13 6l-2 2 2 2" />
            </svg>
          </button>
          <button
            className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${
              density === 4 ? "text-border cursor-not-allowed" : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
            }`}
            onClick={() => setDensity(Math.min(4, density + 1))}
            disabled={density === 4}
            title="扩展间距 · 双指张开 或 Cmd/Ctrl+滚轮"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <path d="M7 8H1M3 6l-2 2 2 2M9 8h6M13 6l2 2-2 2" />
            </svg>
          </button>
        </div>
        <button
          className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:bg-surface-hover transition-colors"
          onClick={onCollapse}
          title="收起面板"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
            <path d="M11 4l-6 4 6 4" />
          </svg>
        </button>
      </div>

      {/* Flow indicator — three steps with arrows */}
      <div className="flex items-center justify-center gap-1.5 px-3 py-2.5 border-b border-border/50 bg-surface-alt shrink-0">
        {/* Step 1: Init — always ready, done when tasks exist */}
        <FlowStep
          label="初始化环境"
          state={tasksAllocated ? "done" : "ready"}
          onClick={tasksAllocated ? undefined : handleInitEnv}
        />
        <FlowArrow done={tasksAllocated} />
        {/* Step 2: Allocate — ready after init, done when tasks exist */}
        <FlowStep
          label="分配任务"
          state={tasksAllocated ? "done" : "ready"}
          onClick={tasksAllocated ? undefined : handleAllocateTasks}
        />
        <FlowArrow done={false} />
        {/* Step 3: Execute — disabled until tasks exist, then ready */}
        <FlowStep
          label="执行任务"
          state={tasksAllocated ? "ready" : "disabled"}
        />
      </div>

      {/* Timeline */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-text-secondary">暂无任务</p>
          </div>
        ) : (
          <div className={`relative px-3 py-2 flex flex-col ${DENSITY_GAPS[density]}`}>
            {/* Center timeline line */}
            <div className="absolute left-1/2 top-4 bottom-4 w-px bg-border" style={{ transform: "translateX(-0.5px)" }} />

            {sortedTasks.map((task, idx) => {
              const isRight = idx % 2 === 0;
              const isRunning = task.status === "running";
              return (
                <div key={task.id} className="relative flex items-center min-h-[28px]">
                  {/* Left side (even tasks go right, odd tasks go left) */}
                  {isRight ? <div className="flex-1" /> : (
                    <div className="flex-1 flex justify-end pr-4">
                      <span className={`text-[11px] truncate max-w-[160px] ${
                        task.status === "done" ? "text-text-secondary line-through decoration-green-400/50" :
                        isRunning ? "text-accent font-medium" : "text-text-primary"
                      }`}>
                        {task.title}
                        <span className={`text-[9px] ml-1.5 ${
                          isRunning ? "text-accent" : task.status === "failed" ? "text-red-400" :
                          task.status === "done" ? "text-green-500" : "text-text-secondary"
                        }`}>{STATUS_LABELS[task.status]}</span>
                      </span>
                    </div>
                  )}

                  {/* Center dot */}
                  <span
                    className={`absolute left-1/2 w-2.5 h-2.5 rounded-full ring-2 ring-surface shrink-0 z-10 ${
                      task.status === "running" ? "bg-accent animate-pulse" :
                      task.status === "done" ? "bg-green-500" :
                      task.status === "failed" ? "bg-red-400" :
                      "bg-border"
                    }`}
                    style={{ transform: "translate(-50%, 0)" }}
                  />

                  {/* Right side (even tasks) or spacer (odd tasks) */}
                  {isRight ? (
                    <div className="flex-1 pl-4">
                      <span className={`text-[11px] truncate max-w-[160px] inline-block ${
                        task.status === "done" ? "text-text-secondary line-through decoration-green-400/50" :
                        isRunning ? "text-accent font-medium" : "text-text-primary"
                      }`}>
                        {task.title}
                        <span className={`text-[9px] ml-1.5 ${
                          isRunning ? "text-accent" : task.status === "failed" ? "text-red-400" :
                          task.status === "done" ? "text-green-500" : "text-text-secondary"
                        }`}>{STATUS_LABELS[task.status]}</span>
                      </span>
                    </div>
                  ) : <div className="flex-1" />}
                </div>
              );
            })}
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
