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

const STAGE_ORDER: ProjectStage[] = ["requirements", "tech-selection", "init", "planning", "developing", "done"];

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

    // Load saved stage times from .easymint/state.json
    let saved: Record<string, number> = {};
    try {
      const s = await window.electronAPI.project.readState(path);
      if (s?.stageTimes) saved = s.stageTimes as unknown as Record<string, number>;
    } catch { /* ignore */ }

    // Check files
    let hasAppSpec = false;
    let initDone = false;
    let hasInitSh = false;
    let realTasks: { id: string; passes: boolean }[] = [];
    let taskCount = 0;

    try {
      const rootFiles = await window.electronAPI.file.readTree(path);
      hasAppSpec = rootFiles.some((f: { name: string }) => f.name === "需求规格.md");
      if (!hasAppSpec) {
        try {
          const docsFiles = await window.electronAPI.file.readTree(path + "/docs");
          hasAppSpec = docsFiles.some((f: { name: string; isDirectory?: boolean }) =>
            !f.isDirectory && f.name === "需求规格.md"
          );
        } catch { /* */ }
      }
    } catch { /* */ }

    try {
      const r = await window.electronAPI.project.checkInitStatus(path);
      hasInitSh = true;
      initDone = !!r.done;
    } catch { /* */ }

    try {
      const r = await window.electronAPI.task.read(path);
      realTasks = (r.tasks || []).filter((t: { title: string }) => !t.title.includes("{{"));
      taskCount = (r.tasks || []).length;
    } catch { /* */ }

    const doneCount = realTasks.filter((t) => t.passes).length;

    // Determine stage
    let stage: ProjectStage;
    if (!hasAppSpec) stage = "requirements";
    else if (!hasInitSh) stage = "tech-selection";
    else if (!initDone) stage = "init";
    else if (realTasks.length === 0) stage = "planning";
    else if (realTasks.every((t) => t.passes)) stage = "done";
    else stage = "developing";

    // Record timestamps for completed stages in old stage detection
    const now = Date.now();
    const stageTimes: Record<string, number> = { ...saved };
    const completedUpTo = STAGE_ORDER.indexOf(stage);
    for (let i = 0; i < completedUpTo; i++) {
      if (!stageTimes[STAGE_ORDER[i]!]) stageTimes[STAGE_ORDER[i]!] = now;
    }
    // Persist if changed
    if (JSON.stringify(stageTimes) !== JSON.stringify(saved)) {
      window.electronAPI.project.writeState(path, { stageTimes }).catch(() => {});
    }

    // Build timeline
    const currentIdx = STAGE_ORDER.indexOf(stage);
    const timeline: StageEntry[] = STAGE_ORDER.map((s, i) => ({
      stage: s,
      label: STAGE_LABELS[s],
      status: i < currentIdx ? "done" : i === currentIdx ? "current" : "pending",
      time: fmtTime(stageTimes[s]),
    }));

    set({ stage, timeline, taskCount, doneCount });
  },

  reset: () => set({
    stage: "requirements",
    timeline: STAGE_ORDER.map((s) => ({ stage: s, label: STAGE_LABELS[s], status: "pending" as const })),
    taskCount: 0, doneCount: 0, projectPath: "",
  }),
}));
