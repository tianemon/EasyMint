import { create } from "zustand";

/**
 * 项目状态 — 任务完成计数。
 * stage/timeline 体系已随鱼骨图移除（v3 UI 改版 + set_project_stage 工具清理）。
 */

interface ProjectStatusState {
  taskCount: number;
  doneCount: number;
  projectPath: string;

  /** 读取 task.json 计算任务完成计数 */
  refreshAll: (path: string) => Promise<void>;
  reset: () => void;
}

export const useProjectStatusStore = create<ProjectStatusState>((set) => ({
  taskCount: 0,
  doneCount: 0,
  projectPath: "",

  refreshAll: async (path: string) => {
    if (!path) return;
    set({ projectPath: path });

    // 读 task.json — 直接算 doneCount + taskCount
    let doneCount = 0;
    let taskCount = 0;
    try {
      const r = await window.electronAPI.task.read(path);
      const tasks = (r.tasks || []).filter((t: { title: string }) => !t.title.includes("{{"));
      doneCount = tasks.filter((t) => t.status === "done").length;
      taskCount = tasks.length;
    } catch { /* ignore */ }

    set({ taskCount, doneCount });
  },

  reset: () => set({ taskCount: 0, doneCount: 0, projectPath: "" }),
}));
