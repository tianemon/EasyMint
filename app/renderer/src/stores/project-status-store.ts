import { create } from "zustand";

export type ProjectStage =
  | "requirements"
  | "tech-selection"
  | "init"
  | "planning"
  | "developing"
  | "done";

export interface StageEntry {
  stage: ProjectStage;
  label: string;
  status: "pending" | "current" | "done";
  summary?: string;
  time?: string;
}

interface ProjectStatusState {
  stage: ProjectStage;
  timeline: StageEntry[];
  taskCount: number;
  doneCount: number;
  projectPath: string;
  stageTimes: Record<string, number>;

  refreshAll: (path: string) => Promise<void>;
  /** 直接设置阶段 — 由 set_project_stage MCP 工具驱动，即时刷新 UI */
  setStage: (stage: ProjectStage) => void;
  reset: () => void;
}

const STAGE_ORDER: ProjectStage[] = ["requirements", "tech-selection", "planning", "init", "developing", "done"];

const STAGE_LABELS: Record<ProjectStage, string> = {
  requirements: "需求采集",
  "tech-selection": "技术选型",
  init: "环境初始化",
  planning: "任务规划",
  developing: "正在开发",
  done: "开发完成",
};

function fmtTime(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function buildTimeline(stage: ProjectStage, stageTimes: Record<string, number>): StageEntry[] {
  const currentIdx = STAGE_ORDER.indexOf(stage);
  return STAGE_ORDER.map((s, i) => ({
    stage: s,
    label: STAGE_LABELS[s],
    status: i < currentIdx ? "done" : stage === "done" ? "done" : i === currentIdx ? "current" : "pending",
    time: fmtTime(stageTimes[s]),
  })) as StageEntry[];
}

export const useProjectStatusStore = create<ProjectStatusState>((set, get) => ({
  stage: "requirements",
  timeline: STAGE_ORDER.map((s) => ({ stage: s, label: STAGE_LABELS[s], status: "pending" as const })),
  taskCount: 0,
  doneCount: 0,
  projectPath: "",
  stageTimes: {},

  setStage: (stage: ProjectStage) => {
    const { stageTimes } = get();
    const now = Date.now();
    const currentIdx = STAGE_ORDER.indexOf(stage);
    // 标记已完成的阶段时间
    const updated: Record<string, number> = { ...stageTimes };
    for (let i = 0; i < currentIdx; i++) {
      if (!updated[STAGE_ORDER[i]!]) updated[STAGE_ORDER[i]!] = now;
    }
    set({ stage, timeline: buildTimeline(stage, updated), stageTimes: updated });
    // 异步持久化 stageTimes 到 state.json（best-effort）
    const { projectPath } = get();
    if (projectPath) {
      window.electronAPI.project.writeState(projectPath, { stage, stageTimes: updated }).catch(() => {});
    }
  },

  refreshAll: async (path: string) => {
    if (!path) return;
    set({ projectPath: path });

    // 读 state.json — Mint 通过 set_project_stage 写 stage，前端 setStage 写 stageTimes
    let facts: Record<string, unknown> = {};
    let stageTimes: Record<string, number> = {};
    try {
      const s = await window.electronAPI.project.readState(path);
      if (s) {
        facts = s;
        if (s.stageTimes) stageTimes = s.stageTimes as unknown as Record<string, number>;
      }
    } catch { /* ignore */ }

    const persistedStage = facts.stage as string | undefined;

    // 读 task.json — 直接算 doneCount + taskCount，不依赖 state.json
    let doneCount = 0;
    let taskCount = 0;
    try {
      const r = await window.electronAPI.task.read(path);
      const tasks = (r.tasks || []).filter((t: { title: string }) => !t.title.includes("{{"));
      doneCount = tasks.filter((t) => t.status === "done").length;
      taskCount = tasks.length;
    } catch { /* */ }

    // 决定 stage：安全网优先 → Mint 写入的 stage → 默认 requirements
    let stage: ProjectStage;
    if (taskCount > 0 && doneCount >= taskCount) {
      stage = "done";                          // 安全网：任务全部完成
    } else if (persistedStage && STAGE_ORDER.includes(persistedStage as ProjectStage)) {
      stage = persistedStage as ProjectStage;   // Mint 主动写入
    } else {
      stage = "requirements";                   // 新项目，没有任何记录
    }

    // 更新 stageTimes
    const now = Date.now();
    const saved: Record<string, number> = { ...stageTimes };
    const completedUpTo = STAGE_ORDER.indexOf(stage);
    for (let i = 0; i < completedUpTo; i++) {
      if (!stageTimes[STAGE_ORDER[i]!]) stageTimes[STAGE_ORDER[i]!] = now;
    }
    if (JSON.stringify(stageTimes) !== JSON.stringify(saved)) {
      window.electronAPI.project.writeState(path, { ...facts, stageTimes }).catch(() => {});
    }

    const timeline = buildTimeline(stage, stageTimes);

    set({ stage, timeline, taskCount, doneCount, stageTimes });
  },

  reset: () => set({
    stage: "requirements",
    timeline: STAGE_ORDER.map((s) => ({ stage: s, label: STAGE_LABELS[s], status: "pending" as const })),
    taskCount: 0, doneCount: 0, projectPath: "", stageTimes: {},
  }),
}));
