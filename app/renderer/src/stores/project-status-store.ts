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

export const useProjectStatusStore = create<ProjectStatusState>((set, get) => ({
  initPhase: "pending",
  allocPhase: "pending",
  execPhase: "pending",

  sync: async (projectPath: string) => {
    if (!projectPath) return;
    // Check init.sh via IPC → update initPhase only
    try {
      const r = await window.electronAPI.project.checkInitStatus(projectPath);
      if (r.done) set({ initPhase: "done" });
    } catch { /* ignore */ }
    // Check tasks → update allocPhase only if init is done
    const tasks = useTaskStore.getState().tasks;
    const { initPhase } = get();
    if (tasks.length > 0 && initPhase === "done") {
      set({ allocPhase: "done" });
    }
  },

  setPhase: (key, value) => set({ [key]: value }),

  reset: () => set({ initPhase: "pending", allocPhase: "pending", execPhase: "pending" }),
}));
