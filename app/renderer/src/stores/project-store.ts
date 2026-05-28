import { create } from "zustand";

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  load: () => Promise<void>;
  setCurrent: (project: Project | null) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  currentProject: null,
  load: async () => {
    const projects = await window.electronAPI.project.list();
    set({ projects });
  },
  setCurrent: (project) => set({ currentProject: project }),
}));
