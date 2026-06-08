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

  refreshAll: (path: string) => Promise<void>;
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

export const useProjectStatusStore = create<ProjectStatusState>((set) => ({
  stage: "requirements",
  timeline: STAGE_ORDER.map((s) => ({ stage: s, label: STAGE_LABELS[s], status: "pending" as const })),
  taskCount: 0,
  doneCount: 0,
  projectPath: "",

  refreshAll: async (path: string) => {
    if (!path) return;
    set({ projectPath: path });

    // Read state.json facts — Mint writes these at key milestones
    let facts: Record<string, unknown> = {};
    let stageTimes: Record<string, number> = {};
    try {
      const s = await window.electronAPI.project.readState(path);
      if (s) {
        facts = s;
        if (s.stageTimes) stageTimes = s.stageTimes as unknown as Record<string, number>;
      }
    } catch { /* ignore */ }

    const initCompleted = facts.initCompleted as boolean | undefined;
    const docsLevel = facts.docsLevel as string | undefined;
    const factTaskCount = facts.taskCount as number | undefined;

    // Read task.json for real pass/fail status
    let doneCount = 0;
    try {
      const r = await window.electronAPI.task.read(path);
      const tasks = (r.tasks || []).filter((t: { title: string }) => !t.title.includes("{{"));
      doneCount = tasks.filter((t) => t.passes).length;
    } catch { /* */ }

    // Derive stage from facts + task.json reality
    let stage: ProjectStage;
    if (initCompleted === undefined) {
      stage = "requirements"; // Nothing recorded yet
    } else if (!initCompleted) {
      stage = "init";
    } else if (factTaskCount === undefined) {
      stage = docsLevel === "none" ? "done" : "planning";
    } else if (factTaskCount === 0) {
      stage = "planning";
    } else if (doneCount >= factTaskCount && factTaskCount > 0) {
      stage = "done";
    } else {
      stage = "developing";
    }

    // Update stageTimes
    const now = Date.now();
    const saved: Record<string, number> = { ...stageTimes };
    const completedUpTo = STAGE_ORDER.indexOf(stage);
    for (let i = 0; i < completedUpTo; i++) {
      if (!stageTimes[STAGE_ORDER[i]!]) stageTimes[STAGE_ORDER[i]!] = now;
    }
    if (JSON.stringify(stageTimes) !== JSON.stringify(saved)) {
      window.electronAPI.project.writeState(path, { ...facts, stageTimes }).catch(() => {});
    }

    // Build timeline
    const currentIdx = STAGE_ORDER.indexOf(stage);
    const timeline: StageEntry[] = STAGE_ORDER.map((s, i) => ({
      stage: s,
      label: STAGE_LABELS[s],
      status: i < currentIdx ? "done" : i === currentIdx ? "current" : "pending",
      time: fmtTime(stageTimes[s]),
    }));

    set({ stage, timeline, taskCount: factTaskCount ?? 0, doneCount });
  },

  reset: () => set({
    stage: "requirements",
    timeline: STAGE_ORDER.map((s) => ({ stage: s, label: STAGE_LABELS[s], status: "pending" as const })),
    taskCount: 0, doneCount: 0, projectPath: "",
  }),
}));
