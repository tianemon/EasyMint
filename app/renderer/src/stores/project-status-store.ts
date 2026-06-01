import { create } from "zustand";

export type PhaseState = "pending" | "running" | "done";

interface ProjectStatusState {
  initPhase: PhaseState;
  allocPhase: PhaseState;
  execPhase: PhaseState;
  projectPath: string;

  /** Load saved state from .easymint/state.json, then check init.sh */
  load: (path: string) => Promise<void>;
  /** Sync initPhase by checking init.sh content */
  sync: (path: string) => Promise<void>;
  setPhase: (key: "initPhase" | "allocPhase" | "execPhase", value: PhaseState) => void;
  reset: () => void;
}

function saveState(path: string): void {
  if (!path) return;
  const { initPhase, allocPhase, execPhase } = useProjectStatusStore.getState();
  window.electronAPI.project.writeState(path, { initPhase, allocPhase, execPhase }).catch(() => {});
}

export const useProjectStatusStore = create<ProjectStatusState>((set, get) => ({
  initPhase: "pending",
  allocPhase: "pending",
  execPhase: "pending",
  projectPath: "",

  load: async (path: string) => {
    if (!path) return;
    set({ projectPath: path });

    // Restore saved state first
    try {
      const saved = await window.electronAPI.project.readState(path);
      if (saved) {
        set({
          initPhase: (saved.initPhase as PhaseState) || "pending",
          allocPhase: (saved.allocPhase as PhaseState) || "pending",
          execPhase: (saved.execPhase as PhaseState) || "pending",
        });
      }
    } catch { /* no saved state */ }

    // Then sync actual file state to correct any drift
    const { initPhase } = get();
    if (initPhase !== "done") {
      try {
        const r = await window.electronAPI.project.checkInitStatus(path);
        if (r.done) set({ initPhase: "done" });
      } catch { /* ignore */ }
    }
  },

  sync: async (path: string) => {
    if (!path) return;
    try {
      const r = await window.electronAPI.project.checkInitStatus(path);
      if (r.done) {
        set({ initPhase: "done" });
        saveState(path);
      }
    } catch { /* ignore */ }
  },

  setPhase: (key, value) => {
    set({ [key]: value });
    const { projectPath } = get();
    if (projectPath) saveState(projectPath);
  },

  reset: () => set({ initPhase: "pending", allocPhase: "pending", execPhase: "pending" }),
}));
