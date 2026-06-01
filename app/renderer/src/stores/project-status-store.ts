import { create } from "zustand";
import { useTaskStore } from "./task-store";

export type PhaseState = "pending" | "running" | "done";

interface ProjectStatusState {
  initPhase: PhaseState;
  allocPhase: PhaseState;
  execPhase: PhaseState;

  sync: (projectPath: string) => Promise<void>;
  setPhase: (key: "initPhase" | "allocPhase" | "execPhase", value: PhaseState) => void;
  reset: () => void;
}

export const useProjectStatusStore = create<ProjectStatusState>((set) => ({
  initPhase: "pending",
  allocPhase: "pending",
  execPhase: "pending",

  sync: async (projectPath: string) => {
    if (!projectPath) return;
    // Check init.sh via IPC
    try {
      const r = await window.electronAPI.project.checkInitStatus(projectPath);
      if (r.done) set({ initPhase: "done" });
    } catch { /* ignore */ }
    // Check tasks from task-store
    const tasks = useTaskStore.getState().tasks;
    if (tasks.length > 0) set({ initPhase: "done", allocPhase: "done" });
  },

  setPhase: (key, value) => set({ [key]: value }),

  reset: () => set({ initPhase: "pending", allocPhase: "pending", execPhase: "pending" }),
}));
